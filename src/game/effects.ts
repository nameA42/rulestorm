import { RULE_IDS, type RuleId, type RuleState } from '../contracts/catalog';
import { defaultParams, type Params } from './params';

/** How one rule bends the game's parameters, given its strength d in (0, 1]. */
export type Effect = (p: Params, d: number) => void;

/**
 * What every rule DOES. This is the only place a rule id is interpreted.
 * `satisfies Record<RuleId, Effect>` makes the compiler reject a catalog rule
 * with no effect, or an effect for a rule that doesn't exist.
 */
export const EFFECTS = {
  // ── movement
  'move.fast': (p, d) => { p.speed *= 1 + 1.5 * d; },
  'move.slow': (p, d) => { p.speed *= 1 - 0.6 * d; },
  'move.ice': (p, d) => { p.resp *= 1 - 0.93 * d; },
  'move.reverse': (p) => { p.intentReverse = true; },
  'move.rotate': (p, d) => { p.intentRotate += d * Math.PI * 0.85; },
  'move.gravity': (p, d) => { p.gravity += 2600 * d; },
  'move.wind': (p, d) => { p.wind += 1800 * d; },
  'move.drunk': (p, d) => { p.drunk += d; },
  'move.cant_stop': (p) => { p.cantStop = true; },
  'move.four_way': (p) => { p.fourWay = true; },
  'move.momentum': (p, d) => { p.momentum += d; },
  'move.dash_power': (p, d) => { p.dashPower *= 1 + 1.5 * d; },
  'move.no_dash': (p) => { p.dashEnabled = false; },
  'move.swap_axes': (p) => { p.intentSwap = true; },
  'move.tank': (p) => { p.tank = true; },
  'move.attract': (p, d) => { p.playerForce += 1400 * d; },
  'move.repel': (p, d) => { p.playerForce -= 1800 * d; },
  'move.teleport': (p, d) => { p.teleportRate += 0.35 * d; },
  'move.grow': (p, d) => { p.radius *= 1 + 1.3 * d; },
  'move.shrink': (p, d) => { p.radius *= 1 - 0.55 * d; },

  // ── world
  'world.wrap': (p) => { p.edges = 'wrap'; },
  'world.bouncy_edges': (p, d) => { p.edges = 'bouncy'; p.edgeBounce = 0.6 + 0.7 * d; },
  'world.lava_edges': (p) => { p.edges = 'lava'; },
  'world.shrink': (p, d) => { p.arenaScale *= 1 - 0.5 * d; },
  'world.walls_bouncy': (p, d) => { p.wallBounce = 0.6 + 0.8 * d; },
  'world.walls_ghost': (p) => { p.wallsSolid = false; },
  'world.walls_hurt': (p) => { p.wallsHurt = true; },
  'world.walls_drift': (p, d) => { p.wallDrift += 160 * d; },
  'world.walls_hidden': (p) => { p.wallsVisible = false; },
  'world.dark': (p, d) => { p.darkness = Math.max(p.darkness, d); },
  'world.lava_pools': (p, d) => { p.lavaPools = Math.round(2 + 6 * d); },
  'world.speed_pads': (p, d) => { p.speedPads = Math.round(3 + 5 * d); },
  'world.portals': (p) => { p.portals = true; },
  'world.conveyors': (p, d) => { p.conveyor += 1100 * d; },
  'world.black_hole': (p, d) => { p.blackHole += d; },
  'world.quake': (p, d) => { p.quake += d; },
  'world.night': (p, d) => { p.night = Math.max(p.night, d); },
  'world.ice_patches': (p, d) => { p.icePatches = Math.round(2 + 6 * d); },
  'world.mirror': (p) => { p.mirror = true; },
  'world.light_cycles': (p, d) => { p.lightCycle = 0.8 + 3.2 * d; },

  // ── enemies
  'enemy.swarm': (p, d) => { p.enemyCount = Math.round(6 + 16 * d); },
  'enemy.none': (p) => { p.enemyCount = 0; },
  'enemy.fast': (p, d) => { p.enemySpeed *= 1 + 1.5 * d; },
  'enemy.slow': (p, d) => { p.enemySpeed *= 1 - 0.7 * d; },
  'enemy.hunt': (p, d) => { p.enemyAI = 'hunt'; p.huntStrength = d; },
  'enemy.flee': (p) => { p.enemyAI = 'flee'; },
  'enemy.orbit': (p) => { p.enemyAI = 'orbit'; },
  'enemy.mimic': (p) => { p.enemyAI = 'mimic'; },
  'enemy.giant': (p, d) => { p.enemyRadius *= 1 + 1.6 * d; },
  'enemy.split': (p) => { p.enemySplit = true; },
  'enemy.harmless': (p) => { p.enemyContact = 'none'; },
  'enemy.healers': (p) => { p.enemyContact = 'heal'; },
  'enemy.edible': (p) => { p.enemyContact = 'eat'; },
  'enemy.breed': (p, d) => { p.enemyBreed += 0.08 * d; },
  'enemy.gunners': (p, d) => { p.enemyShoot += 0.15 + 0.6 * d; },
  'enemy.blink': (p, d) => { p.enemyBlink += 0.5 * d; },
  'enemy.cloaked': (p, d) => { p.enemyAlpha *= 1 - 0.88 * d; },
  'enemy.thieves': (p) => { p.enemyThieves = true; },

  // ── coins & score
  'coin.rain': (p, d) => { p.coinRate *= 1 + 5 * d; },
  'coin.magnet': (p, d) => { p.coinPull += d; },
  'coin.shy': (p, d) => { p.coinPull -= d; },
  'coin.bouncy': (p) => { p.coinBounce = true; },
  'coin.rich': (p, d) => { p.coinValue *= 1 + 4 * d; },
  'coin.cursed': (p) => { p.coinValue *= -1; },
  'coin.fleeting': (p, d) => { p.coinTTL *= 1 - 0.8 * d; },
  'coin.combo': (p, d) => { p.combo += d; },
  'coin.shared': (p) => { p.coinShared = true; },
  'coin.healing': (p) => { p.coinHeal = true; },
  'coin.explosive': (p) => { p.coinExplode = true; },
  'score.steal': (p) => { p.steal = true; },
  'score.drain': (p, d) => { p.scoreDrain += 0.5 + 3 * d; },
  'score.distance': (p, d) => { p.scoreDistance += d; },
  'score.stillness': (p) => { p.scoreStill = true; },
  'score.double': (p) => { p.scoreMult *= 2; },
  'score.hidden': (p) => { p.scoresHidden = true; },

  // ── combat & health
  'action.shoot': (p) => { p.actionMode = 'shoot'; },
  'action.shield': (p) => { p.actionMode = 'shield'; },
  'action.blink': (p) => { p.actionMode = 'blink'; },
  'combat.autofire': (p, d) => { p.autofire += 1 + 5 * d; },
  'combat.ricochet': (p) => { p.ricochet = true; },
  'combat.homing': (p, d) => { p.homing += d; },
  'combat.heavy': (p, d) => { p.bulletSize *= 1 + 2 * d; },
  'combat.friendly_fire': (p) => { p.friendlyFire = true; },
  'combat.cooldown': (p, d) => { p.cooldownMult *= 1 - 0.8 * d; },
  'hp.regen': (p, d) => { p.regen += 10 * d; },
  'hp.glass': (p) => { p.damageMult *= 5; },
  'hp.invulnerable': (p) => { p.damageMult = 0; },
  'hp.poison': (p, d) => { p.poison += 7 * d; },
  'player.ghosts': (p) => { p.playersCollide = false; },
  'player.tag': (p) => { p.tag = true; },

  // ── camera / visuals / time
  'cam.zoom_in': (p, d) => { p.zoom *= 1 + 0.9 * d; },
  'cam.zoom_out': (p, d) => { p.zoom *= 1 - 0.45 * d; },
  'cam.spin': (p, d) => { p.camSpin += d; },
  'cam.lag': (p, d) => { p.camLag = Math.max(p.camLag, d); },
  'vis.trails': (p, d) => { p.trails = Math.max(p.trails, d); },
  'vis.invert': (p) => { p.invert = true; },
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
  return p;
}
