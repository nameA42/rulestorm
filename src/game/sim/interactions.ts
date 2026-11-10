import type { Params } from '../params';
import { emit, type World } from '../world';
import { addScore, heal, hurt } from './combat';

/** Contacts between bodies: player↔player, player↔enemy, player↔trail, plus tag. */
export function stepInteractions(w: World, p: Params, dt: number) {
  const ps = w.players;
  w.tagImmune = Math.max(0, w.tagImmune - dt);
  const tagOn = p.tag > 0.02;

  // ── player ↔ player
  for (let i = 0; i < ps.length; i++) {
    for (let j = i + 1; j < ps.length; j++) {
      const a = ps[i], b = ps[j];
      if (!a.alive || !b.alive) continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.hypot(dx, dy) || 0.01;
      const nx = dx / d, ny = dy / d;

      if (p.playerForce !== 0) {
        const f = (p.playerForce / (1 + d / 350)) * dt;
        a.vx += nx * f; a.vy += ny * f;
        b.vx -= nx * f; b.vy -= ny * f;
      }

      const overlap = a.r + b.r - d;
      if (overlap <= 0) continue;

      // Bodies push apart less the more ghostly players are.
      const solid = 1 - p.ghost;
      if (solid > 0.01) {
        a.x -= (nx * overlap * solid) / 2; a.y -= (ny * overlap * solid) / 2;
        b.x += (nx * overlap * solid) / 2; b.y += (ny * overlap * solid) / 2;
        const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (rel < 0) {
          a.vx += rel * nx * solid; a.vy += rel * ny * solid;
          b.vx -= rel * nx * solid; b.vy -= rel * ny * solid;
        }
      }

      if (p.steal > 0.002 && a.stealCd <= 0 && b.stealCd <= 0) {
        const sa = Math.hypot(a.vx, a.vy), sb = Math.hypot(b.vx, b.vy);
        const [thief, mark] = sa >= sb ? [a, b] : [b, a];
        if (mark.score > 0) {
          const amt = Math.ceil(mark.score * p.steal);
          mark.score -= amt;
          thief.score += amt;
          emit(w, { type: 'steal', x: mark.x, y: mark.y, color: 0xffd54f, value: amt });
        }
        a.stealCd = b.stealCd = 1;
      }

      if (tagOn && w.tagImmune <= 0 && (w.tagIt === a.id || w.tagIt === b.id)) {
        const next = w.tagIt === a.id ? b : a;
        w.tagIt = next.id;
        w.tagImmune = 1.2;
        emit(w, { type: 'tag', x: next.x, y: next.y, color: 0xffd700 });
      }
    }
  }

  // ── tag bookkeeping
  if (tagOn) {
    const alive = ps.filter((pl) => pl.alive);
    if (alive.length && !alive.some((pl) => pl.id === w.tagIt)) {
      w.tagIt = alive[Math.floor(w.rng.next() * alive.length)].id;
      w.tagImmune = 1.2;
    }
    const it = ps.find((pl) => pl.id === w.tagIt);
    if (it) it.score -= 3 * p.tag * dt;
  } else {
    w.tagIt = null;
  }

  // ── player ↔ enemy: damage, healing and eating all scale with their rules
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
      if (p.eatTouch > 0) {
        e.bitten += p.eatTouch * 4 * dt;
        if (e.bitten >= 1) {
          e.dead = true;
          addScore(pl, p, 5);
          emit(w, { type: 'eat', x: e.x, y: e.y, color: 0xf48fb1 });
          continue;
        }
      }
      if (p.healTouch > 0) {
        heal(pl, 30 * p.healTouch * dt);
        if (w.rng.chance(4 * dt)) emit(w, { type: 'heal', x: pl.x, y: pl.y, color: 0x66bb6a });
      }
      if (p.harm > 0.02 && hurt(w, p, pl, 20 * p.harm, 0.7)) {
        pl.vx = -nx * 420 * p.harm; pl.vy = -ny * 420 * p.harm;
        pl.dashT = Math.max(pl.dashT, 0.12);
        e.vx = nx * 200; e.vy = ny * 200;
      }
      e.x += nx * overlap; e.y += ny * overlap;
    }
  }
  w.enemies = w.enemies.filter((e) => !e.dead);

  // ── light-cycle trails
  for (const t of w.trails) t.ttl -= dt;
  w.trails = w.trails.filter((t) => t.ttl > 0);
  if (w.trails.length) {
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
