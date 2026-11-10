import { IDLE, type Intent, type PlayerId } from '../../contracts/players';
import type { Params } from '../params';
import { emit, freeSpot, insideAnyWall, MAX_HP, type Bounds, type PlayerEnt, type World } from '../world';
import { addScore, fire, heal, hurt, respawn } from './combat';
import {
  applyEdges, applyFields, clamp, collideWalls, edgeBounce, inBlackHole, limitSpeed, windDir,
} from './physics';

const COOLDOWN = { dash: 0.8, shoot: 0.22, shield: 2.5, blink: 1.0 } as const;

/** Turn raw input into a movement direction, applying every control-mangling rule. */
function steer(w: World, p: Params, pl: PlayerEnt, raw: Intent, dt: number): { dx: number; dy: number } {
  let ix = raw.x, iy = raw.y;
  if (p.intentSwap) [ix, iy] = [iy, ix];
  if (p.intentReverse) { ix = -ix; iy = -iy; }
  let rot = p.intentRotate;
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
  if (p.tank) {
    pl.heading += ix * 3.4 * dt;
    const thrust = -iy;
    dx = Math.cos(pl.heading) * thrust;
    dy = Math.sin(pl.heading) * thrust;
  } else if (p.fourWay && (Math.abs(dx) > 0.1 || Math.abs(dy) > 0.1)) {
    if (Math.abs(dx) >= Math.abs(dy)) { dx = Math.sign(dx); dy = 0; } else { dy = Math.sign(dy); dx = 0; }
  }

  if (p.cantStop && Math.hypot(dx, dy) < 0.1 && (pl.lastDirX || pl.lastDirY)) {
    dx = pl.lastDirX; dy = pl.lastDirY;
  }
  return { dx, dy };
}

function act(w: World, p: Params, pl: PlayerEnt, action: boolean, B: Bounds) {
  const pressed = action && !pl.prevAction;
  pl.prevAction = action;
  if (pl.actionCd > 0) return;
  const cd = COOLDOWN[p.actionMode] * p.cooldownMult;
  const fx = Math.cos(pl.facing), fy = Math.sin(pl.facing);
  switch (p.actionMode) {
    case 'shoot':
      if (action) { fire(w, p, pl); pl.actionCd = cd; }
      break;
    case 'dash':
      if (pressed && p.dashEnabled) {
        pl.vx += fx * 680 * p.dashPower;
        pl.vy += fy * 680 * p.dashPower;
        pl.dashT = 0.18;
        pl.actionCd = cd;
        emit(w, { type: 'pad', x: pl.x, y: pl.y, color: pl.color });
      }
      break;
    case 'shield':
      if (pressed) { pl.shieldT = 1.2; pl.actionCd = cd; }
      break;
    case 'blink':
      if (pressed) {
        emit(w, { type: 'teleport', x: pl.x, y: pl.y, color: pl.color });
        for (let dist = 240; dist > 0; dist -= 40) {
          const x = clamp(pl.x + fx * dist, B.x0 + pl.r, B.x1 - pl.r);
          const y = clamp(pl.y + fy * dist, B.y0 + pl.r, B.y1 - pl.r);
          if (!p.wallsSolid || !insideAnyWall(w, x, y, pl.r)) { pl.x = x; pl.y = y; break; }
        }
        emit(w, { type: 'teleport', x: pl.x, y: pl.y, color: pl.color });
        pl.actionCd = cd;
      }
      break;
  }
}

export function stepPlayers(w: World, p: Params, inputs: ReadonlyMap<PlayerId, Intent>, dt: number, B: Bounds) {
  const wind = windDir(w.time);
  for (const pl of w.players) {
    pl.r = p.radius;
    pl.invulnT = Math.max(0, pl.invulnT - dt);
    pl.actionCd -= dt;
    pl.shieldT = Math.max(0, pl.shieldT - dt);
    pl.dashT = Math.max(0, pl.dashT - dt);
    pl.comboT -= dt;
    pl.padCd -= dt;
    pl.portalCd -= dt;
    pl.stealCd -= dt;

    if (!pl.alive) {
      pl.respawnT -= dt;
      if (pl.respawnT <= 0) respawn(w, p, pl);
      continue;
    }

    const raw = inputs.get(pl.id) ?? IDLE;
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
    for (let i = 0; i < p.icePatches && i < w.ice.length; i++) {
      const z = w.ice[i];
      if (Math.hypot(pl.x - z.x, pl.y - z.y) < z.r) { resp *= 0.08; break; }
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
    if (p.autofire > 0) {
      pl.autoT -= dt;
      if (pl.autoT <= 0) { fire(w, p, pl); pl.autoT = 1 / p.autofire; }
    }

    limitSpeed(pl, 2400);
    const px = pl.x, py = pl.y;
    pl.x += pl.vx * dt;
    pl.y += pl.vy * dt;

    if (p.wallsSolid && collideWalls(w, pl, p.wallBounce) && p.wallsHurt) {
      hurt(w, p, pl, 10, 0.4);
    }
    if (applyEdges(pl, B, p.edges, edgeBounce(p)) && p.edges === 'lava') {
      hurt(w, p, pl, 40 * dt);
    }

    stepZones(w, p, pl, dt, B);

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

    // Light-cycle trail
    if (p.lightCycle > 0) {
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
    if (p.scoreStill && moved < 0.3) {
      pl.stillAcc += dt;
      if (pl.stillAcc >= 0.5) { pl.stillAcc -= 0.5; addScore(pl, p, 1); }
    }

    // Health over time
    if (p.regen > 0 && pl.hp < MAX_HP) heal(pl, p.regen * dt);
    if (p.poison > 0) hurt(w, p, pl, p.poison * dt);
    if (p.scoreDrain > 0 && pl.score > 0) pl.score = Math.max(0, pl.score - p.scoreDrain * dt);
  }
}

function stepZones(w: World, p: Params, pl: PlayerEnt, dt: number, B: Bounds) {
  for (let i = 0; i < p.lavaPools && i < w.pools.length; i++) {
    const z = w.pools[i];
    if (Math.hypot(pl.x - z.x, pl.y - z.y) < z.r) { hurt(w, p, pl, 35 * dt); break; }
  }
  if (pl.padCd <= 0) {
    for (let i = 0; i < p.speedPads && i < w.pads.length; i++) {
      const z = w.pads[i];
      if (Math.hypot(pl.x - z.x, pl.y - z.y) < z.r + pl.r * 0.5) {
        pl.vx = Math.cos(z.angle) * 950;
        pl.vy = Math.sin(z.angle) * 950;
        pl.dashT = 0.28;
        pl.padCd = 0.6;
        emit(w, { type: 'pad', x: z.x, y: z.y, color: 0x4dd0e1 });
        break;
      }
    }
  }
  if (p.portals && pl.portalCd <= 0) {
    for (const pair of w.portals) {
      const from = Math.hypot(pl.x - pair.a.x, pl.y - pair.a.y) < 30 ? pair.a
        : Math.hypot(pl.x - pair.b.x, pl.y - pair.b.y) < 30 ? pair.b : null;
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
