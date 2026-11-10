import { CATALOG, RULE_IDS, type RuleId, type RuleState } from '../../contracts/catalog';
import type { RuleCategory } from '../../contracts/rules';
import { playerFieldPos } from '../field';
import type { Game } from '../Game';

const RES = 44; // samples per side
const RANGE = 3; // field units from centre to edge
const SIZE = 220; // css px

const CAT_COLOR: Record<RuleCategory, [number, number, number]> = {
  movement: [79, 195, 247], world: [129, 199, 132], enemies: [239, 83, 80],
  coins: [255, 213, 79], combat: [186, 104, 200], camera: [240, 98, 146],
};
const CAT_OF = new Map<RuleId, RuleCategory>(CATALOG.map((r) => [r.id as RuleId, r.category]));
const NAME_OF = new Map<RuleId, string>(CATALOG.map((r) => [r.id as RuleId, r.name]));

/**
 * The "field map": a 2D slice of the n-dimensional rule field through your
 * position, along the two dims you've picked (Z/X and C/V). Colour shows which
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
  shown = true;

  constructor(host: HTMLElement, private game: Game) {
    this.root = document.createElement('div');
    this.root.className = 'fieldmap';
    this.root.innerHTML = `
      <div class="fm-title"></div>
      <canvas width="${SIZE}" height="${SIZE}"></canvas>
      <div class="fm-legend">${(Object.keys(CAT_COLOR) as RuleCategory[])
        .map((c) => `<span><i style="background:rgb(${CAT_COLOR[c].join(',')})"></i>${c}</span>`).join('')}</div>
      <div class="fm-help">←↑↓→ travel · Z/X C/V switch dims · M hide</div>
      <div class="fm-tip"></div>`;
    host.appendChild(this.root);
    this.canvas = this.root.querySelector('canvas')!;
    this.title = this.root.querySelector('.fm-title')!;
    this.tip = this.root.querySelector('.fm-tip')!;
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
    this.title.textContent = `Field map · ${field.dims}D · dim ${dx} → / dim ${dy} ↓`;

    // Re-render the slice only when it changed (it's ~2k field samples).
    const key = `${this.center.map((v) => v.toFixed(2)).join(',')}|${dx},${dy}|${field.describe?.() ?? ''}`;
    const now = performance.now();
    if (key !== this.lastKey && now - this.lastDraw > 60) {
      this.lastKey = key;
      this.lastDraw = now;
      this.renderSlice();
    }
    this.drawMarkers();
  }

  private renderSlice() {
    const [dx, dy] = this.dims;
    const ctx = this.buf.getContext('2d')!;
    const img = ctx.createImageData(RES, RES);
    const c = [...this.center];
    for (let j = 0; j < RES; j++) {
      for (let i = 0; i < RES; i++) {
        c[dx] = this.center[dx] + ((i / (RES - 1)) * 2 - 1) * RANGE;
        c[dy] = this.center[dy] + ((j / (RES - 1)) * 2 - 1) * RANGE;
        const [r, g, b] = colorOf(this.game.deps.field.sample(c));
        const o = (j * RES + i) * 4;
        img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  private toPx(coord: readonly number[]): [number, number] {
    const [dx, dy] = this.dims;
    const u = ((coord[dx] - this.center[dx]) / RANGE + 1) / 2;
    const v = ((coord[dy] - this.center[dy]) / RANGE + 1) / 2;
    return [u * SIZE, v * SIZE];
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
    const [dx, dy] = this.dims;
    const c = [...this.center];
    c[dx] += (u * 2 - 1) * RANGE;
    c[dy] += (v * 2 - 1) * RANGE;
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

function clampPx(v: number) {
  return Math.max(4, Math.min(SIZE - 4, v));
}

function colorOf(st: RuleState): [number, number, number] {
  let r = 0, g = 0, b = 0, total = 0;
  for (const id of RULE_IDS) {
    const v = st[id];
    if (v <= 0) continue;
    const c = CAT_COLOR[CAT_OF.get(id)!];
    r += c[0] * v; g += c[1] * v; b += c[2] * v; total += v;
  }
  if (total === 0) return [12, 14, 22];
  const bright = Math.min(1, 0.25 + total / 5);
  return [(r / total) * bright + 8, (g / total) * bright + 8, (b / total) * bright + 12];
}
