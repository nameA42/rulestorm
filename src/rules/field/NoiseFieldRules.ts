import { CATALOG, type MutableRuleState, type RuleId, type RuleState } from '../../contracts/catalog';
import type { RuleField } from '../../contracts/rules';
import { Rng, hash32 } from '../../shared/rng';

/** A small RGB picture (bytes, row-major) that the field can be sampled from. */
export interface FieldImage {
  w: number;
  h: number;
  data: number[];
}

export type NoiseSource = 'random' | 'image';

interface FieldState {
  seed: number;
  source: NoiseSource;
  activity: number;
  image: FieldImage | null;
}

const IDS: readonly RuleId[] = CATALOG.map((r) => r.id);
const WAVES = 5;

/**
 * Rules as an n-dimensional field of smooth noise. Every rule has its own
 * smooth scalar field over R^n; a rule's strength at a point is how far that
 * field rises above a threshold. Walk a little → rules shift a little.
 *
 *  - random: each rule is a sum of a few random plane waves in R^n
 *    (cheap, smooth, deterministic from the seed).
 *  - image:  each rule looks at a 2D picture through its own random linear
 *    projection R^n → R^2 (mirror-tiled so there are no seams), reading one
 *    colour channel. Bright/dark regions of the picture become rule regions.
 *
 * `activity` moves the threshold: higher → more rules on at once.
 */
export class NoiseFieldRules implements RuleField {
  readonly name = 'noise-field';
  source: NoiseSource = 'random';
  activity = 0.45;
  private seedV: number;
  private image: Img | null = null;
  private stats: { mean: number; std: number }[] = [];
  /** Per rule × wave: n direction components, then phase. */
  private waves!: Float64Array;
  /** Per rule: 2 × n projection, 2 offsets, 1 channel. */
  private proj!: Float64Array;

  constructor(seed: number, readonly dims = 8) {
    this.seedV = seed >>> 0;
    this.build();
    this.setImage(null);
  }

  get seed() { return this.seedV; }
  setSeed(seed: number) {
    if ((seed >>> 0) === this.seedV) return;
    this.seedV = seed >>> 0;
    this.build();
    if (!this.image) this.setImage(null);
  }

  hasImage() { return this.image !== null && !this.image.placeholder; }

  /** Use a picture as the noise source (null → a built-in placeholder). */
  setImage(img: FieldImage | null) {
    this.image = img ? { ...img, placeholder: false } : { ...placeholderImage(this.seedV), placeholder: true };
    const { w, h, data } = this.image;
    const n = w * h;
    this.stats = [0, 1, 2, 3].map((ch) => {
      let sum = 0, sq = 0;
      for (let i = 0; i < n; i++) {
        const v = channel(data, i, ch);
        sum += v; sq += v * v;
      }
      const mean = sum / n;
      return { mean, std: Math.max(8, Math.sqrt(Math.max(0, sq / n - mean * mean))) };
    });
  }

  private build() {
    const n = this.dims;
    const rng = new Rng(hash32('noise-field', this.seedV, n));
    const gauss = () => {
      const u = Math.max(1e-9, rng.next()), v = rng.next();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    };
    const unit = () => {
      const v = Array.from({ length: n }, gauss);
      const m = Math.hypot(...v) || 1;
      return v.map((x) => x / m);
    };
    this.waves = new Float64Array(IDS.length * WAVES * (n + 1));
    this.proj = new Float64Array(IDS.length * (2 * n + 3));
    for (let r = 0; r < IDS.length; r++) {
      for (let k = 0; k < WAVES; k++) {
        const base = (r * WAVES + k) * (n + 1);
        const f = rng.range(0.55, 1.6);
        const dir = unit();
        for (let i = 0; i < n; i++) this.waves[base + i] = dir[i] * f;
        this.waves[base + n] = rng.range(0, Math.PI * 2);
      }
      const pb = r * (2 * n + 3);
      const a = unit(), b = unit();
      for (let i = 0; i < n; i++) {
        this.proj[pb + i] = a[i] * 0.14;
        this.proj[pb + n + i] = b[i] * 0.14;
      }
      this.proj[pb + 2 * n] = rng.next();
      this.proj[pb + 2 * n + 1] = rng.next();
      this.proj[pb + 2 * n + 2] = rng.int(0, 3);
    }
  }

  /** Raw, roughly unit-variance field value of rule r at coord. */
  private raw(r: number, c: readonly number[]): number {
    const n = this.dims;
    if (this.source === 'image' && this.image) {
      const pb = r * (2 * n + 3);
      let u = this.proj[pb + 2 * n], v = this.proj[pb + 2 * n + 1];
      for (let i = 0; i < n; i++) {
        u += this.proj[pb + i] * c[i];
        v += this.proj[pb + n + i] * c[i];
      }
      const ch = this.proj[pb + 2 * n + 2];
      const st = this.stats[ch];
      return (bilinear(this.image, pingPong(u), pingPong(v), ch) - st.mean) / st.std;
    }
    let sum = 0;
    for (let k = 0; k < WAVES; k++) {
      const base = (r * WAVES + k) * (n + 1);
      let dot = this.waves[base + n];
      for (let i = 0; i < n; i++) dot += this.waves[base + i] * c[i];
      sum += Math.sin(dot);
    }
    return sum / Math.sqrt(WAVES / 2);
  }

  sample(coord: readonly number[]): RuleState {
    const out = {} as MutableRuleState;
    const thr = 2.0 - 1.6 * this.activity;
    for (let r = 0; r < IDS.length; r++) {
      const t = (this.raw(r, coord) - thr) / 0.8;
      const c = t <= 0 ? 0 : t >= 1 ? 1 : t;
      out[IDS[r]] = Math.round(c * c * (3 - 2 * c) * 1000) / 1000; // smoothstep
    }
    return out;
  }

  describe(): string {
    return `${this.dims}D ${this.source === 'image' ? (this.hasImage() ? 'image' : 'placeholder image') : 'random'} noise · activity ${Math.round(this.activity * 100)}%`;
  }

  snapshot(): FieldState {
    return { seed: this.seedV, source: this.source, activity: this.activity, image: this.hasImage() ? stripImage(this.image!) : null };
  }

  restore(s: unknown): void {
    const st = s as FieldState;
    this.source = st.source === 'image' ? 'image' : 'random';
    this.activity = st.activity ?? 0.45;
    this.seedV = 0xffffffff; // force rebuild
    this.setSeed(st.seed);
    this.setImage(st.image ?? null);
  }
}

// ── image helpers ─────────────────────────────────────────────────────
type Img = FieldImage & { placeholder?: boolean };

function stripImage(i: Img): FieldImage {
  return { w: i.w, h: i.h, data: i.data };
}

function channel(data: number[], i: number, ch: number): number {
  const o = i * 3;
  return ch === 3 ? 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2] : data[o + ch];
}

/** Continuous tiling: 0→1→0→1… so the picture never shows a seam. */
function pingPong(t: number): number {
  const m = ((t % 2) + 2) % 2;
  return m > 1 ? 2 - m : m;
}

function bilinear(img: FieldImage, u: number, v: number, ch: number): number {
  const x = u * (img.w - 1), y = v * (img.h - 1);
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = Math.min(img.w - 1, x0 + 1), y1 = Math.min(img.h - 1, y0 + 1);
  const fx = x - x0, fy = y - y0;
  const at = (xx: number, yy: number) => channel(img.data, yy * img.w + xx, ch);
  return (at(x0, y0) * (1 - fx) + at(x1, y0) * fx) * (1 - fy) + (at(x0, y1) * (1 - fx) + at(x1, y1) * fx) * fy;
}

/** Soft coloured blobs — used until a real picture is loaded. */
export function placeholderImage(seed: number, size = 48): FieldImage {
  const rng = new Rng(hash32('placeholder', seed));
  const blobs = Array.from({ length: 14 }, () => ({
    x: rng.next(), y: rng.next(), r: rng.range(0.08, 0.3),
    c: [rng.int(0, 255), rng.int(0, 255), rng.int(0, 255)],
  }));
  const data: number[] = [];
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const px = i / (size - 1), py = j / (size - 1);
      const acc = [30, 30, 40];
      for (const b of blobs) {
        const k = Math.exp(-((px - b.x) ** 2 + (py - b.y) ** 2) / (b.r * b.r));
        for (let ch = 0; ch < 3; ch++) acc[ch] += b.c[ch] * k;
      }
      for (let ch = 0; ch < 3; ch++) data.push(Math.min(255, Math.round(acc[ch])));
    }
  }
  return { w: size, h: size, data };
}
