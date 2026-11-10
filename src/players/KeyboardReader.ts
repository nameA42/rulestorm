import type { Intent } from '../contracts/players';

/** Source of one player's input (keyboard in the browser, a script in tests). */
export interface InputSource {
  /** Called once per simulation tick. One-shot presses are reported once. */
  read(): Intent;
}

/** Keys the game owns (default browser behaviour is suppressed for these). */
const GAME_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyQ',
  'KeyB', 'KeyN', 'Comma', 'Period', 'KeyO',
  'ShiftLeft', 'ShiftRight',
]);

/**
 * The one local player:
 *   WASD move · Space action · arrows travel the rule field ·
 *   Z/X previous/next horizontal map dim · C/V previous/next vertical map dim ·
 *   Shift+arrows turn the map (tilt toward / away from the depth axis) ·
 *   , . spin the map · B/N previous/next depth axis · O straighten ·
 *   Q spend a coin · Shift+Q spend all coins.
 */
export class KeyboardReader implements InputSource {
  private held = new Set<string>();
  /** One-shot presses waiting to be read (so quick taps are never lost). */
  private presses: string[] = [];
  private pendingAim: string | null = null;
  private pendingReset = false;

  constructor(private target: Window = window) {
    target.addEventListener('keydown', this.down);
    target.addEventListener('keyup', this.up);
    target.addEventListener('blur', this.blur);
  }

  /** Steer toward a rule (from the panel): goes out with the next read. */
  aim(ruleId: string) { this.pendingAim = ruleId; }
  /** Straighten the map (from the panel). */
  straighten() { this.pendingReset = true; }

  read(): Intent {
    const k = (c: string) => this.held.has(c);
    const once = new Set(this.presses.splice(0));
    const shift = k('ShiftLeft') || k('ShiftRight');
    const ax = (k('ArrowRight') ? 1 : 0) - (k('ArrowLeft') ? 1 : 0);
    const ay = (k('ArrowDown') ? 1 : 0) - (k('ArrowUp') ? 1 : 0);
    const intent: Intent = {
      x: (k('KeyD') ? 1 : 0) - (k('KeyA') ? 1 : 0),
      y: (k('KeyS') ? 1 : 0) - (k('KeyW') ? 1 : 0),
      action: k('Space') || once.has('Space'),
      navX: shift ? 0 : ax,
      navY: shift ? 0 : ay,
      turnX: shift ? ax : 0,
      turnY: shift ? ay : 0,
      spin: (k('Period') ? 1 : 0) - (k('Comma') ? 1 : 0),
      cycleX: (once.has('KeyX') ? 1 : 0) - (once.has('KeyZ') ? 1 : 0),
      cycleY: (once.has('KeyV') ? 1 : 0) - (once.has('KeyC') ? 1 : 0),
      cycleZ: (once.has('KeyN') ? 1 : 0) - (once.has('KeyB') ? 1 : 0),
      resetTurn: once.has('KeyO') || this.pendingReset,
      spend: once.has('KeyQ'),
      spendAll: once.has('ShiftQ'),
    };
    if (this.pendingAim) intent.aim = this.pendingAim;
    this.pendingAim = null;
    this.pendingReset = false;
    return intent;
  }

  dispose() {
    this.target.removeEventListener('keydown', this.down);
    this.target.removeEventListener('keyup', this.up);
    this.target.removeEventListener('blur', this.blur);
  }

  private down = (e: KeyboardEvent) => {
    const el = e.target as HTMLElement | null;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return;
    if (!GAME_KEYS.has(e.code) || e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault();
    this.held.add(e.code);
    if (!e.repeat && this.presses.length < 32) this.presses.push(e.code === 'KeyQ' && e.shiftKey ? 'ShiftQ' : e.code);
  };
  private up = (e: KeyboardEvent) => this.held.delete(e.code);
  private blur = () => this.held.clear();
}
