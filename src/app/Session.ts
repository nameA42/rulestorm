import type { Game } from '../game/Game';
import { NetPlayers } from '../net/NetPlayers';
import { hostRoom, joinRoom } from '../net/peerTransport';
import type { InputSource } from '../players/KeyboardReader';
import type { LocalPlayers } from '../players/LocalPlayers';
import type { PlayerSwitch } from '../players/PlayerSwitch';
import type { NoiseFieldRules } from '../rules/field/NoiseFieldRules';
import type { SeedModes } from '../seed/SeedModes';
import { applyCommand, captureState, restoreState, stateHash, type AppCommand, type AppState, type SaveData } from './commands';

export type SessionMode = 'offline' | 'hosting' | 'joining' | 'client';

/**
 * Owns "who is playing and how": offline couch play or P2P online, and routes
 * every shared-state change through dispatch() so online peers stay in sync.
 */
export class Session implements AppState {
  mode: SessionMode = 'offline';
  room: string | null = null;
  error: string | null = null;
  net: NetPlayers | null = null;
  private teardown: (() => void) | null = null;
  private listeners = new Set<() => void>();

  constructor(
    readonly game: Game,
    readonly seeds: SeedModes,
    readonly field: NoiseFieldRules,
    public worldSeed: number,
    private players: PlayerSwitch,
    private local: LocalPlayers,
    private makeInput: () => InputSource & { dispose?(): void },
  ) {}

  /** Change shared state: now (offline) or on a shared tick (online). */
  dispatch(cmd: AppCommand) {
    if (this.net) {
      this.net.submit(cmd);
      return;
    }
    applyCommand(this, cmd);
    // Instant feedback even while paused.
    this.game.syncRoster();
    this.game.refreshRules();
  }

  capture(): SaveData {
    return captureState(this, this.players.roster().map((p) => p.id));
  }

  onChange(cb: () => void) {
    this.listeners.add(cb);
  }

  private changed() {
    for (const cb of this.listeners) cb();
  }

  private hooks() {
    return {
      tick: () => this.game.world.tick,
      snapshot: () => this.capture(),
      restore: (s: unknown) => restoreState(this, s as SaveData),
      apply: (c: unknown) => applyCommand(this, c as AppCommand),
      hash: () => stateHash(this),
    };
  }

  async host(): Promise<void> {
    if (this.mode !== 'offline') return;
    this.mode = 'hosting';
    this.error = null;
    this.changed();
    try {
      const h = await hostRoom();
      const input = this.makeInput();
      const net = NetPlayers.host(this.hooks(), input);
      h.onLink((l) => net.addLink(l));
      net.onStatus(() => this.changed());
      this.net = net;
      this.room = h.room;
      this.players.current = net;
      this.teardown = () => { net.close(); h.destroy(); };
      this.changed();
    } catch (e) {
      this.mode = 'offline';
      this.error = `Couldn't host: ${(e as Error).message ?? e}`;
      this.changed();
    }
  }

  async join(room: string): Promise<void> {
    if (this.mode !== 'offline') this.leave();
    this.mode = 'joining';
    this.room = room;
    this.error = null;
    this.changed();
    try {
      const j = await joinRoom(room);
      const input = this.makeInput();
      const net = NetPlayers.client(this.hooks(), input, j.link);
      net.onStatus(() => {
        if (!net.connected && this.net === net) {
          this.error = 'Disconnected from host';
          this.leave();
        }
        this.changed();
      });
      this.net = net;
      this.mode = 'client';
      this.players.current = net;
      this.teardown = () => { net.close(); j.destroy(); };
      this.changed();
    } catch (e) {
      this.mode = 'offline';
      this.room = null;
      this.error = `Couldn't join: ${(e as Error).message ?? e}`;
      this.changed();
    }
  }

  /** Back to offline couch play, keeping the current world. */
  leave() {
    const t = this.teardown;
    this.teardown = null;
    this.net = null;
    this.room = null;
    this.mode = 'offline';
    this.players.current = this.local;
    t?.();
    this.game.syncRoster();
    this.changed();
  }

  shareLink(): string | null {
    if (!this.room) return null;
    const u = new URL(location.href);
    u.search = '';
    u.searchParams.set('room', this.room);
    return u.toString();
  }
}
