import type { Seed } from '../contracts/rules';
import type { SeedContext, SeedOverlay, SeedSource } from '../contracts/seed';
import { hash32 } from '../shared/rng';
import { ExactPositionSeedSource, type Point } from './ExactPositionSeedSource';
import { PositionSeedSource } from './PositionSeedSource';
import { TimedSeedSource } from './TimedSeedSource';

/**
 * - timer     every N seconds
 * - position  when a player enters a new zone
 * - both      zones + timer
 * - constant  the players' exact positions, every tick
 * - timerpos  the players' exact positions, sampled once per timer period
 */
export type SeedMode = 'timer' | 'position' | 'both' | 'constant' | 'timerpos';
export const SEED_MODES: readonly SeedMode[] = ['timer', 'position', 'both', 'constant', 'timerpos'];

interface ModesState {
  mode: SeedMode;
  timer: unknown;
  position: unknown;
  precision?: number;
  sampled?: Point[] | null;
  sampledEpoch?: number;
}

/**
 * A SeedSource that switches between several strategies. The game only sees
 * a SeedSource; it never knows which mode is on.
 */
export class SeedModes implements SeedSource {
  readonly timer: TimedSeedSource;
  readonly position: PositionSeedSource;
  readonly exact: ExactPositionSeedSource;
  /** Positions captured at the start of the current timer period (timerpos). */
  private sampled: Point[] | null = null;
  private sampledEpoch = -1;
  private lastMode: SeedMode;

  constructor(baseSeed: number, public mode: SeedMode = 'timer') {
    this.timer = new TimedSeedSource(baseSeed);
    this.position = new PositionSeedSource(baseSeed);
    this.exact = new ExactPositionSeedSource(baseSeed);
    this.lastMode = mode;
  }

  get baseSeed() { return this.timer.baseSeed; }
  set baseSeed(s: number) {
    this.timer.baseSeed = s;
    this.position.baseSeed = s;
    this.exact.baseSeed = s;
  }

  seedAt(ctx: SeedContext): Seed {
    // Advance every strategy every tick so switching modes never jumps.
    const t = this.timer.seedAt(ctx);
    const z = this.position.seedAt(ctx);
    const here = ctx.players.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }));
    const switchedIn = this.mode === 'timerpos' && this.lastMode !== 'timerpos';
    if (!this.sampled || this.timer.epoch !== this.sampledEpoch || switchedIn) {
      this.sampled = here;
      this.sampledEpoch = this.timer.epoch;
    }
    this.lastMode = this.mode;

    switch (this.mode) {
      case 'timer': return t;
      case 'position': return z;
      case 'both': return hash32('both', t, z);
      case 'constant': return this.exact.seedFor(here);
      case 'timerpos': return hash32('timerpos', this.exact.seedFor(this.sampled));
    }
  }

  describe(ctx: SeedContext): string {
    switch (this.mode) {
      case 'timer': return this.timer.describe();
      case 'position': return this.position.describe();
      case 'both': return `${this.position.describe()} · ${this.timer.describe()}`;
      case 'constant': return `live position ${this.exact.describe(ctx)}`;
      case 'timerpos': return `sampled ${ExactPositionSeedSource.label(this.sampled ?? [])} @${this.exact.precision}px · ${this.timer.describe()}`;
    }
  }

  overlay(): SeedOverlay | null {
    switch (this.mode) {
      case 'position':
      case 'both': return this.position.overlay();
      case 'timerpos': return { points: this.sampled ?? [] };
      default: return null;
    }
  }

  reset(): void {
    this.timer.reset();
    this.position.reset();
    this.sampled = null;
    this.sampledEpoch = -1;
  }

  snapshot(): ModesState {
    return {
      mode: this.mode,
      timer: this.timer.snapshot(),
      position: this.position.snapshot(),
      precision: this.exact.precision,
      sampled: this.sampled,
      sampledEpoch: this.sampledEpoch,
    };
  }

  restore(s: unknown): void {
    const st = s as ModesState;
    this.mode = SEED_MODES.includes(st.mode) ? st.mode : 'timer';
    this.lastMode = this.mode;
    this.timer.restore(st.timer);
    this.position.restore(st.position);
    this.exact.baseSeed = this.timer.baseSeed;
    this.exact.precision = st.precision ?? 1;
    this.sampled = st.sampled ?? null;
    this.sampledEpoch = st.sampledEpoch ?? -1;
  }
}
