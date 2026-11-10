import type { Params } from '../params';
import { emit, freeSpot, insideAnyWall, type Bounds, type EnemyEnt, type PlayerEnt, type World } from '../world';
import { applyEdges, applyFields, clamp, collideWalls, inBlackHole, limitSpeed } from './physics';

const HARD_CAP = 40;

export function nearestPlayer(w: World, x: number, y: number): { pl: PlayerEnt; dist: number } | null {
  let best: PlayerEnt | null = null;
  let bd = Infinity;
  for (const pl of w.players) {
    if (!pl.alive) continue;
    const d = Math.hypot(pl.x - x, pl.y - y);
    if (d < bd) { bd = d; best = pl; }
  }
  return best ? { pl: best, dist: bd } : null;
}

export function spawnEnemy(w: World, x: number, y: number, scale = 1): EnemyEnt {
  const e: EnemyEnt = {
    id: w.nextId++, x, y, vx: 0, vy: 0, r: 15 * scale, scale,
    wander: w.rng.range(0, Math.PI * 2), shootCd: w.rng.range(0.5, 2), portalCd: 0, dead: false,
  };
  w.enemies.push(e);
  return e;
}

function manageCount(w: World, p: Params, dt: number, B: Bounds) {
  const target = Math.round(p.enemyCount);
  const cap = p.enemyBreed > 0 ? Math.max(target, HARD_CAP) : target;
  w.enemySpawnCd -= dt;
  if (w.enemySpawnCd > 0) return;
  if (w.enemies.length < target) {
    const s = freeSpot(w, 20, B, w.players.filter((pl) => pl.alive), 320);
    spawnEnemy(w, s.x, s.y);
    emit(w, { type: 'spawn', x: s.x, y: s.y, color: 0xef5350 });
    w.enemySpawnCd = 0.5;
  } else if (w.enemies.length > cap) {
    // Remove the one furthest from any player.
    let far: EnemyEnt | null = null;
    let fd = -1;
    for (const e of w.enemies) {
      const n = nearestPlayer(w, e.x, e.y);
      const d = n ? n.dist : 0;
      if (d > fd) { fd = d; far = e; }
    }
    if (far) { far.dead = true; emit(w, { type: 'kill', x: far.x, y: far.y, color: 0x777777 }); }
    w.enemySpawnCd = 0.2;
  }
}

export function stepEnemies(w: World, p: Params, dt: number, B: Bounds) {
  manageCount(w, p, dt, B);
  const leader = w.players[0];
  const born: [number, number, number][] = [];

  for (const e of w.enemies) {
    if (e.dead) continue;
    e.r = 15 * e.scale * p.enemyRadius;
    e.portalCd -= dt;
    const speed = 115 * p.enemySpeed;
    e.wander += (w.rng.next() - 0.5) * 5 * dt;
    let wx = Math.cos(e.wander), wy = Math.sin(e.wander);
    const near = nearestPlayer(w, e.x, e.y);

    let tx = wx * speed * 0.7, ty = wy * speed * 0.7;
    if (near) {
      const d = Math.max(near.dist, 1);
      const ux = (near.pl.x - e.x) / d, uy = (near.pl.y - e.y) / d;
      switch (p.enemyAI) {
        case 'hunt': {
          const h = 0.35 + 0.65 * p.huntStrength;
          let mx = wx * (1 - h) + ux * h, my = wy * (1 - h) + uy * h;
          const m = Math.hypot(mx, my) || 1;
          tx = (mx / m) * speed; ty = (my / m) * speed;
          break;
        }
        case 'flee':
          if (d < 450) { tx = -ux * speed * 1.15; ty = -uy * speed * 1.15; }
          break;
        case 'orbit': {
          const radial = clamp((d - 150) / 100, -1, 1);
          let mx = -uy + ux * radial, my = ux + uy * radial;
          const m = Math.hypot(mx, my) || 1;
          tx = (mx / m) * speed * 1.4; ty = (my / m) * speed * 1.4;
          break;
        }
        case 'mimic':
          if (leader) { tx = leader.lastIntent.x * speed * 1.4; ty = leader.lastIntent.y * speed * 1.4; }
          break;
        case 'wander':
          break;
      }
    }

    const k = 1 - Math.exp(-4 * dt);
    e.vx += (tx - e.vx) * k;
    e.vy += (ty - e.vy) * k;
    applyFields(w, p, e, dt, 0.8);
    limitSpeed(e, 1600);
    e.x += e.vx * dt;
    e.y += e.vy * dt;

    if (p.wallsSolid && collideWalls(w, e, 0.5)) e.wander = Math.atan2(e.vy, e.vx);
    if (applyEdges(e, B, p.edges, 0.8)) e.wander = Math.atan2(e.vy, e.vx);

    if (inBlackHole(p, e)) {
      emit(w, { type: 'kill', x: e.x, y: e.y, color: 0x000000 });
      e.dead = true;
      continue;
    }

    if (p.portals && e.portalCd <= 0) {
      for (const pair of w.portals) {
        const from = Math.hypot(e.x - pair.a.x, e.y - pair.a.y) < 28 ? pair.a
          : Math.hypot(e.x - pair.b.x, e.y - pair.b.y) < 28 ? pair.b : null;
        if (!from) continue;
        const to = from === pair.a ? pair.b : pair.a;
        e.x = to.x; e.y = to.y; e.portalCd = 1.2;
        break;
      }
    }

    if (p.enemyShoot > 0 && near && near.dist < 650) {
      e.shootCd -= dt;
      if (e.shootCd <= 0 && w.bullets.length < 300) {
        const d = Math.max(near.dist, 1);
        const ux = (near.pl.x - e.x) / d, uy = (near.pl.y - e.y) / d;
        w.bullets.push({
          id: w.nextId++, x: e.x + ux * (e.r + 6), y: e.y + uy * (e.r + 6),
          vx: ux * 330, vy: uy * 330, r: 5, owner: null, ttl: 2.2, bounces: 0, dead: false,
        });
        e.shootCd = (1 / p.enemyShoot) * w.rng.range(0.6, 1.4);
      }
    }

    if (p.enemyBlink > 0 && w.rng.chance(p.enemyBlink * dt)) {
      const a = w.rng.range(0, Math.PI * 2);
      const dist = w.rng.range(90, 220);
      const x = clamp(e.x + Math.cos(a) * dist, B.x0 + e.r, B.x1 - e.r);
      const y = clamp(e.y + Math.sin(a) * dist, B.y0 + e.r, B.y1 - e.r);
      if (!insideAnyWall(w, x, y, e.r)) {
        emit(w, { type: 'teleport', x: e.x, y: e.y, color: 0xef5350 });
        e.x = x; e.y = y;
      }
    }

    if (p.enemyThieves) {
      for (const c of w.coins) {
        if (!c.dead && Math.hypot(c.x - e.x, c.y - e.y) < e.r + 8) {
          c.dead = true;
          emit(w, { type: 'steal', x: c.x, y: c.y, color: 0xef5350 });
        }
      }
    }

    if (p.enemyBreed > 0 && w.rng.chance(p.enemyBreed * dt) && w.enemies.length + born.length < HARD_CAP) {
      born.push([e.x + w.rng.range(-20, 20), e.y + w.rng.range(-20, 20), e.scale]);
    }
  }

  for (const [x, y, s] of born) {
    spawnEnemy(w, x, y, s);
    emit(w, { type: 'spawn', x, y, color: 0xef5350 });
  }
  w.enemies = w.enemies.filter((e) => !e.dead);
}

/** Kill an enemy (shot); may split it. Returns true if it died. */
export function shootEnemy(w: World, p: Params, e: EnemyEnt) {
  e.dead = true;
  emit(w, { type: 'kill', x: e.x, y: e.y, color: 0xef5350 });
  if (p.enemySplit && e.scale > 0.45) {
    const a = Math.atan2(e.vy, e.vx) + Math.PI / 2;
    for (const s of [1, -1]) {
      const c = spawnEnemy(w, e.x + Math.cos(a) * s * 10, e.y + Math.sin(a) * s * 10, e.scale * 0.65);
      c.vx = Math.cos(a) * s * 250;
      c.vy = Math.sin(a) * s * 250;
    }
    emit(w, { type: 'split', x: e.x, y: e.y, color: 0xef5350 });
  }
}
