import { RULE_IDS, type RuleId, type RuleState } from '../contracts/catalog';
import { defaultParams, type Params } from './params';

/** How one rule bends the game's parameters, given its strength d in (0, 1]. */
export type Effect = (p: Params, d: number) => void;

/**
 * What every rule DOES, as a continuous function of its strength.
 * `satisfies Record<RuleId, Effect>` makes the compiler reject a catalog rule
 * with no effect, or an effect for a rule that doesn't exist.
 */
export const EFFECTS = {
  // ── movement
  'move.fast': (p, d) => { p.speed *= 1 + 1.5 * d; },
  'move.slow': (p, d) => { p.speed *= 1 - 0.6 * d; },
  'move.ice': (p, d) => { p.resp *= 1 - 0.93 * d; },
  'move.reverse': (p, d) => { p.inputTurn += Math.PI * d; },
  'move.rotate': (p, d) => { p.inputTurn += (Math.PI / 2) * d; },
  'move.gravity': (p, d) => { p.gravity += 1800 * d; },
  'move.wind': (p, d) => { p.wind += 1800 * d; },
  'move.drunk': (p, d) => { p.drunk += d; },
  'move.cant_stop': (p, d) => { p.coast = Math.max(p.coast, d); },
  'move.four_way': (p, d) => { p.fourWay = Math.max(p.fourWay, d); },
  'move.momentum': (p, d) => { p.momentum += d; },
  'move.dash_power': (p, d) => { p.dashPower *= 1 + 1.5 * d; },
  'move.no_dash': (p, d) => { p.dashPower *= 1 - d; },
  'move.swap_axes': (p, d) => { p.swap = Math.max(p.swap, d); },
  'move.tank': (p, d) => { p.tank = Math.max(p.tank, d); },
  'move.attract': (p, d) => { p.playerForce += 1400 * d; },
  'move.repel': (p, d) => { p.playerForce -= 1800 * d; },
  'move.teleport': (p, d) => { p.teleportRate += 0.35 * d; },
  'move.grow': (p, d) => { p.radius *= 1 + 1.3 * d; },
  'move.shrink': (p, d) => { p.radius *= 1 - 0.55 * d; },

  // ── world
  'world.wrap': (p, d) => { p.edgeWrap = Math.max(p.edgeWrap, d); },
  'world.bouncy_edges': (p, d) => { p.edgeBounce += 1.3 * d; },
  'world.lava_edges': (p, d) => { p.edgeBurn += 40 * d; p.edgeBounce += 0.5 * d; },
  'world.shrink': (p, d) => { p.arenaScale *= 1 - 0.5 * d; },
  'world.walls_bouncy': (p, d) => { p.wallBounce += 1.4 * d; },
  'world.walls_ghost': (p, d) => { p.wallSolid *= 1 - d; },
  'world.walls_hurt': (p, d) => { p.wallShock += 12 * d; },
  'world.walls_drift': (p, d) => { p.wallDrift += 160 * d; },
  'world.walls_hidden': (p, d) => { p.wallAlpha *= 1 - d; },
  'world.dark': (p, d) => { p.darkness = Math.max(p.darkness, d); },
  'world.lava_pools': (p, d) => { p.lavaPools += 8 * d; },
  'world.speed_pads': (p, d) => { p.speedPads += 8 * d; },
  'world.portals': (p, d) => { p.portalSize = Math.max(p.portalSize, d); },
  'world.conveyors': (p, d) => { p.conveyor += 1100 * d; },
  'world.black_hole': (p, d) => { p.blackHole += d; },
  'world.quake': (p, d) => { p.quake += d; },
  'world.night': (p, d) => { p.night = Math.max(p.night, d); },
  'world.ice_patches': (p, d) => { p.icePatches += 8 * d; },
  'world.mirror': (p, d) => { p.mirror = Math.max(p.mirror, d); },
  'world.light_cycles': (p, d) => { p.lightCycle += 4 * d; },

  // ── enemies
  'enemy.swarm': (p, d) => { p.enemyCount += 17 * d; },
  'enemy.none': (p, d) => { p.enemyCount *= 1 - d; },
  'enemy.fast': (p, d) => { p.enemySpeed *= 1 + 1.5 * d; },
  'enemy.slow': (p, d) => { p.enemySpeed *= 1 - 0.7 * d; },
  'enemy.hunt': (p, d) => { p.huntW += d; },
  'enemy.flee': (p, d) => { p.fleeW += d; },
  'enemy.orbit': (p, d) => { p.orbitW += d; },
  'enemy.mimic': (p, d) => { p.mimicW += d; },
  'enemy.giant': (p, d) => { p.enemyRadius *= 1 + 1.6 * d; },
  'enemy.split': (p, d) => { p.splitChance = Math.max(p.splitChance, d); },
  'enemy.harmless': (p, d) => { p.harm *= 1 - d; },
  'enemy.healers': (p, d) => { p.healTouch = Math.max(p.healTouch, d); p.harm *= 1 - d; },
  'enemy.edible': (p, d) => { p.eatTouch = Math.max(p.eatTouch, d); p.harm *= 1 - d; },
  'enemy.breed': (p, d) => { p.enemyBreed += 0.08 * d; },
  'enemy.gunners': (p, d) => { p.enemyShoot += 0.75 * d; },
  'enemy.blink': (p, d) => { p.enemyBlink += 0.5 * d; },
  'enemy.cloaked': (p, d) => { p.enemyAlpha *= 1 - 0.88 * d; },
  'enemy.thieves': (p, d) => { p.thieves = Math.max(p.thieves, d); },

  // ── coins & score
  'coin.rain': (p, d) => { p.coinRate *= 1 + 5 * d; },
  'coin.magnet': (p, d) => { p.coinPull += d; },
  'coin.shy': (p, d) => { p.coinPull -= d; },
  'coin.bouncy': (p, d) => { p.coinBounce = Math.max(p.coinBounce, d); },
  'coin.rich': (p, d) => { p.coinValue *= 1 + 4 * d; },
  'coin.cursed': (p, d) => { p.coinValue *= 1 - 2 * d; },
  'coin.fleeting': (p, d) => { p.coinTTL *= 1 - 0.8 * d; },
  'coin.combo': (p, d) => { p.combo += d; },
  'coin.shared': (p, d) => { p.coinShare = Math.max(p.coinShare, d); },
  'coin.healing': (p, d) => { p.coinHeal += 15 * d; },
  'coin.explosive': (p, d) => { p.coinBlast = Math.max(p.coinBlast, d); },
  'score.steal': (p, d) => { p.steal += 0.1 * d; },
  'score.drain': (p, d) => { p.scoreDrain += 3.5 * d; },
  'score.distance': (p, d) => { p.scoreDistance += d; },
  'score.stillness': (p, d) => { p.scoreStill += 2 * d; },
  'score.double': (p, d) => { p.scoreMult *= 1 + d; },
  'score.hidden': (p, d) => { p.scoreBlur = Math.max(p.scoreBlur, d); },

  // ── combat & health
  'action.shoot': (p, d) => { p.shootW = Math.max(p.shootW, d); },
  'action.shield': (p, d) => { p.shieldW = Math.max(p.shieldW, d); },
  'action.blink': (p, d) => { p.blinkW = Math.max(p.blinkW, d); },
  'combat.autofire': (p, d) => { p.autofire += 6 * d; },
  'combat.ricochet': (p, d) => { p.ricochet = Math.max(p.ricochet, d); },
  'combat.homing': (p, d) => { p.homing += d; },
  'combat.heavy': (p, d) => { p.bulletSize *= 1 + 2 * d; },
  'combat.friendly_fire': (p, d) => { p.friendlyFire = Math.max(p.friendlyFire, d); },
  'combat.cooldown': (p, d) => { p.cooldownMult *= 1 - 0.8 * d; },
  'hp.regen': (p, d) => { p.regen += 10 * d; },
  'hp.glass': (p, d) => { p.damageMult *= 1 + 4 * d; },
  'hp.invulnerable': (p, d) => { p.damageMult *= 1 - d; },
  'hp.poison': (p, d) => { p.poison += 7 * d; },
  'player.ghosts': (p, d) => { p.ghost = Math.max(p.ghost, d); },
  'player.tag': (p, d) => { p.tag = Math.max(p.tag, d); },

  // ── camera / visuals / time
  'cam.zoom_in': (p, d) => { p.zoom *= 1 + 0.9 * d; },
  'cam.zoom_out': (p, d) => { p.zoom *= 1 - 0.45 * d; },
  'cam.spin': (p, d) => { p.camSpin += d; },
  'cam.lag': (p, d) => { p.camLag = Math.max(p.camLag, d); },
  'vis.trails': (p, d) => { p.trails = Math.max(p.trails, d); },
  'vis.invert': (p, d) => { p.invert = Math.max(p.invert, d); },
  'vis.hue': (p, d) => { p.hue = Math.max(p.hue, d); },
  'vis.pixelate': (p, d) => { p.pixelate = Math.max(p.pixelate, d); },
  'vis.blur': (p, d) => { p.blur = Math.max(p.blur, d); },
  'time.hyper': (p, d) => { p.timeScale *= 1 + 0.8 * d; },
} satisfies Record<RuleId, Effect>;

const ORDERED: readonly [RuleId, Effect][] = RULE_IDS.map((id) => [id, EFFECTS[id]]);

/** Defaults, then every active rule in catalog order. */
export function buildParams(state: RuleState): Params {
  const p = defaultParams();
  for (const [id, fx] of ORDERED) {
    const d = state[id];
    if (d > 0.001) fx(p, d);
  }
  p.enemyCount = Math.max(0, p.enemyCount);
  p.harm = Math.max(0, p.harm);
  return p;
}
