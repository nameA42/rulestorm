import type { Intent } from '../contracts/players';

/** Source of one player's input (keyboard in the browser, a script in tests). */
export interface InputSource {
  read(): Intent;
}

/** One player on this keyboard: WASD or arrows to move, Space or Enter to act. */
export class KeyboardReader implements InputSource {
  private held = new Set<string>();

  constructor(private target: Window = window) {
    target.addEventListener('keydown', this.down);
    target.addEventListener('keyup', this.up);
    target.addEventListener('blur', this.blur);
  }

  read(): Intent {
    const k = (...codes: string[]) => codes.some((c) => this.held.has(c));
    return {
      x: (k('KeyD', 'ArrowRight') ? 1 : 0) - (k('KeyA', 'ArrowLeft') ? 1 : 0),
      y: (k('KeyS', 'ArrowDown') ? 1 : 0) - (k('KeyW', 'ArrowUp') ? 1 : 0),
      action: k('Space', 'Enter', 'NumpadEnter'),
    };
  }

  dispose() {
    this.target.removeEventListener('keydown', this.down);
    this.target.removeEventListener('keyup', this.up);
    this.target.removeEventListener('blur', this.blur);
  }

  private down = (e: KeyboardEvent) => {
    const el = e.target as HTMLElement | null;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return;
    this.held.add(e.code);
  };
  private up = (e: KeyboardEvent) => this.held.delete(e.code);
  private blur = () => this.held.clear();
}
