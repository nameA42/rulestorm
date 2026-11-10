import { IDLE, type Intent, type PlayerId } from '../../contracts/players';
import type { Params } from '../params';
import { emit, freeSpot, insideAnyWall, MAX_HP, partial, type Bounds, type PlayerEnt, type World } from '../world';
import { addScore, fire, heal, hurt, respawn } from './combat';
import {
  applyEdges, applyFields, clamp, collideWalls, edgeBounce, inBlackHole, limitSpeed, windDir,
} from './physics';

/** Field units per second when travelling with the arrow keys. */
export const NAV_SPEED = 0.9;
/** Influence halves every this many seconds. */
export const INFLUENCE_HALF_LIFE = 15;

/** Turn raw input into a movement direction, applying every control-mangling rule. */
function steer(w: World, p: Params, pl: PlayerEnt, raw: Intent, dt: number): { dx: number; dy: number } {
  let ix = raw.x, iy = raw.y;
  if (p.swap > 0) [ix, iy] = [ix + (iy - ix) * p.swap, iy + (ix - iy) * p.swap];
  let rot = p.inputTurn;
  if (p.drunk > 0) {
    rot += Math.sin(w.time * 2.1 + pl.wobble) * 1.1 * p.drunk + Math.sin(w.time * 5.3 + pl.wobble * 2) * 0.4 * p.drunk;
  }
  if (rot !== 0) {
    const c = Math.cos(rot), s = Math.sin(rot);
    [ix, iy] = [ix * c - iy * s, ix * s + iy * c];
  }
  const mag = Math.hypot(ix, iy);
  if (mag > 1) { ix /= mag; iy /= mag; }

  let dx = ix, dy = iy;
  // Tank steering, blended in.
  pl.heading += ix * 3.4 * p.tank * dt;
  if (p.tank > 0) {
    const thrust = -iy;
    dx = ix * (1 - p.tank) + Math.cos(pl.heading) * thrust * p.tank;
    dy = iy * (1 - p.tank) + Math.sin(pl.heading) * thrust * p.tank;
  }
  // Snap toward the nearest cardinal direction.
  if (p.fourWay > 0 && Math.hypot(dx, dy) > 0.1) {
    const a = Math.atan2(dy, dx);
    const snapped = Math.round(a / (Math.PI / 2)) * (Math.PI / 2);
    let diff = snapped - a;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const na = a + diff * p.fourWay;
    const m = Math.hypot(dx, dy);
    dx = Math.cos(na) * m; dy = Math.sin(na) * m;
  }
  // Coast: with no input, keep a fraction of the last heading.
  if (p.coast > 0 && Math.hypot(dx, dy) < 0.1 && (pl.lastDirX || pl.lastDirY)) {
    dx = pl.lastDirX * p.coast; dy = pl.lastDirY * p.coast;
  }
  return { dx, dy };
}

/** The action button blends dash / shot / shield / blink by their weights. */
function act(w: World, p: Params, pl: PlayerEnt, action: boolean, B: Bounds) {
  const pressed = action && !pl.prevAction;
  pl.prevAction = action;
  const fx = Math.cos(pl.facing), fy = Math.sin(pl.facing);

  if (p.shootW > 0.05 && action && pl.shootCd <= 0) {
    fire(w, p, pl);
    pl.shootCd = (0.22 / p.shootW) * p.cooldownMult;
  }
  if (!pressed || pl.actionCd > 0) return;
  const dashW = Math.max(0, 1 - Math.max(p.shootW, p.shieldW, p.blinkW)) * p.dashPower;
  let used = false;
  if (dashW > 0.05) {
    pl.vx += fx * 680 * dashW;
    pl.vy += fy * 680 * dashW;
    pl.dashT = 0.18;
    emit(w, { type: 'pad', x: pl.x, y: pl.y, color: pl.color });
    used = true;
  }
  if (p.shieldW > 0.05) {
    pl.shieldT = Math.max(pl.shieldT, 1.2 * p.shieldW);
    used = true;
  }
  if (p.blinkW > 0.05) {
    emit(w, { type: 'teleport', x: pl.x, y: pl.y, color: pl.color });
    for (let dist = 240 * p.blinkW; dist > 0; dist -= 40) {
      const x = clamp(pl.x + fx * dist, B.x0 + pl.r, B.x1 - pl.r);
      const y = clamp(pl.y + fy * dist, B.y0 + pl.r, B.y1 - pl.r);
      if (p.wallSolid < 0.97 || !insideAnyWall(w, x, y, pl.r)) { pl.x = x; pl.y = y; break; }
    }
    emit(w, { type: 'teleport', x: pl.x, y: pl.y, color: pl.color });
    used = true;
  }
  if (used) pl.actionCd = (0.8 + 1.7 * p.shieldW + 0.2 * p.blinkW) * p.cooldownMult;
}

/** Field exploration: arrows travel, dim keys re-slice the map, Q spends coins. */
function explore(w: World, pl: PlayerEnt, raw: Intent, dt: number) {
  const n = w.fieldDims;
  if (pl.coord.length !== n) pl.coord = [...w.fieldOrigin];
  const cycle = (cur: number, other: number, dir: number) => {
    let d = cur;
    do d = (d + dir + n) % n; while (d === other && n > 1);
    return d;
  };
  if (raw.cycleX) pl.dimX = cycle(pl.dimX, pl.dimY, Math.sign(raw.cycleX));
  if (raw.cycleY) pl.dimY = cycle(pl.dimY, pl.dimX, Math.sign(raw.cycleY));
  if (raw.navX) pl.coord[pl.dimX] += clamp(raw.navX, -1, 1) * NAV_SPEED * dt;
  if (raw.navY) pl.coord[pl.dimY] += clamp(raw.navY, -1, 1) * NAV_SPEED * dt;

  if (raw.spendAll && pl.wallet > 0) {
    pl.influence += pl.wallet;
    emit(w, { type: 'spend', x: pl.x, y: pl.y, color: pl.color, value: pl.wallet });
    pl.wallet = 0;
  } else if (raw.spend && pl.wallet > 0) {
    pl.wallet--;
    pl.influence += 1;
    emit(w, { type: 'spend', x: pl.x, y: pl.y, color: pl.color, value: 1 });
  }
  pl.influence *= Math.pow(0.5, dt / INFLUENCE_HALF_LIFE);
  if (pl.influence < 0.01) pl.influence = 0;
}

export function stepPlayers(w: World, p: Params, inputs: ReadonlyMap<PlayerId, Intent>, dt: number, B: Bounds) {
  const wind = windDir(w.time);
  for (const pl of w.players) {
    pl.r = p.radius;
    pl.invulnT = Math.max(0, pl.invulnT - dt);
    pl.actionCd -= dt;
    pl.shootCd -= dt;
    pl.shieldT = Math.max(0, pl.shieldT - dt);
    pl.dashT = Math.max(0, pl.dashT - dt);
    pl.comboT -= dt;
    pl.padCd -= dt;
    pl.portalCd -= dt;
    pl.stealCd -= dt;

    const raw = inputs.get(pl.id) ?? IDLE;
    explore(w, pl, raw, dt); // works while dead, too

    if (!pl.alive) {
      pl.respawnT -= dt;
      if (pl.respawnT <= 0) respawn(w, p, pl);
      continue;
    }

    pl.lastIntent = { x: raw.x, y: raw.y, action: raw.action };
    const { dx, dy } = steer(w, p, pl, raw, dt);
    const len = Math.hypot(dx, dy);
    if (len > 0.1) {
      const ux = dx / len, uy = dy / len;
      if (ux * pl.lastDirX + uy * pl.lastDirY < 0.5) pl.moveT = 0; // sharp turn kills momentum
      pl.moveT += dt;
      pl.facing = Math.atan2(uy, ux);
      pl.lastDirX = ux; pl.lastDirY = uy;
    } else {
      pl.moveT = 0;
    }

    // Velocity chases the desired velocity; ice and dashing loosen the grip.
    const speed = p.speed * (1 + p.momentum * 1.5 * Math.min(pl.moveT / 2.5, 1));
    let resp = p.resp;
    for (let i = 0; i < w.ice.length; i++) {
      const k = partial(p.icePatches, i);
      if (k <= 0) break;
      const z = w.ice[i];
      if (Math.hypot(pl.x - z.x, pl.y - z.y) < z.r * k) { resp *= 1 - 0.92 * k; break; }
    }
    if (pl.dashT <= 0) {
      const k = 1 - Math.exp(-resp * dt);
      pl.vx += (dx * speed - pl.vx) * k;
      pl.vy += (dy * speed - pl.vy) * k;
    }

    pl.vy += p.gravity * dt;
    pl.vx += wind.x * p.wind * dt;
    pl.vy += wind.y * p.wind * dt;
    applyFields(w, p, pl, dt);

    act(w, p, pl, raw.action, B);
    if (p.autofire > 0.05) {
      pl.autoT -= dt;
      if (pl.autoT <= 0) { fire(w, p, pl); pl.autoT = 1 / p.autofire; }
    }

    limitSpeed(pl, 2400);
    const px = pl.x, py = pl.y;
    pl.x += pl.vx * dt;
    pl.y += pl.vy * dt;

    if (collideWalls(w, pl, p, dt, p.wallBounce) && p.wallShock > 0.1) hurt(w, p, pl, p.wallShock, 0.4);
    if (applyEdges(pl, B, p.edgeWrap, edgeBounce(p)) && p.edgeBurn > 0) hurt(w, p, pl, p.edgeBurn * dt);

    stepZones(w, p, pl, B, dt);

    if (inBlackHole(p, pl)) {
      emit(w, { type: 'teleport', x: pl.x, y: pl.y, color: 0x000000 });
      const s = freeSpot(w, pl.r, B, [], 0);
      pl.x = s.x; pl.y = s.y; pl.vx = pl.vy = 0;
      hurt(w, p, pl, 15, 0.8);
    }
    if (p.teleportRate > 0 && w.rng.chance(p.teleportRate * dt)) {
      emit(w, { type: 'teleport', x: pl.x, y: pl.y, color: pl.color });
      const s = freeSpot(w, pl.r, B, [], 0);
      pl.x = s.x; pl.y = s.y;
      emit(w, { type: 'teleport', x: pl.x, y: pl.y, color: pl.color });
    }

    if (p.lightCycle > 0.05) {
      pl.trailT -= dt;
      if (pl.trailT <= 0 && w.trails.length < 1500) {
        w.trails.push({ x: pl.x, y: pl.y, owner: pl.id, ttl: p.lightCycle });
        pl.trailT = 0.04;
      }
    }

    // Movement-based scoring
    const moved = Math.hypot(pl.x - px, pl.y - py);
    if (p.scoreDistance > 0) {
      pl.distAcc += moved;
      while (pl.distAcc >= 100) { pl.distAcc -= 100; addScore(pl, p, p.scoreDistance); }
    }
    if (p.scoreStill > 0 && moved < 0.3) addScore(pl, p, p.scoreStill * dt);

    if (p.regen > 0 && pl.hp < MAX_HP) heal(pl, p.regen * dt);
    if (p.poison > 0) hurt(w, p, pl, p.poison * dt);
    if (p.scoreDrain > 0 && pl.score > 0) pl.score = Math.max(0, pl.score - p.scoreDrain * dt);
  }
}

function stepZones(w: World, p: Params, pl: PlayerEnt, B: Bounds, dt: number) {
  for (let i = 0; i < w.pools.length; i++) {
    const k = partial(p.lavaPools, i);
    if (k <= 0) break;
    const z = w.pools[i];
    if (Math.hypot(pl.x - z.x, pl.y - z.y) < z.r * k) { hurt(w, p, pl, 35 * dt); break; }
  }
  if (pl.padCd <= 0) {
    for (let i = 0; i < w.pads.length; i++) {
      const k = partial(p.speedPads, i);
      if (k <= 0) break;
      const z = w.pads[i];
      if (Math.hypot(pl.x - z.x, pl.y - z.y) < z.r * k + pl.r * 0.5) {
        pl.vx = Math.cos(z.angle) * 950 * k;
        pl.vy = Math.sin(z.angle) * 950 * k;
        pl.dashT = 0.28 * k;
        pl.padCd = 0.6;
        emit(w, { type: 'pad', x: z.x, y: z.y, color: 0x4dd0e1 });
        break;
      }
    }
  }
  if (p.portalSize > 0.05 && pl.portalCd <= 0) {
    const reach = 32 * p.portalSize;
    for (const pair of w.portals) {
      const from = Math.hypot(pl.x - pair.a.x, pl.y - pair.a.y) < reach ? pair.a
        : Math.hypot(pl.x - pair.b.x, pl.y - pair.b.y) < reach ? pair.b : null;
      if (!from) continue;
      const to = from === pair.a ? pair.b : pair.a;
      emit(w, { type: 'teleport', x: pl.x, y: pl.y, color: pair.color });
      pl.x = clamp(to.x, B.x0 + pl.r, B.x1 - pl.r);
      pl.y = clamp(to.y, B.y0 + pl.r, B.y1 - pl.r);
      pl.portalCd = 1.0;
      emit(w, { type: 'teleport', x: pl.x, y: pl.y, color: pair.color });
      break;
    }
  }
}
