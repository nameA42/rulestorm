import type { Seed } from '../contracts/rules';
import type { SeedContext, SeedSource } from '../contracts/seed';
import { hash32 } from '../shared/rng';

export const TICKS_PER_SECOND = 60;

interface TimedState { baseSeed: number; periodTicks: number; epoch: number; remaining: number; lastTick: number; paused: boolean }

/**
 * Rerolls the seed every `periodTicks` simulation ticks. Counts ticks (never
 * the wall clock), so every machine agrees. The countdown can be paused.
 */
export class TimedSeedSource implements SeedSource {
  epoch = 0;
  paused = false;
  private remaining: number;
  private lastTick = -1;

  constructor(
    public baseSeed: number,
    private period = 15 * TICKS_PER_SECOND,
  ) {
    this.remaining = period;
  }

  get periodTicks() { return this.period; }
  set periodTicks(t: number) {
    this.period = Math.max(1, Math.round(t));
    this.remaining = Math.min(this.remaining, this.period);
  }

  /** Ticks until the next change. */
  get ticksLeft() { return this.remaining; }

  seedAt(ctx: SeedContext): Seed {
    const d = ctx.tick - this.lastTick;
    // Only count normal forward steps; a jump (load, restart) just resyncs.
    if (this.lastTick >= 0 && d > 0 && d < 600 && !this.paused) this.remaining -= d;
    this.lastTick = ctx.tick;
    while (this.remaining <= 0) {
      this.epoch++;
      this.remaining += this.period;
    }
    return hash32('epoch', this.baseSeed, this.epoch);
  }

  describe(): string {
    const secs = Math.ceil(this.remaining / TICKS_PER_SECOND);
    return `epoch ${this.epoch} · ${this.paused ? `timer paused (${secs}s left)` : `next change in ${secs}s`}`;
  }

  /** Back to epoch 0 with a full countdown (new game). */
  reset(): void {
    this.epoch = 0;
    this.remaining = this.period;
    this.lastTick = -1;
  }

  /** Jump to the next epoch immediately. */
  rerollNow(): void {
    this.epoch++;
    this.remaining = this.period;
  }

  snapshot(): TimedState {
    return { baseSeed: this.baseSeed, periodTicks: this.period, epoch: this.epoch, remaining: this.remaining, lastTick: this.lastTick, paused: this.paused };
  }

  restore(s: unknown): void {
    const st = s as TimedState;
    Object.assign(this, { baseSeed: st.baseSeed, period: st.periodTicks, epoch: st.epoch, remaining: st.remaining, lastTick: st.lastTick, paused: st.paused });
  }
}
