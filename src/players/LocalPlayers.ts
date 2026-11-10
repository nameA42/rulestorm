import type { Intent, PlayerId, PlayerInfo, PlayerSystem } from '../contracts/players';

interface Binding {
  info: Omit<PlayerInfo, 'local'>;
  up: string[];
  down: string[];
  left: string[];
  right: string[];
  action: string[];
  /** Joins immediately, or on the first key press. */
  autoJoin: boolean;
}

const BINDINGS: Binding[] = [
  {
    info: { id: 'p1', name: 'P1', color: 0x4fc3f7 },
    up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'], action: ['Space'],
    autoJoin: true,
  },
  {
    info: { id: 'p2', name: 'P2', color: 0xffb74d },
    up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'],
    action: ['Enter', 'NumpadEnter', 'ShiftRight'],
    autoJoin: false,
  },
];

const HANDLED = new Set(BINDINGS.flatMap((b) => [...b.up, ...b.down, ...b.left, ...b.right, ...b.action]));

/**
 * Couch players on one keyboard. Knows nothing about the game — it only
 * reports who is playing and what keys they hold.
 */
export class LocalPlayers implements PlayerSystem {
  private held = new Set<string>();
  private joined = new Set<PlayerId>();
  private cachedRoster: PlayerInfo[] = [];

  constructor(private target: Window = window) {
    for (const b of BINDINGS) if (b.autoJoin) this.joined.add(b.info.id);
    this.rebuildRoster();
    target.addEventListener('keydown', this.onDown);
    target.addEventListener('keyup', this.onUp);
    target.addEventListener('blur', this.onBlur);
  }

  roster(): readonly PlayerInfo[] {
    return this.cachedRoster;
  }

  inputsFor(_tick: number): ReadonlyMap<PlayerId, Intent> {
    const out = new Map<PlayerId, Intent>();
    for (const b of BINDINGS) {
      if (!this.joined.has(b.info.id)) continue;
      const k = (keys: string[]) => keys.some((c) => this.held.has(c));
      out.set(b.info.id, {
        x: (k(b.right) ? 1 : 0) - (k(b.left) ? 1 : 0),
        y: (k(b.down) ? 1 : 0) - (k(b.up) ? 1 : 0),
        action: k(b.action),
      });
    }
    return out;
  }

  /** Is this binding currently playing? */
  isJoined(id: PlayerId): boolean {
    return this.joined.has(id);
  }

  /** Every player this keyboard can host (joined or not). */
  slots(): readonly { id: PlayerId; name: string; autoJoin: boolean }[] {
    return BINDINGS.map((b) => ({ id: b.info.id, name: b.info.name, autoJoin: b.autoJoin }));
  }

  join(id: PlayerId): void {
    if (!BINDINGS.some((b) => b.info.id === id)) return;
    this.joined.add(id);
    this.rebuildRoster();
  }

  /** Remove a player. They can rejoin by pressing one of their keys. */
  leave(id: PlayerId): void {
    this.joined.delete(id);
    const b = BINDINGS.find((x) => x.info.id === id);
    if (b) for (const c of [...b.up, ...b.down, ...b.left, ...b.right, ...b.action]) this.held.delete(c);
    this.rebuildRoster();
  }

  /** Replace the whole roster (used when loading a save). */
  setJoined(ids: readonly PlayerId[]): void {
    this.joined = new Set(ids.filter((id) => BINDINGS.some((b) => b.info.id === id)));
    this.rebuildRoster();
  }

  dispose(): void {
    this.target.removeEventListener('keydown', this.onDown);
    this.target.removeEventListener('keyup', this.onUp);
    this.target.removeEventListener('blur', this.onBlur);
  }

  private rebuildRoster() {
    this.cachedRoster = BINDINGS.filter((b) => this.joined.has(b.info.id)).map((b) => ({ ...b.info, local: true }));
  }

  private onDown = (e: KeyboardEvent) => {
    const el = e.target as HTMLElement | null;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return;
    if (!HANDLED.has(e.code)) return;
    e.preventDefault();
    this.held.add(e.code);
    if (e.repeat) return;
    for (const b of BINDINGS) {
      if (this.joined.has(b.info.id)) continue;
      if ([...b.up, ...b.down, ...b.left, ...b.right, ...b.action].includes(e.code)) {
        this.joined.add(b.info.id);
        this.rebuildRoster();
      }
    }
  };

  private onUp = (e: KeyboardEvent) => {
    this.held.delete(e.code);
  };

  private onBlur = () => this.held.clear();
}
