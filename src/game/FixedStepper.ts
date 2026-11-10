import { DT, type Game } from './Game';

const STEP_MS = DT * 1000;
const MAX_STEPS_PER_CALL = 8;
/** While waiting on the network, keep a little backlog so we can catch up. */
const MAX_BACKLOG_MS = 300;

/**
 * Runs the game's fixed 60 Hz tick from wall-clock time. Anyone can call
 * advance(): the renderer every frame, and a background heartbeat that keeps
 * going when the tab is hidden (browsers stop animation frames there, which
 * would freeze everyone in lockstep multiplayer). Time is consumed once, so
 * extra callers never double-step.
 */
export class FixedStepper {
  private acc = 0;
  private last = -1;
  /** True while the last attempt was blocked on other players' inputs. */
  waiting = false;
  /** Seconds we've been continuously waiting. */
  waitT = 0;

  constructor(private game: Game) {}

  advance(now = performance.now()) {
    if (this.last < 0) this.last = now;
    const elapsed = Math.min(250, Math.max(0, now - this.last));
    this.last = now;
    this.acc += elapsed;

    let steps = 0;
    let blocked = false;
    while (this.acc >= STEP_MS && steps < MAX_STEPS_PER_CALL) {
      if (!this.game.step()) {
        blocked = !this.game.paused;
        this.acc = this.game.paused ? 0 : Math.min(this.acc, MAX_BACKLOG_MS);
        break;
      }
      this.acc -= STEP_MS;
      steps++;
    }
    if (steps >= MAX_STEPS_PER_CALL) this.acc = Math.min(this.acc, MAX_BACKLOG_MS);
    if (steps > 0) this.waiting = false;
    else if (blocked) this.waiting = true;
    this.waitT = this.waiting ? this.waitT + elapsed / 1000 : 0;
  }
}

/**
 * A heartbeat from a Web Worker. Worker timers keep firing in background
 * tabs, where main-thread timers and animation frames are throttled or stopped.
 */
export function startHeartbeat(cb: () => void, intervalMs = 15): () => void {
  try {
    const src = `setInterval(() => postMessage(0), ${intervalMs});`;
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    const worker = new Worker(url);
    worker.onmessage = cb;
    return () => { worker.terminate(); URL.revokeObjectURL(url); };
  } catch {
    const id = setInterval(cb, intervalMs); // fallback: throttled when hidden, but better than nothing
    return () => clearInterval(id);
  }
}
