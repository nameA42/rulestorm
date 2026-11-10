import type { Params } from '../params';
import { emit, freeSpot, MAX_HP, arenaBounds, type PlayerEnt, type World } from '../world';

/** Damage a player. `iframes` > 0 grants that many seconds of invulnerability. */
export function hurt(w: World, p: Params, pl: PlayerEnt, amount: number, iframes = 0): boolean {
  if (!pl.alive || pl.invulnT > 0 || pl.shieldT > 0) return false;
  const dmg = amount * p.damageMult;
  if (dmg <= 0) return false;
  pl.hp -= dmg;
  if (iframes > 0) {
    pl.invulnT = iframes;
    emit(w, { type: 'hurt', x: pl.x, y: pl.y, color: 0xff5252 });
  }
  if (pl.hp <= 0) kill(w, pl);
  return true;
}

export function heal(pl: PlayerEnt, amount: number) {
  if (pl.alive) pl.hp = Math.min(MAX_HP, pl.hp + amount);
}

export function kill(w: World, pl: PlayerEnt) {
  pl.alive = false;
  pl.hp = 0;
  pl.respawnT = 2;
  pl.vx = pl.vy = 0;
  if (pl.score > 0) pl.score = Math.floor(pl.score / 2);
  emit(w, { type: 'death', x: pl.x, y: pl.y, color: pl.color });
}

export function respawn(w: World, p: Params, pl: PlayerEnt) {
  const spot = freeSpot(w, pl.r, arenaBounds(p.arenaScale), w.enemies, 220);
  pl.x = spot.x; pl.y = spot.y;
  pl.vx = pl.vy = 0;
  pl.hp = MAX_HP;
  pl.alive = true;
  pl.invulnT = 1.5;
  emit(w, { type: 'spawn', x: pl.x, y: pl.y, color: pl.color });
}

export function addScore(pl: PlayerEnt, p: Params, amount: number) {
  pl.score += amount * (amount > 0 ? p.scoreMult : 1);
}

export function fire(w: World, p: Params, pl: PlayerEnt) {
  if (w.bullets.length >= 300) return;
  const dx = Math.cos(pl.facing), dy = Math.sin(pl.facing);
  const r = 5 * p.bulletSize;
  w.bullets.push({
    id: w.nextId++,
    x: pl.x + dx * (pl.r + r + 2), y: pl.y + dy * (pl.r + r + 2),
    vx: dx * 720 + pl.vx * 0.3, vy: dy * 720 + pl.vy * 0.3,
    r, owner: pl.id, ttl: 1.3, bounces: 0, dead: false,
  });
  emit(w, { type: 'shoot', x: pl.x, y: pl.y, color: pl.color });
}
