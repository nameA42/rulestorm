import { CATALOG, RULE_IDS, type RuleId, type RuleState } from '../../contracts/catalog';
import type { RuleCategory } from '../../contracts/rules';
import { playerFieldPos } from '../field';
import { axis, isTurned } from '../frame';
import type { Game } from '../Game';

const RES = 44; // samples per side
const RANGE = 3; // default field units from centre to edge (fields can ask for another)
const SIZE = 220; // css px

const CAT_COLOR: Record<RuleCategory, [number, number, number]> = {
  movement: [79, 195, 247], world: [129, 199, 132], enemies: [239, 83, 80],
  coins: [255, 213, 79], combat: [186, 104, 200], camera: [240, 98, 146],
};
const CAT_OF = new Map<RuleId, RuleCategory>(CATALOG.map((r) => [r.id as RuleId, r.category]));
const NAME_OF = new Map<RuleId, string>(CATALOG.map((r) => [r.id as RuleId, r.name]));

/**
 * The "field map": a 2D slice of the n-dimensional rule field through your
 * position, along your two map axes (picked with Z/X and C/V, and turned with
 * Shift+arrows / , .). Below it: which rules each axis pushes. Colour shows which
 * kinds of rules are strong there; brightness shows how much is going on.
 * Hover to see the rules at any point.
 */
export class FieldMap {
  private root: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private title: HTMLDivElement;
  private tip: HTMLDivElement;
  private buf = document.createElement('canvas');
  private lastKey = '';
  private lastDraw = 0;
  private center: number[] = [];
  private dims: [number, number] = [0, 1];
  /** Field directions of the map's → and ↓ axes. */
  private U: number[] = [];
  private V: number[] = [];
  private pushes: HTMLDivElement;
  /** Half-width of the slice, in field units. */
  private range = RANGE;
  shown = true;

  constructor(host: HTMLElement, private game: Game) {
    this.root = document.createElement('div');
    this.root.className = 'fieldmap';
    this.root.innerHTML = `
      <div class="fm-title"></div>
      <canvas width="${SIZE}" height="${SIZE}"></canvas>
      <div class="fm-legend">${(Object.keys(CAT_COLOR) as RuleCategory[])
        .map((c) => `<span><i style="background:rgb(${CAT_COLOR[c].join(',')})"></i>${c}</span>`).join('')}</div>
      <div class="fm-push"></div>
      <div class="fm-help">←↑↓→ travel · Shift+arrows turn · , . spin<br>Z/X C/V axes · B/N depth · O straighten · M hide</div>
      <div class="fm-tip"></div>`;
    host.appendChild(this.root);
    this.canvas = this.root.querySelector('canvas')!;
    this.title = this.root.querySelector('.fm-title')!;
    this.tip = this.root.querySelector('.fm-tip')!;
    this.pushes = this.root.querySelector('.fm-push')!;
    this.buf.width = RES;
    this.buf.height = RES;
    this.canvas.addEventListener('mousemove', (e) => this.hover(e));
    this.canvas.addEventListener('mouseleave', () => { this.tip.style.display = 'none'; });
    setInterval(() => this.update(), 80);
  }

  toggle() {
    this.shown = !this.shown;
    this.lastKey = '';
  }

  private me() {
    const w = this.game.world;
    const localId = this.game.deps.players.roster().find((p) => p.local)?.id;
    return w.players.find((p) => p.id === localId) ?? w.players[0] ?? null;
  }

  private update() {
    const active = this.game.ruleMode === 'field' && this.shown;
    this.root.style.display = active ? '' : 'none';
    if (!active) return;
    const me = this.me();
    const w = this.game.world;
    const field = this.game.deps.field;
    this.center = me ? playerFieldPos(me, this.game.fieldWalk) : [...w.fieldCoord];
    this.dims = me ? [me.dimX, me.dimY] : [0, 1];
    const [dx, dy] = this.dims;
    const n = this.center.length;
    this.U = me ? axis(me, n, dx) : unit(n, 0);
    this.V = me ? axis(me, n, dy) : unit(n, 1);
    const turned = me && isTurned(me);
    this.title.textContent = `Field map · ${field.dims}D · ±${field.mapRange?.() ?? RANGE} · axis ${dx} → / ${dy} ↓ · depth ${me?.dimZ ?? 2}${turned ? ' · turned' : ''}${me?.aimDir ? ' · steering…' : ''}`;

    // Re-render the slice only when it changed (it's ~2k field samples).
    this.range = field.mapRange?.() ?? RANGE;
    const key = `${this.range}|${this.center.map((v) => v.toFixed(2)).join(',')}|${dx},${dy}|${sig(this.U)}|${sig(this.V)}|${field.describe?.() ?? ''}`;
    const now = performance.now();
    if (key !== this.lastKey && now - this.lastDraw > 60) {
      this.lastKey = key;
      this.lastDraw = now;
      this.renderSlice();
      this.renderPushes();
    }
    this.drawMarkers();
  }

  /** A point on the map: centre + a·→axis + b·↓axis (a, b in field units). */
  private at(a: number, b: number): number[] {
    return this.center.map((v, i) => v + a * this.U[i] + b * this.V[i]);
  }

  private renderSlice() {
    const ctx = this.buf.getContext('2d')!;
    const img = ctx.createImageData(RES, RES);
    const field = this.game.deps.field;
    if (field.sampleGrid) {
      const grid = field.sampleGrid(this.center, this.U, this.V, this.range, RES);
      for (let k = 0; k < RES * RES; k++) {
        let [r, g, b] = colorOfGrid(grid, k * RULE_IDS.length);
        // Fields with a bounded region: darken the part you can't reach.
        if (field.bound) {
          const i = k % RES, j = Math.floor(k / RES);
          if (field.bound(this.at(((i / (RES - 1)) * 2 - 1) * this.range, ((j / (RES - 1)) * 2 - 1) * this.range))) {
            const stripe = (i + j) % 6 < 2;
            [r, g, b] = stripe ? [r * 0.35 + 30, g * 0.35 + 30, b * 0.35 + 34] : [r * 0.25, g * 0.25, b * 0.25];
          }
        }
        img.data[k * 4] = r; img.data[k * 4 + 1] = g; img.data[k * 4 + 2] = b; img.data[k * 4 + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      return;
    }
    for (let j = 0; j < RES; j++) {
      for (let i = 0; i < RES; i++) {
        const c = this.at(((i / (RES - 1)) * 2 - 1) * this.range, ((j / (RES - 1)) * 2 - 1) * this.range);
        const [r, g, b] = colorOf(this.game.deps.field.sample(c));
        const o = (j * RES + i) * 4;
        img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  /** Which rules travelling along each map axis strengthens (+) or weakens (−) most. */
  private renderPushes() {
    const field = this.game.deps.field;
    if (!field.values) { this.pushes.textContent = ''; return; }
    const h = 0.15;
    const line = (dir: number[], label: string) => {
      const a = field.values!(this.center.map((v, i) => v + h * dir[i]));
      const b = field.values!(this.center.map((v, i) => v - h * dir[i]));
      const slopes = RULE_IDS.map((id, r) => ({ id, d: a[r] - b[r] }));
      slopes.sort((x, y) => Math.abs(y.d) - Math.abs(x.d));
      // Only rules this axis really moves (relative to the strongest one).
      const top = slopes.slice(0, 3).filter((s) => Math.abs(s.d) > 0.2 * Math.abs(slopes[0].d) && Math.abs(s.d) > 1e-3);
      return `<div><b>${label}</b> ${top.length ? '' : '<span class="muted">nothing much</span>'}${top.map((s) => `<span class="${s.d > 0 ? 'up' : 'down'}">${s.d > 0 ? '+' : '−'}${NAME_OF.get(s.id)}</span>`).join(' ')}</div>`;
    };
    this.pushes.innerHTML = line(this.U, '→') + line(this.V, '↓');
  }

  private toPx(coord: readonly number[]): [number, number] {
    let a = 0, b = 0;
    for (let i = 0; i < this.center.length; i++) {
      const d = (coord[i] ?? 0) - this.center[i];
      a += d * this.U[i];
      b += d * this.V[i];
    }
    return [((a / this.range + 1) / 2) * SIZE, ((b / this.range + 1) / 2) * SIZE];
  }

  private drawMarkers() {
    const ctx = this.canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.buf, 0, 0, SIZE, SIZE);
    const w = this.game.world;
    const me = this.me();
    const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

    // Shared rule position (influence-weighted).
    const [sx, sy] = this.toPx(w.fieldCoord);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.arc(clampPx(sx), clampPx(sy), 9, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);

    for (const pl of w.players) {
      const [x, y] = this.toPx(playerFieldPos(pl, this.game.fieldWalk));
      const off = x < 0 || y < 0 || x > SIZE || y > SIZE;
      ctx.fillStyle = hex(pl.color);
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(clampPx(x), clampPx(y), pl === me ? 6 : off ? 3 : 5, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      if (pl.influence >= 0.05) {
        ctx.strokeStyle = hex(pl.color);
        ctx.beginPath(); ctx.arc(clampPx(x), clampPx(y), 8 + Math.min(14, pl.influence * 2), 0, Math.PI * 2); ctx.stroke();
      }
    }
  }

  private hover(e: MouseEvent) {
    const r = this.canvas.getBoundingClientRect();
    const u = (e.clientX - r.left) / r.width, v = (e.clientY - r.top) / r.height;
    const c = this.at((u * 2 - 1) * this.range, (v * 2 - 1) * this.range);
    const st = this.game.deps.field.sample(c);
    const top = RULE_IDS.filter((id) => st[id] > 0.02).sort((a, b) => st[b] - st[a]).slice(0, 7);
    this.tip.innerHTML = top.length
      ? top.map((id) => `<div><b>${Math.round(st[id] * 100)}%</b> ${NAME_OF.get(id)}</div>`).join('')
      : '<div class="muted">calm — no rules here</div>';
    this.tip.style.display = 'block';
    this.tip.style.left = `${e.clientX - this.root.getBoundingClientRect().left + 12}px`;
    this.tip.style.top = `${e.clientY - this.root.getBoundingClientRect().top + 12}px`;
  }
}

function unit(n: number, k: number): number[] {
  const v = new Array(n).fill(0);
  v[k] = 1;
  return v;
}

/** Short fingerprint of a direction, for change detection. */
function sig(v: readonly number[]): string {
  let a = 0, b = 0;
  for (let i = 0; i < v.length; i++) { a += v[i] * (i + 1); b += v[i] * ((i * 7919) % 101); }
  return `${a.toFixed(4)},${b.toFixed(4)}`;
}

function clampPx(v: number) {
  return Math.max(4, Math.min(SIZE - 4, v));
}

function colorOf(st: RuleState): [number, number, number] {
  return colorOfGrid(RULE_IDS.map((id) => st[id]), 0);
}

const CAT_RGB = RULE_IDS.map((id) => CAT_COLOR[CAT_OF.get(id)!]);

/** Colour of one grid cell: strengths at vals[o .. o + rule count). */
function colorOfGrid(vals: ArrayLike<number>, o: number): [number, number, number] {
  let r = 0, g = 0, b = 0, total = 0;
  for (let k = 0; k < CAT_RGB.length; k++) {
    const v = vals[o + k];
    if (v <= 0) continue;
    const c = CAT_RGB[k];
    r += c[0] * v; g += c[1] * v; b += c[2] * v; total += v;
  }
  if (total === 0) return [12, 14, 22];
  const bright = Math.min(1, 0.25 + total / 5);
  return [(r / total) * bright + 8, (g / total) * bright + 8, (b / total) * bright + 12];
}
