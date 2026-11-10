import type { RuleId } from '../contracts/catalog';
import type { RuleCategory } from '../contracts/rules';
import type { Game, GameSnapshot, SectionMode } from '../game/Game';
import type { SeedMode, SeedModes } from '../seed/SeedModes';
import { TICKS_PER_SECOND } from '../seed/TimedSeedSource';
import { hash32 } from '../shared/rng';

/**
 * Every change to shared, deterministic state is a command. Offline they run
 * immediately; online they're scheduled onto a tick and run on every peer at
 * that same tick, so nobody desyncs. All payloads are plain JSON.
 */
export type AppCommand =
  | { k: 'setBase'; seed: number }
  | { k: 'setMode'; mode: SeedMode }
  | { k: 'setPeriod'; seconds: number }
  | { k: 'setZone'; px: number }
  | { k: 'setPrecision'; px: number }
  | { k: 'timerPaused'; paused: boolean }
  | { k: 'skip' }
  | { k: 'override'; id: RuleId; v: number | null }
  | { k: 'section'; cat: RuleCategory; mode: SectionMode | null }
  | { k: 'clearForced' }
  | { k: 'restart'; worldSeed: number }
  | { k: 'load'; data: SaveData };

/** A full match: what a save slot holds and what a joining peer receives. */
export interface SaveData {
  version: 1;
  worldSeed: number;
  game: GameSnapshot;
  seeds: unknown;
  players: string[];
}

export interface AppState {
  game: Game;
  seeds: SeedModes;
  worldSeed: number;
}

export function captureState(s: AppState, players: string[]): SaveData {
  return { version: 1, worldSeed: s.worldSeed, game: s.game.snapshot(), seeds: s.seeds.snapshot(), players };
}

export function restoreState(s: AppState, data: SaveData) {
  s.worldSeed = data.worldSeed;
  s.seeds.restore(data.seeds);
  s.game.restore(data.game);
}

/** Cheap fingerprint of the deterministic state, for desync detection. */
export function stateHash(s: AppState): number {
  return hash32(JSON.stringify({ ...s.game.world, events: [] }), s.game.seed ?? 0, JSON.stringify([...s.game.overrides, ...s.game.sections]));
}

export function applyCommand(s: AppState, c: AppCommand) {
  const { game, seeds } = s;
  switch (c.k) {
    case 'setBase': seeds.baseSeed = c.seed >>> 0; break;
    case 'setMode': seeds.mode = c.mode; break;
    case 'setPeriod': seeds.timer.periodTicks = c.seconds * TICKS_PER_SECOND; break;
    case 'setZone': seeds.position.cellSize = c.px; break;
    case 'setPrecision': seeds.exact.precision = c.px; break;
    case 'timerPaused': seeds.timer.paused = c.paused; break;
    case 'skip': seeds.timer.rerollNow(); break;
    case 'override': game.setOverride(c.id, c.v); break;
    case 'section': game.setSection(c.cat, c.mode); break;
    case 'clearForced': game.clearOverrides(); break;
    case 'restart':
      s.worldSeed = c.worldSeed;
      seeds.baseSeed = c.worldSeed;
      game.restart(c.worldSeed);
      seeds.reset();
      break;
    case 'load':
      if (c.data?.version === 1) restoreState(s, c.data);
      break;
  }
}
