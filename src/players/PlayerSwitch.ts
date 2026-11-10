import type { Intent, PlayerId, PlayerInfo, PlayerSystem } from '../contracts/players';

/** A PlayerSystem that forwards to whichever one is active (local ↔ online). */
export class PlayerSwitch implements PlayerSystem {
  constructor(public current: PlayerSystem) {}
  roster(): readonly PlayerInfo[] {
    return this.current.roster();
  }
  inputsFor(tick: number): ReadonlyMap<PlayerId, Intent> | null {
    return this.current.inputsFor(tick);
  }
}
