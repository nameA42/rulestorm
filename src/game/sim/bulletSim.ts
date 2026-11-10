import type { Params } from '../params';
import type { BulletEnt, Bounds, World } from '../world';
import { addScore, hurt } from './combat';
import { shootEnemy } from './enemySim';
import { applyEdges, collideWalls } from './physics';

function homeTarget(w: World, p: Params, b: BulletEnt): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null;
  let bd = 500;
  const consider = (x: number, y: number) => {
    const d = Math.hypot(x - b.x, y - b.y);
    if (d < bd) { bd = d; best = { x, y }; }
  };
  if (b.owner === null) return null;
  for (const e of w.enemies) if (!e.dead) consider(e.x, e.y);
  if (p.friendlyFire > 0.05) for (const pl of w.players) if (pl.alive && pl.id !== b.owner) consider(pl.x, pl.y);
  return best;
}

export function stepBullets(w: World, p: Params, dt: number, B: Bounds) {
  for (const b of w.bullets) {
    if (b.dead) continue;
    b.ttl -= dt;
    if (b.ttl <= 0) { b.dead = true; continue; }
    if (b.owner !== null) b.r = 5 * p.bulletSize;

    if (p.homing > 0) {
      const t = homeTarget(w, p, b);
      if (t) {
        const cur = Math.atan2(b.vy, b.vx);
        let want = Math.atan2(t.y - b.y, t.x - b.x) - cur;
        while (want > Math.PI) want -= Math.PI * 2;
        while (want < -Math.PI) want += Math.PI * 2;
        const maxTurn = p.homing * 6 * dt;
        const a = cur + Math.max(-maxTurn, Math.min(maxTurn, want));
        const s = Math.hypot(b.vx, b.vy);
        b.vx = Math.cos(a) * s; b.vy = Math.sin(a) * s;
      }
    }

    b.x += b.vx * dt;
    b.y += b.vy * dt;

    // Walls and solid edges: ricochet keeps `ricochet` of the speed; slow shots die.
    const hitWall = collideWalls(w, b, p, dt, p.ricochet) && p.wallSolid >= 0.97; // soft walls only drag
    const hitEdge = applyEdges(b, B, p.edgeWrap, p.ricochet);
    if (hitWall || hitEdge) {
      b.bounces++;
      if (p.ricochet < 0.05 || b.bounces > 4 || Math.hypot(b.vx, b.vy) < 200) { b.dead = true; continue; }
    } else if (p.wallSolid < 0.97 && Math.hypot(b.vx, b.vy) < 150) {
      b.dead = true; // stalled inside a soft wall
      continue;
    }

    if (b.owner !== null) {
      for (const e of w.enemies) {
        if (e.dead || Math.hypot(e.x - b.x, e.y - b.y) > e.r + b.r) continue;
        shootEnemy(w, p, e);
        const shooter = w.players.find((pl) => pl.id === b.owner);
        if (shooter) addScore(shooter, p, 2);
        b.dead = true;
        break;
      }
      if (b.dead) continue;
      if (p.friendlyFire > 0.05) {
        for (const pl of w.players) {
          if (!pl.alive || pl.id === b.owner || Math.hypot(pl.x - b.x, pl.y - b.y) > pl.r + b.r) continue;
          if (hurt(w, p, pl, 14 * p.friendlyFire, 0.25)) {
            pl.vx += b.vx * 0.4 * p.bulletSize; pl.vy += b.vy * 0.4 * p.bulletSize;
            pl.dashT = Math.max(pl.dashT, 0.1);
          }
          b.dead = true;
          break;
        }
      }
    } else {
      for (const pl of w.players) {
        if (!pl.alive || Math.hypot(pl.x - b.x, pl.y - b.y) > pl.r + b.r) continue;
        hurt(w, p, pl, 12, 0.3);
        b.dead = true;
        break;
      }
    }
  }
  w.bullets = w.bullets.filter((b) => !b.dead);
}
