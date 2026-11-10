import type { Seed } from '../contracts/rules';
import type { SeedContext, SeedSource } from '../contracts/seed';
import { hash32 } from '../shared/rng';

export interface Point { x: number; y: number }

/**
 * The seed is the players' exact positions (rounded to `precision` px).
 * At 1px, every step you take is a brand-new rule set; stand still to keep
 * the rules you like. Order-independent: which player is where doesn't matter.
 */
export class ExactPositionSeedSource implements SeedSource {
  constructor(
    public baseSeed: number,
    private prec = 1,
  ) {}

  get precision() { return this.prec; }
  set precision(px: number) { this.prec = Math.max(1, Math.round(px)); }

  /** Seed for an arbitrary set of points (used directly and for timed samples). */
  seedFor(points: readonly Point[]): Seed {
    const key = points.map((p) => `${Math.round(p.x / this.prec)},${Math.round(p.y / this.prec)}`).sort();
    return hash32('exact', this.baseSeed, this.prec, ...key);
  }

  seedAt(ctx: SeedContext): Seed {
    return this.seedFor(ctx.players);
  }

  describe(ctx: SeedContext): string {
    return `${ExactPositionSeedSource.label(ctx.players)} @${this.prec}px`;
  }

  static label(points: readonly Point[]): string {
    return points.length ? points.map((p) => `(${Math.round(p.x)},${Math.round(p.y)})`).join(' ') : 'no players';
  }
}
