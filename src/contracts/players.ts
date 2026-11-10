export type PlayerId = string;

/** What a player wants to do this tick. Movement axes are in [-1, 1]. */
export interface Intent {
  x: number;
  y: number;
  action: boolean;
}

export const IDLE: Intent = Object.freeze({ x: 0, y: 0, action: false });

export interface PlayerInfo {
  id: PlayerId;
  name: string;
  color: number;
  /** Controlled on this machine (vs. arriving over the network). */
  local: boolean;
}

/**
 * THE PLAYER-SYSTEM CONTRACT.
 * The game simulates every player from their inputs (lockstep-friendly), so
 * the player system only has to say who is playing and what they pressed.
 *
 *  - LocalPlayers: keyboard, answers immediately.
 *  - A network implementation would collect everyone's input for `tick`
 *    and return null until all of it has arrived; the game simply waits.
 */
export interface PlayerSystem {
  roster(): readonly PlayerInfo[];
  inputsFor(tick: number): ReadonlyMap<PlayerId, Intent> | null;
  dispose?(): void;
}
