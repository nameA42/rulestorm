import type { Intent, PlayerId, PlayerInfo, PlayerSystem } from '../contracts/players';
import type { InputSource } from './KeyboardReader';

const ME: PlayerInfo = { id: 'p1', name: 'P1', color: 0x4fc3f7, local: true };

/**
 * Offline play: one player on this machine. (Multiplayer is online-only —
 * see net/NetPlayers.) Knows nothing about the game.
 */
export class LocalPlayers implements PlayerSystem {
  private lastTick = -1;
  private current: Intent = { x: 0, y: 0, action: false };
  private readonly list: readonly PlayerInfo[] = [ME];

  constructor(private input: InputSource) {}

  roster(): readonly PlayerInfo[] {
    return this.list;
  }

  inputsFor(tick: number): ReadonlyMap<PlayerId, Intent> {
    if (tick !== this.lastTick) {
      this.current = this.input.read(); // once per tick, so one-shot presses count once
      this.lastTick = tick;
    }
    return new Map([[ME.id, this.current]]);
  }
}
