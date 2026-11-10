export type PlayerId = string;

/** What a player wants to do this tick. Axes are in [-1, 1]. */
export interface Intent {
  /** Move in the arena. */
  x: number;
  y: number;
  action: boolean;
  /** Travel through the rule field along this player's two map dims. */
  navX?: number;
  navY?: number;
  /** Cycle the map's dims: -1 previous, +1 next (one tick per key press). */
  cycleX?: number;
  cycleY?: number;
  /** Turn the map: tilt its horizontal / vertical axis toward (+1) or away from (-1)
   *  the depth axis, or spin it within its own plane. Held, like movement. */
  turnX?: number;
  turnY?: number;
  spin?: number;
  /** Cycle the depth axis (one tick per press). */
  cycleZ?: number;
  /** Start turning the map's → axis toward the direction that strengthens this rule (one tick). */
  aim?: string;
  /** Straighten the map back to the field's own axes (one tick). */
  resetTurn?: boolean;
  /** Spend one banked coin / all of them on influence (one tick per press). */
  spend?: boolean;
  spendAll?: boolean;
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
