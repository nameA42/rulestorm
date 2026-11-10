import type { Params } from '../params';
import { emit, type World } from '../world';
import { addScore, heal, hurt } from './combat';

/** Contacts between bodies: player↔player, player↔enemy, player↔trail, plus tag. */
export function stepInteractions(w: World, p: Params, dt: number) {
  const ps = w.players;
  w.tagImmune = Math.max(0, w.tagImmune - dt);

  // ── player ↔ player
  for (let i = 0; i < ps.length; i++) {
    for (let j = i + 1; j < ps.length; j++) {
      const a = ps[i], b = ps[j];
      if (!a.alive || !b.alive) continue;
      let dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.hypot(dx, dy) || 0.01;
      const nx = dx / d, ny = dy / d;

      if (p.playerForce !== 0) {
        const f = (p.playerForce / (1 + d / 350)) * dt;
        a.vx += nx * f; a.vy += ny * f;
        b.vx -= nx * f; b.vy -= ny * f;
      }

      const overlap = a.r + b.r - d;
      if (overlap <= 0) continue;

      if (p.playersCollide) {
        a.x -= nx * overlap / 2; a.y -= ny * overlap / 2;
        b.x += nx * overlap / 2; b.y += ny * overlap / 2;
        const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (rel < 0) {
          a.vx += rel * nx; a.vy += rel * ny;
          b.vx -= rel * nx; b.vy -= rel * ny;
        }
      }

      if (p.steal && a.stealCd <= 0 && b.stealCd <= 0) {
        const sa = Math.hypot(a.vx, a.vy), sb = Math.hypot(b.vx, b.vy);
        const [thief, mark] = sa >= sb ? [a, b] : [b, a];
        if (mark.score > 0) {
          const amt = Math.ceil(mark.score * 0.1);
          mark.score -= amt;
          thief.score += amt;
          emit(w, { type: 'steal', x: mark.x, y: mark.y, color: 0xffd54f, value: amt });
        }
        a.stealCd = b.stealCd = 1;
      }

      if (p.tag && w.tagImmune <= 0 && (w.tagIt === a.id || w.tagIt === b.id)) {
        const next = w.tagIt === a.id ? b : a;
        w.tagIt = next.id;
        w.tagImmune = 1.2;
        emit(w, { type: 'tag', x: next.x, y: next.y, color: 0xffd700 });
      }
    }
  }

  // ── tag bookkeeping
  if (p.tag) {
    const alive = ps.filter((pl) => pl.alive);
    if (alive.length && !alive.some((pl) => pl.id === w.tagIt)) {
      w.tagIt = alive[Math.floor(w.rng.next() * alive.length)].id;
      w.tagImmune = 1.2;
    }
    const it = ps.find((pl) => pl.id === w.tagIt);
    if (it) it.score -= 3 * dt;
  } else {
    w.tagIt = null;
  }

  // ── player ↔ enemy
  for (const pl of ps) {
    if (!pl.alive) continue;
    for (const e of w.enemies) {
      if (e.dead) continue;
      const dx = e.x - pl.x, dy = e.y - pl.y;
      const d = Math.hypot(dx, dy) || 0.01;
      if (d > pl.r + e.r) continue;
      const nx = dx / d, ny = dy / d;
      const overlap = pl.r + e.r - d;

      if (pl.shieldT > 0) {
        e.x += nx * overlap; e.y += ny * overlap;
        e.vx = nx * 500; e.vy = ny * 500;
        continue;
      }
      switch (p.enemyContact) {
        case 'eat':
          e.dead = true;
          addScore(pl, p, 5);
          emit(w, { type: 'eat', x: e.x, y: e.y, color: 0xf48fb1 });
          break;
        case 'heal':
          heal(pl, 30 * dt);
          e.x += nx * overlap; e.y += ny * overlap;
          if (w.rng.chance(4 * dt)) emit(w, { type: 'heal', x: pl.x, y: pl.y, color: 0x66bb6a });
          break;
        case 'none':
          e.x += nx * overlap; e.y += ny * overlap;
          break;
        case 'damage':
          if (hurt(w, p, pl, 20, 0.7)) {
            pl.vx = -nx * 420; pl.vy = -ny * 420;
            pl.dashT = Math.max(pl.dashT, 0.12);
          }
          e.x += nx * overlap; e.y += ny * overlap;
          e.vx = nx * 200; e.vy = ny * 200;
          break;
      }
    }
  }
  w.enemies = w.enemies.filter((e) => !e.dead);

  // ── light-cycle trails
  for (const t of w.trails) t.ttl -= dt;
  w.trails = w.trails.filter((t) => t.ttl > 0);
  if (p.lightCycle > 0) {
    for (const pl of ps) {
      if (!pl.alive) continue;
      for (const t of w.trails) {
        if (t.owner !== pl.id && Math.hypot(t.x - pl.x, t.y - pl.y) < pl.r + 4) {
          hurt(w, p, pl, 45 * dt);
          break;
        }
      }
    }
  }
}
