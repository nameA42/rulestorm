import type { PlayerId } from './players';
import type { Seed } from './rules';

/** Everything a seed source may look at. */
export interface SeedContext {
  tick: number;
  players: readonly { id: PlayerId; x: number; y: number }[];
}

/** Optional drawing hints for the view: a zone grid and/or anchor points
 *  (positions the current seed was taken from). */
export interface SeedOverlay {
  cellSize?: number;
  activeCells?: readonly { cx: number; cy: number }[];
  points?: readonly { x: number; y: number }[];
}

/** Decides which seed the rules should be generated from right now.
 *  Must be deterministic given the sequence of contexts it is shown. */
export interface SeedSource {
  seedAt(ctx: SeedContext): Seed;
  /** Optional human-readable status for the HUD/debug panel. */
  describe?(ctx: SeedContext): string;
  /** Optional hint for the view (e.g. draw position zones). */
  overlay?(): SeedOverlay | null;
  /** Optional save support: plain-JSON state, and restoring it. */
  snapshot?(): unknown;
  restore?(state: unknown): void;
}
