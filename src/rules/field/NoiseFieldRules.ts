import { CATALOG, type MutableRuleState, type RuleId, type RuleState } from '../../contracts/catalog';
import type { RuleField } from '../../contracts/rules';
import { Rng, hash32 } from '../../shared/rng';

/** A small RGB picture (bytes, row-major) that the field can be sampled from. */
export interface FieldImage {
  w: number;
  h: number;
  data: number[];
}

export type NoiseSource = 'random' | 'image' | 'axes';

interface FieldState {
  seed: number;
  tilt?: number;
  source: NoiseSource;
  activity: number;
  axisWaves?: number;
  image: FieldImage | null;
}

const IDS: readonly RuleId[] = CATALOG.map((r) => r.id);
const WAVES = 5;
/** Rotated-rule-space mode: 1-D sine waves per rule axis (default / most). */
const AXIS_WAVES = 3;
export const MAX_AXIS_WAVES = 8;

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
 *  - axes:   "rotated rule space". Picture a 100-D space with one axis per
 *    rule, where each axis carries its own 1-D noise (so rule r only cares
 *    how far along axis r you are). Field space is a randomly rotated copy
 *    of it: a point x in field space is the rule-space point Q·x, with Q a
 *    seeded random rotation. So a step along any field axis is a diagonal in
 *    rule space and nudges many rules at once. In this mode dims = 100.
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
  /** Axes mode: rotation, row r = rule r's axis expressed in field coords. */
  private rot: Float64Array | null = null;
  /** Which rotation field space is of rule space: 0 = aligned (none), else a seed. */
  private tiltV = 1;
  /** Axes mode: per rule × wave: frequency, phase. */
  private axisWaves!: Float64Array;
  /** Axes mode: waves beyond the first AXIS_WAVES (separate stream, so the default field never changes). */
  private axisExtra!: Float64Array;
  /** Axes mode: sine waves per rule axis. 0 = linear: strength is simply your coordinate on that axis, bounded to 0..1. */
  private wavesV = AXIS_WAVES;

  constructor(seed: number, private readonly baseDims = 8) {
    this.seedV = seed >>> 0;
    this.tiltV = defaultTilt(this.seedV);
    this.build();
    this.setImage(null);
  }

  get seed() { return this.seedV; }
  /** 8 for the noise sources (by default); one per rule for rotated rule space. */
  get dims() { return this.source === 'axes' ? IDS.length : this.baseDims; }
  setSeed(seed: number) {
    if ((seed >>> 0) === this.seedV) return;
    this.seedV = seed >>> 0;
    this.tiltV = defaultTilt(this.seedV);
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
    this.rot = null; // built on first use
    const ar = new Rng(hash32('rule-axes', this.seedV));
    this.axisWaves = new Float64Array(IDS.length * AXIS_WAVES * 2);
    for (let i = 0; i < IDS.length * AXIS_WAVES; i++) {
      this.axisWaves[i * 2] = ar.range(2, 5);
      this.axisWaves[i * 2 + 1] = ar.range(0, Math.PI * 2);
    }
    const xr = new Rng(hash32('rule-axes-extra', this.seedV));
    const extra = MAX_AXIS_WAVES - AXIS_WAVES;
    this.axisExtra = new Float64Array(IDS.length * extra * 2);
    for (let i = 0; i < IDS.length * extra; i++) {
      this.axisExtra[i * 2] = xr.range(2, 5);
      this.axisExtra[i * 2 + 1] = xr.range(0, Math.PI * 2);
    }
    const n = this.baseDims;
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

  /** A seeded random rotation of R^N (Gram–Schmidt on a Gaussian matrix). */
  get axisWaveCount() { return this.wavesV; }
  /** Rule space: sine waves per rule axis, 0..MAX_AXIS_WAVES (0 = linear and bounded). */
  setAxisWaves(count: number) {
    this.wavesV = Math.max(0, Math.min(MAX_AXIS_WAVES, Math.round(count)));
  }
  /** Rule space with 0 waves: strengths are coordinates, and positions are kept in the 0..1 box. */
  get linear() { return this.source === 'axes' && this.wavesV === 0; }

  /** Rule r's 1-D profile along its own axis (raw value; the coordinate itself when linear). */
  private axisRaw(r: number, p: number): number {
    const k = this.wavesV;
    if (k === 0) return p;
    let sum = 0;
    for (let i = 0; i < k; i++) {
      const [w, o] = i < AXIS_WAVES
        ? [this.axisWaves, (r * AXIS_WAVES + i) * 2]
        : [this.axisExtra, (r * (MAX_AXIS_WAVES - AXIS_WAVES) + i - AXIS_WAVES) * 2];
      sum += Math.sin(w[o] * p + w[o + 1]);
    }
    return sum / Math.sqrt(k / 2);
  }

  /** Raw value to strength (linear mode: the coordinate, clamped to 0..1). */
  private str(raw: number, thr: number): number {
    if (this.linear) return raw <= 0 ? 0 : raw >= 1 ? 1 : raw;
    return strength(raw, thr);
  }

  /**
   * Rule space with 0 waves bounds you to 0..1 along every rule axis. Returns
   * the nearest allowed field position, or null if coord is already allowed.
   * (Field space is a rotation of rule space, so this is an exact projection:
   * rotate in, clamp each rule coordinate, rotate back.)
   */
  bound(coord: readonly number[]): number[] | null {
    if (!this.linear) return null;
    const N = IDS.length, q = this.rotation();
    const p = new Float64Array(N);
    let outside = false;
    for (let r = 0; r < N; r++) {
      let s = 0;
      for (let i = 0; i < N; i++) s += q[r * N + i] * (coord[i] ?? 0);
      if (s < -1e-9 || s > 1 + 1e-9) outside = true; // tolerance: rotating in and out leaves ~1e-16 of rounding
      s = s < 0 ? 0 : s > 1 ? 1 : s;
      p[r] = s;
    }
    if (!outside) return null;
    const out = new Array(N).fill(0);
    for (let r = 0; r < N; r++) for (let i = 0; i < N; i++) out[i] += q[r * N + i] * p[r];
    return out;
  }

  /** Linear mode lives in a 1-unit box, so zoom the map in. */
  mapRange(): number { return this.linear ? 0.75 : 3; }

  get tilt() { return this.tiltV; }
  /** Rule space: 0 lines field space up with the rule axes; any other number picks a random rotation. */
  setTilt(tilt: number) {
    this.tiltV = tilt >>> 0;
    this.rot = null;
  }

  private rotation(): Float64Array {
    if (this.rot) return this.rot;
    const N = IDS.length;
    if (this.tiltV === 0) {
      const id = new Float64Array(N * N);
      for (let i = 0; i < N; i++) id[i * N + i] = 1;
      return (this.rot = id);
    }
    const rng = new Rng(this.tiltV);
    const gauss = () => {
      const u = Math.max(1e-9, rng.next()), v = rng.next();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    };
    const q = new Float64Array(N * N);
    for (let i = 0; i < q.length; i++) q[i] = gauss();
    for (let r = 0; r < N; r++) {
      for (let k = 0; k < r; k++) {
        let d = 0;
        for (let i = 0; i < N; i++) d += q[r * N + i] * q[k * N + i];
        for (let i = 0; i < N; i++) q[r * N + i] -= d * q[k * N + i];
      }
      let m = 0;
      for (let i = 0; i < N; i++) m += q[r * N + i] ** 2;
      m = Math.sqrt(m) || 1;
      for (let i = 0; i < N; i++) q[r * N + i] /= m;
    }
    return (this.rot = q);
  }

  /** Raw, roughly unit-variance field value of rule r at coord. */
  private raw(r: number, c: readonly number[]): number {
    if (this.source === 'axes') {
      const N = IDS.length, q = this.rotation();
      let p = 0; // how far along rule r's own axis this point is
      for (let i = 0; i < N; i++) p += q[r * N + i] * (c[i] ?? 0);
      return this.axisRaw(r, p);
    }
    const n = this.baseDims;
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
    for (let r = 0; r < IDS.length; r++) out[IDS[r]] = Math.round(this.str(this.raw(r, coord), thr) * 1000) / 1000;
    return out;
  }

  /**
   * Every source is a nonlinearity applied to a few linear projections of the
   * coordinate, and on a plane a projection is just base + a·du + b·dv — so a
   * whole map slice costs no n-dimensional dot products per pixel.
   */
  sampleGrid(center: readonly number[], U: readonly number[], V: readonly number[], range: number, res: number): Float32Array {
    const R = IDS.length;
    const out = new Float32Array(res * res * R);
    const thr = 2.0 - 1.6 * this.activity;
    const span = (k: number) => ((res > 1 ? k / (res - 1) : 0.5) * 2 - 1) * range;
    const proj = (w: ArrayLike<number>, o: number, n: number): [number, number, number] => {
      let p0 = 0, pu = 0, pv = 0;
      for (let i = 0; i < n; i++) { p0 += w[o + i] * (center[i] ?? 0); pu += w[o + i] * (U[i] ?? 0); pv += w[o + i] * (V[i] ?? 0); }
      return [p0, pu, pv];
    };
    const put = (r: number, f: (a: number, b: number) => number) => {
      for (let j = 0; j < res; j++) {
        const b = span(j);
        for (let i = 0; i < res; i++) out[(j * res + i) * R + r] = this.str(f(span(i), b), thr);
      }
    };
    const n = this.baseDims;
    for (let r = 0; r < R; r++) {
      if (this.source === 'axes') {
        const [p0, pu, pv] = proj(this.rotation(), r * R, R);
        put(r, (a, b) => this.axisRaw(r, p0 + a * pu + b * pv));
      } else if (this.source === 'image' && this.image) {
        const img = this.image, pb = r * (2 * n + 3);
        const [u0, uu, uv] = proj(this.proj, pb, n);
        const [v0, vu, vv] = proj(this.proj, pb + n, n);
        const ou = this.proj[pb + 2 * n], ov = this.proj[pb + 2 * n + 1], ch = this.proj[pb + 2 * n + 2];
        const st = this.stats[ch];
        put(r, (a, b) => (bilinear(img, pingPong(ou + u0 + a * uu + b * uv), pingPong(ov + v0 + a * vu + b * vv), ch) - st.mean) / st.std);
      } else {
        const forms = Array.from({ length: WAVES }, (_, k) => {
          const base = (r * WAVES + k) * (n + 1);
          const [p0, pu, pv] = proj(this.waves, base, n);
          return [p0 + this.waves[base + n], pu, pv];
        });
        const norm = Math.sqrt(WAVES / 2);
        put(r, (a, b) => {
          let s = 0;
          for (const [p0, pu, pv] of forms) s += Math.sin(p0 + a * pu + b * pv);
          return s / norm;
        });
      }
    }
    return out;
  }

  values(coord: readonly number[]): Float64Array {
    const out = new Float64Array(IDS.length);
    for (let r = 0; r < IDS.length; r++) out[r] = this.raw(r, coord);
    return out;
  }

  describe(): string {
    if (this.source === 'axes') {
      const space = this.tiltV === 0 ? 'rule space, aligned' : `rotated rule space (tilt ${this.tiltV.toString(16).padStart(8, '0')})`;
      const shape = this.wavesV === 0 ? 'linear, bounded 0–1' : `${this.wavesV} wave${this.wavesV === 1 ? '' : 's'}/axis · activity ${Math.round(this.activity * 100)}%`;
      return `${this.dims}D ${space} · ${shape}`;
    }
    return `${this.dims}D ${this.source === 'image' ? (this.hasImage() ? 'image' : 'placeholder image') : 'random'} noise · activity ${Math.round(this.activity * 100)}%`;
  }

  snapshot(): FieldState {
    return { seed: this.seedV, tilt: this.tiltV, source: this.source, activity: this.activity, axisWaves: this.wavesV, image: this.hasImage() ? stripImage(this.image!) : null };
  }

  restore(s: unknown): void {
    const st = s as FieldState;
    this.source = st.source === 'image' || st.source === 'axes' ? st.source : 'random';
    this.activity = st.activity ?? 0.45;
    this.setAxisWaves(st.axisWaves ?? AXIS_WAVES);
    this.seedV = 0xffffffff; // force rebuild
    this.setSeed(st.seed);
    this.setTilt(st.tilt ?? defaultTilt(this.seedV));
    this.setImage(st.image ?? null);
  }
}

/** The rotation a seed starts with (never 0, which means aligned). */
function defaultTilt(seed: number): number {
  return hash32('rule-rotation', seed) || 1;
}

/** Raw value → strength: off below the threshold, smoothstep up to full over 0.8. */
function strength(raw: number, thr: number): number {
  const t = (raw - thr) / 0.8;
  const c = t <= 0 ? 0 : t >= 1 ? 1 : t;
  return c * c * (3 - 2 * c);
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
