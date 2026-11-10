import type { PlayerId } from '../contracts/players';
import type { Seed } from '../contracts/rules';
import type { SeedContext, SeedOverlay, SeedSource } from '../contracts/seed';
import { hash32 } from '../shared/rng';

interface Cell { cx: number; cy: number }
interface PositionState { baseSeed: number; cellSize: number; margin: number; cells: [PlayerId, Cell][] }

/**
 * The seed comes from WHERE the players are. The arena is cut into square
 * zones; the set of occupied zones (order-independent) + the base seed gives
 * the seed. Step into a new zone → new rules.
 *
 * Hysteresis: you must be `margin` px inside a new zone before it counts, so
 * hovering on a boundary doesn't flicker the rules.
 */
export class PositionSeedSource implements SeedSource {
  private cells = new Map<PlayerId, Cell>();

  constructor(
    public baseSeed: number,
    private size = 300,
    public margin = 28,
  ) {}

  get cellSize() { return this.size; }
  set cellSize(s: number) {
    this.size = Math.max(40, Math.round(s));
    this.cells.clear(); // re-zone everyone
  }

  seedAt(ctx: SeedContext): Seed {
    const present = new Set<PlayerId>();
    for (const p of ctx.players) {
      present.add(p.id);
      const cur = this.cells.get(p.id);
      if (!cur || !this.within(p.x, p.y, cur, this.margin)) {
        this.cells.set(p.id, { cx: Math.floor(p.x / this.size), cy: Math.floor(p.y / this.size) });
      }
    }
    for (const id of [...this.cells.keys()]) if (!present.has(id)) this.cells.delete(id);
    const keys = [...this.cells.values()].map((c) => `${c.cx},${c.cy}`).sort();
    return hash32('zones', this.baseSeed, this.size, ...keys);
  }

  /** Is (x,y) still inside cell c, extended outward by `slack` px? */
  private within(x: number, y: number, c: Cell, slack: number) {
    const s = this.size;
    return x >= c.cx * s - slack && x < (c.cx + 1) * s + slack && y >= c.cy * s - slack && y < (c.cy + 1) * s + slack;
  }

  reset(): void {
    this.cells.clear();
  }

  describe(): string {
    const z = [...this.cells.values()].map((c) => `(${c.cx},${c.cy})`).join(' ');
    return `zones ${this.size}px · ${z || 'none'}`;
  }

  overlay(): SeedOverlay {
    return { cellSize: this.size, activeCells: [...this.cells.values()] };
  }

  snapshot(): PositionState {
    return { baseSeed: this.baseSeed, cellSize: this.size, margin: this.margin, cells: [...this.cells.entries()] };
  }

  restore(s: unknown): void {
    const st = s as PositionState;
    this.baseSeed = st.baseSeed;
    this.size = st.cellSize;
    this.margin = st.margin;
    this.cells = new Map(st.cells);
  }
}
