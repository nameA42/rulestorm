import type { Params } from '../params';
import type { BulletEnt, Bounds, World } from '../world';
import { addScore, hurt } from './combat';
import { shootEnemy } from './enemySim';
import { collideWalls } from './physics';

function homeTarget(w: World, p: Params, b: BulletEnt): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null;
  let bd = 500;
  const consider = (x: number, y: number) => {
    const d = Math.hypot(x - b.x, y - b.y);
    if (d < bd) { bd = d; best = { x, y }; }
  };
  if (b.owner === null) return null;
  for (const e of w.enemies) if (!e.dead) consider(e.x, e.y);
  if (p.friendlyFire) for (const pl of w.players) if (pl.alive && pl.id !== b.owner) consider(pl.x, pl.y);
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

    if (p.wallsSolid && collideWalls(w, b, 1)) {
      if (p.ricochet && b.bounces < 4) b.bounces++;
      else { b.dead = true; continue; }
    }
    if (p.edges === 'wrap') {
      const W = B.x1 - B.x0, H = B.y1 - B.y0;
      if (b.x < B.x0) b.x += W; else if (b.x > B.x1) b.x -= W;
      if (b.y < B.y0) b.y += H; else if (b.y > B.y1) b.y -= H;
    } else if (b.x < B.x0 || b.x > B.x1 || b.y < B.y0 || b.y > B.y1) {
      if (p.ricochet && b.bounces < 4) {
        b.bounces++;
        if (b.x < B.x0 || b.x > B.x1) { b.vx = -b.vx; b.x = Math.max(B.x0, Math.min(B.x1, b.x)); }
        if (b.y < B.y0 || b.y > B.y1) { b.vy = -b.vy; b.y = Math.max(B.y0, Math.min(B.y1, b.y)); }
      } else { b.dead = true; continue; }
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
      if (p.friendlyFire) {
        for (const pl of w.players) {
          if (!pl.alive || pl.id === b.owner || Math.hypot(pl.x - b.x, pl.y - b.y) > pl.r + b.r) continue;
          if (hurt(w, p, pl, 14, 0.25)) {
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
