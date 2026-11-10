import type { Intent, PlayerId } from '../../contracts/players';
import type { Params } from '../params';
import { arenaBounds, type World } from '../world';
import { stepBullets } from './bulletSim';
import { stepCoins } from './coinSim';
import { stepEnemies } from './enemySim';
import { stepInteractions } from './interactions';
import { stepPlayers } from './playerSim';

/**
 * Advance the world one fixed tick. Pure function of (world, params, inputs):
 * no clocks, no Math.random — so lockstep multiplayer and replays just work.
 */
export function stepWorld(w: World, p: Params, inputs: ReadonlyMap<PlayerId, Intent>, baseDt: number) {
  const dt = baseDt * p.timeScale;
  w.tick++;
  w.time += dt;

  for (const wall of w.walls) {
    const off = Math.sin(w.time * 0.7 + wall.phase) * p.wallDrift;
    wall.x = wall.bx + (wall.axis === 0 ? off : 0);
    wall.y = wall.by + (wall.axis === 1 ? off : 0);
  }

  const B = arenaBounds(p.arenaScale);
  stepPlayers(w, p, inputs, dt, B);
  stepEnemies(w, p, dt, B);
  stepCoins(w, p, dt, B);
  stepBullets(w, p, dt, B);
  stepInteractions(w, p, dt);
}
