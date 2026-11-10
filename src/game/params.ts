/**
 * The knobs the simulation and view read. Rebuilt every tick from defaults,
 * then each active rule's effect bends them (see effects.ts).
 */
export interface Params {
  // players
  speed: number;
  resp: number; // how fast velocity reaches the target (1/s); low = icy
  radius: number;
  intentReverse: boolean;
  intentSwap: boolean;
  intentRotate: number; // radians
  drunk: number;
  cantStop: boolean;
  fourWay: boolean;
  tank: boolean;
  momentum: number;
  dashPower: number;
  dashEnabled: boolean;
  actionMode: 'dash' | 'shoot' | 'shield' | 'blink';
  cooldownMult: number;
  gravity: number;
  wind: number;
  playerForce: number; // + attract, - repel
  teleportRate: number; // per second
  playersCollide: boolean;
  tag: boolean;

  // world
  edges: 'solid' | 'wrap' | 'bouncy' | 'lava';
  edgeBounce: number;
  arenaScale: number;
  wallBounce: number;
  wallsSolid: boolean;
  wallsHurt: boolean;
  wallDrift: number;
  wallsVisible: boolean;
  lavaPools: number; // how many of the pool spots are live
  speedPads: number;
  portals: boolean;
  conveyor: number;
  blackHole: number;
  quake: number;
  icePatches: number;
  lightCycle: number; // trail lifetime, seconds

  // enemies
  enemyCount: number;
  enemySpeed: number;
  enemyAI: 'wander' | 'hunt' | 'flee' | 'orbit' | 'mimic';
  huntStrength: number;
  enemyRadius: number;
  enemySplit: boolean;
  enemyContact: 'damage' | 'none' | 'heal' | 'eat';
  enemyBreed: number;
  enemyShoot: number;
  enemyBlink: number;
  enemyAlpha: number;
  enemyThieves: boolean;

  // coins & score
  coinRate: number; // spawns per second
  coinPull: number; // + magnet, - shy
  coinBounce: boolean;
  coinValue: number;
  coinTTL: number;
  combo: number;
  coinShared: boolean;
  coinHeal: boolean;
  coinExplode: boolean;
  steal: boolean;
  scoreDrain: number;
  scoreDistance: number;
  scoreStill: boolean;
  scoreMult: number;
  scoresHidden: boolean;

  // combat & health
  autofire: number; // shots per second, 0 = off
  ricochet: boolean;
  homing: number;
  bulletSize: number;
  friendlyFire: boolean;
  regen: number;
  damageMult: number;
  poison: number;

  // camera / visuals / time (read by the view; timeScale by the sim)
  zoom: number;
  camSpin: number;
  camLag: number;
  trails: number;
  invert: boolean;
  hue: number;
  pixelate: number;
  blur: number;
  darkness: number;
  night: number;
  mirror: boolean;
  timeScale: number;
}

export function defaultParams(): Params {
  return {
    speed: 260, resp: 12, radius: 16,
    intentReverse: false, intentSwap: false, intentRotate: 0, drunk: 0,
    cantStop: false, fourWay: false, tank: false, momentum: 0,
    dashPower: 1, dashEnabled: true, actionMode: 'dash', cooldownMult: 1,
    gravity: 0, wind: 0, playerForce: 0, teleportRate: 0,
    playersCollide: true, tag: false,

    edges: 'solid', edgeBounce: 0, arenaScale: 1,
    wallBounce: 0, wallsSolid: true, wallsHurt: false, wallDrift: 0, wallsVisible: true,
    lavaPools: 0, speedPads: 0, portals: false, conveyor: 0, blackHole: 0, quake: 0,
    icePatches: 0, lightCycle: 0,

    enemyCount: 5, enemySpeed: 1, enemyAI: 'wander', huntStrength: 0, enemyRadius: 1,
    enemySplit: false, enemyContact: 'damage', enemyBreed: 0, enemyShoot: 0,
    enemyBlink: 0, enemyAlpha: 1, enemyThieves: false,

    coinRate: 0.9, coinPull: 0, coinBounce: false, coinValue: 1, coinTTL: 14, combo: 0,
    coinShared: false, coinHeal: false, coinExplode: false, steal: false,
    scoreDrain: 0, scoreDistance: 0, scoreStill: false, scoreMult: 1, scoresHidden: false,

    autofire: 0, ricochet: false, homing: 0, bulletSize: 1, friendlyFire: false,
    regen: 0, damageMult: 1, poison: 0,

    zoom: 1, camSpin: 0, camLag: 0, trails: 0, invert: false, hue: 0, pixelate: 0,
    blur: 0, darkness: 0, night: 0, mirror: false, timeScale: 1,
  };
}
