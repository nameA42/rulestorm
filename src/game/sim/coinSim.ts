import type { Params } from '../params';
import { emit, freeSpot, type Bounds, type CoinEnt, type PlayerEnt, type World } from '../world';
import { addScore, heal } from './combat';
import { nearestPlayer } from './enemySim';
import { applyEdges, applyFields, collideWalls, inBlackHole, limitSpeed, windDir } from './physics';

const MAX_COINS = 70;

export function stepCoins(w: World, p: Params, dt: number, B: Bounds) {
  w.coinAcc += p.coinRate * dt;
  while (w.coinAcc >= 1) {
    w.coinAcc -= 1;
    if (w.coins.length >= MAX_COINS) { w.coinAcc = 0; break; }
    const s = freeSpot(w, 10, B, w.players, 80);
    w.coins.push({ id: w.nextId++, x: s.x, y: s.y, vx: 0, vy: 0, ttl: p.coinTTL, dead: false });
  }

  const wind = windDir(w.time);
  for (const c of w.coins) {
    if (c.dead) continue;
    c.ttl = Math.min(c.ttl, p.coinTTL) - dt;
    if (c.ttl <= 0) { c.dead = true; continue; }

    const body = { x: c.x, y: c.y, vx: c.vx, vy: c.vy, r: 8 };
    if (p.coinBounce) {
      if (Math.hypot(body.vx, body.vy) < 120) {
        const a = w.rng.range(0, Math.PI * 2);
        body.vx = Math.cos(a) * 220; body.vy = Math.sin(a) * 220;
      }
    } else {
      const drag = Math.exp(-3 * dt);
      body.vx *= drag; body.vy *= drag;
    }
    if (p.coinPull !== 0) {
      const n = nearestPlayer(w, c.x, c.y);
      const range = p.coinPull > 0 ? 520 : 320;
      if (n && n.dist < range && n.dist > 1) {
        const a = 1800 * p.coinPull;
        body.vx += ((n.pl.x - c.x) / n.dist) * a * dt;
        body.vy += ((n.pl.y - c.y) / n.dist) * a * dt;
      }
    }
    body.vy += p.gravity * 0.5 * dt;
    body.vx += wind.x * p.wind * 0.5 * dt;
    body.vy += wind.y * p.wind * 0.5 * dt;
    applyFields(w, p, body, dt, 0.6);
    limitSpeed(body, 900);
    body.x += body.vx * dt;
    body.y += body.vy * dt;
    const bounce = p.coinBounce ? 1 : 0.6;
    if (p.wallsSolid) collideWalls(w, body, bounce);
    applyEdges(body, B, p.edges, bounce);
    c.x = body.x; c.y = body.y; c.vx = body.vx; c.vy = body.vy;

    if (inBlackHole(p, body)) { c.dead = true; continue; }

    for (const pl of w.players) {
      if (pl.alive && Math.hypot(pl.x - c.x, pl.y - c.y) < pl.r + 9) {
        collect(w, p, pl, c);
        break;
      }
    }
  }
  w.coins = w.coins.filter((c) => !c.dead);
}

function collect(w: World, p: Params, pl: PlayerEnt, c: CoinEnt) {
  c.dead = true;
  pl.combo = pl.comboT > 0 ? pl.combo + 1 : 0;
  pl.comboT = 1.6;
  const mult = p.combo > 0 ? 1 + pl.combo * p.combo : 1;
  const value = p.coinValue * mult;
  if (p.coinShared) for (const o of w.players) addScore(o, p, value);
  else addScore(pl, p, value);
  if (p.coinHeal) heal(pl, 15);
  emit(w, { type: 'pickup', x: c.x, y: c.y, color: value < 0 ? 0xba68c8 : 0xffd54f, value });

  if (p.coinExplode) {
    emit(w, { type: 'boom', x: c.x, y: c.y, color: 0xffab40 });
    const push = (b: { x: number; y: number; vx: number; vy: number }, s: number) => {
      const d = Math.hypot(b.x - c.x, b.y - c.y);
      if (d < 220 && d > 0.5) {
        b.vx += ((b.x - c.x) / d) * 750 * s;
        b.vy += ((b.y - c.y) / d) * 750 * s;
      }
    };
    for (const o of w.players) { push(o, 1); o.dashT = Math.max(o.dashT, 0.2); }
    for (const e of w.enemies) push(e, 1);
    for (const o of w.coins) push(o, 0.6);
  }
}
