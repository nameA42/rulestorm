/**
 * The knobs the simulation and view read. Rebuilt every tick from defaults,
 * then each rule's effect bends them by its strength (see effects.ts).
 * Every knob is continuous, so every rule can be partly on.
 */
export interface Params {
  // players — movement
  speed: number;
  resp: number; // how fast velocity reaches the target (1/s); low = icy
  radius: number;
  inputTurn: number; // constant rotation of input, radians
  swap: number; // 0..1 blend of x/y input into each other
  drunk: number;
  coast: number; // 0..1: fraction of speed kept with no input
  fourWay: number; // 0..1 snap toward cardinal directions
  tank: number; // 0..1 blend toward tank steering
  momentum: number;
  gravity: number;
  wind: number;
  playerForce: number; // + attract, - repel
  teleportRate: number; // per second
  ghost: number; // 0..1 players pass through each other
  tag: number; // 0..1 tag intensity

  // players — action button (weights blend; dash gets what's left)
  dashPower: number;
  shootW: number;
  shieldW: number;
  blinkW: number;
  cooldownMult: number;

  // world
  edgeWrap: number; // 0..1 fraction of each edge (centered) that wraps
  edgeBounce: number; // restitution at solid edges
  edgeBurn: number; // damage/s touching a solid edge
  arenaScale: number;
  wallBounce: number;
  wallSolid: number; // 1 = solid, lower = wade through
  wallShock: number; // damage per touch
  wallDrift: number;
  wallAlpha: number;
  lavaPools: number;
  speedPads: number;
  portalSize: number; // 0..1
  conveyor: number;
  blackHole: number;
  quake: number;
  icePatches: number;
  lightCycle: number; // trail lifetime, seconds

  // enemies
  enemyCount: number;
  enemySpeed: number;
  huntW: number;
  fleeW: number;
  orbitW: number;
  mimicW: number;
  enemyRadius: number;
  splitChance: number;
  harm: number; // contact damage multiplier
  healTouch: number; // 0..1
  eatTouch: number; // 0..1
  enemyBreed: number;
  enemyShoot: number;
  enemyBlink: number;
  enemyAlpha: number;
  thieves: number;

  // coins & score
  coinRate: number;
  coinPull: number; // + magnet, - shy
  coinBounce: number; // 0..1
  coinValue: number; // may go negative (cursed)
  coinTTL: number;
  combo: number;
  coinShare: number; // fraction given to every other player
  coinHeal: number;
  coinBlast: number; // explosion impulse 0..1
  steal: number; // fraction stolen on bump
  scoreDrain: number;
  scoreDistance: number;
  scoreStill: number; // points per second standing still
  scoreMult: number;
  scoreBlur: number; // 0..1 HUD fuzziness

  // combat & health
  autofire: number;
  ricochet: number; // 0..1 speed kept per bounce
  homing: number;
  bulletSize: number;
  friendlyFire: number; // 0..1 damage scale
  regen: number;
  damageMult: number;
  poison: number;

  // camera / visuals / time
  zoom: number;
  camSpin: number;
  camLag: number;
  trails: number;
  invert: number;
  hue: number;
  pixelate: number;
  blur: number;
  darkness: number;
  night: number;
  mirror: number; // 0..1 page-flip
  timeScale: number;
}

export function defaultParams(): Params {
  return {
    speed: 260, resp: 12, radius: 16, inputTurn: 0, swap: 0, drunk: 0, coast: 0, fourWay: 0, tank: 0,
    momentum: 0, gravity: 0, wind: 0, playerForce: 0, teleportRate: 0, ghost: 0, tag: 0,

    dashPower: 1, shootW: 0, shieldW: 0, blinkW: 0, cooldownMult: 1,

    edgeWrap: 0, edgeBounce: 0, edgeBurn: 0, arenaScale: 1,
    wallBounce: 0, wallSolid: 1, wallShock: 0, wallDrift: 0, wallAlpha: 1,
    lavaPools: 0, speedPads: 0, portalSize: 0, conveyor: 0, blackHole: 0, quake: 0,
    icePatches: 0, lightCycle: 0,

    enemyCount: 5, enemySpeed: 1, huntW: 0, fleeW: 0, orbitW: 0, mimicW: 0, enemyRadius: 1,
    splitChance: 0, harm: 1, healTouch: 0, eatTouch: 0, enemyBreed: 0, enemyShoot: 0,
    enemyBlink: 0, enemyAlpha: 1, thieves: 0,

    coinRate: 0.9, coinPull: 0, coinBounce: 0, coinValue: 1, coinTTL: 14, combo: 0,
    coinShare: 0, coinHeal: 0, coinBlast: 0, steal: 0,
    scoreDrain: 0, scoreDistance: 0, scoreStill: 0, scoreMult: 1, scoreBlur: 0,

    autofire: 0, ricochet: 0, homing: 0, bulletSize: 1, friendlyFire: 0,
    regen: 0, damageMult: 1, poison: 0,

    zoom: 1, camSpin: 0, camLag: 0, trails: 0, invert: 0, hue: 0, pixelate: 0,
    blur: 0, darkness: 0, night: 0, mirror: 0, timeScale: 1,
  };
}

/** Horizontal view scale for the mirror page-flip: 1 → -1, never fully flat. */
export function mirrorScale(p: Params): number {
  const s = Math.cos(Math.PI * p.mirror);
  return Math.sign(s || 1) * Math.max(0.2, Math.abs(s));
}
