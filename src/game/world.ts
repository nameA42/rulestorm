import { IDLE, type Intent, type PlayerId, type PlayerInfo } from '../contracts/players';
import { Rng, hash32 } from '../shared/rng';

/** Pure data. The whole match lives here; JSON.stringify(world) is the full state. */

export const WORLD_W = 1800;
export const WORLD_H = 1200;
export const CENTER = { x: WORLD_W / 2, y: WORLD_H / 2 };
export const MAX_HP = 100;

export interface Vec { x: number; y: number }
export interface Body { x: number; y: number; vx: number; vy: number; r: number }
export interface Bounds { x0: number; y0: number; x1: number; y1: number }

export interface PlayerEnt extends Body {
  id: PlayerId;
  name: string;
  color: number;
  hp: number;
  score: number;
  alive: boolean;
  respawnT: number;
  facing: number;
  heading: number;
  wobble: number;
  moveT: number;
  lastDirX: number;
  lastDirY: number;
  lastIntent: Intent;
  prevAction: boolean;
  actionCd: number;
  autoT: number;
  dashT: number;
  shieldT: number;
  invulnT: number;
  combo: number;
  comboT: number;
  distAcc: number;
  stillAcc: number;
  trailT: number;
  padCd: number;
  portalCd: number;
  stealCd: number;
}

export interface EnemyEnt extends Body {
  id: number;
  scale: number;
  wander: number;
  shootCd: number;
  portalCd: number;
  dead: boolean;
}

export interface CoinEnt { id: number; x: number; y: number; vx: number; vy: number; ttl: number; dead: boolean }

export interface BulletEnt extends Body {
  id: number;
  owner: PlayerId | null; // null = enemy shot
  ttl: number;
  bounces: number;
  dead: boolean;
}

export interface Wall { bx: number; by: number; w: number; h: number; x: number; y: number; phase: number; axis: 0 | 1 }
export interface Zone { x: number; y: number; r: number; angle: number }
export interface PortalPair { a: Vec; b: Vec; color: number }
export interface Trail { x: number; y: number; owner: PlayerId; ttl: number }

export type GameEventType =
  | 'pickup' | 'hurt' | 'death' | 'boom' | 'eat' | 'teleport' | 'shoot' | 'split'
  | 'heal' | 'steal' | 'tag' | 'kill' | 'pad' | 'spawn';
export interface GameEvent { type: GameEventType; x: number; y: number; color: number; value?: number }

export interface World {
  tick: number;
  time: number;
  rng: Rng;
  nextId: number;
  players: PlayerEnt[];
  enemies: EnemyEnt[];
  coins: CoinEnt[];
  bullets: BulletEnt[];
  walls: Wall[];
  pools: Zone[];
  pads: Zone[];
  ice: Zone[];
  portals: PortalPair[];
  trails: Trail[];
  /** Outbox for the view (particles, sounds). The sim only appends. */
  events: GameEvent[];
  tagIt: PlayerId | null;
  tagImmune: number;
  coinAcc: number;
  enemySpawnCd: number;
}

export function arenaBounds(scale: number): Bounds {
  const hw = (WORLD_W / 2) * scale;
  const hh = (WORLD_H / 2) * scale;
  return { x0: CENTER.x - hw, y0: CENTER.y - hh, x1: CENTER.x + hw, y1: CENTER.y + hh };
}

export function createWorld(seed: number): World {
  const rng = new Rng(hash32('world', seed));
  const w: World = {
    tick: 0, time: 0, rng, nextId: 1,
    players: [], enemies: [], coins: [], bullets: [],
    walls: [], pools: [], pads: [], ice: [], portals: [], trails: [], events: [],
    tagIt: null, tagImmune: 0, coinAcc: 0, enemySpawnCd: 0,
  };

  // Walls: avoid the middle so spawning is always possible.
  let guard = 0;
  while (w.walls.length < 12 && guard++ < 400) {
    const horiz = rng.chance(0.5);
    const ww = horiz ? rng.range(140, 320) : rng.range(36, 56);
    const hh = horiz ? rng.range(36, 56) : rng.range(140, 320);
    const x = rng.range(80, WORLD_W - 80 - ww);
    const y = rng.range(80, WORLD_H - 80 - hh);
    const cx = x + ww / 2, cy = y + hh / 2;
    if (Math.hypot(cx - CENTER.x, cy - CENTER.y) < 260) continue;
    const overlaps = w.walls.some((o) => x < o.bx + o.w + 70 && x + ww + 70 > o.bx && y < o.by + o.h + 70 && y + hh + 70 > o.by);
    if (overlaps) continue;
    w.walls.push({ bx: x, by: y, w: ww, h: hh, x, y, phase: rng.range(0, Math.PI * 2), axis: horiz ? 0 : 1 });
  }

  const zones = (n: number, rMin: number, rMax: number): Zone[] => {
    const out: Zone[] = [];
    let g = 0;
    while (out.length < n && g++ < 500) {
      const r = rng.range(rMin, rMax);
      const x = rng.range(120 + r, WORLD_W - 120 - r);
      const y = rng.range(120 + r, WORLD_H - 120 - r);
      if (Math.hypot(x - CENTER.x, y - CENTER.y) < 160 + r) continue;
      if (insideAnyWall(w, x, y, r * 0.6)) continue;
      out.push({ x, y, r, angle: rng.range(0, Math.PI * 2) });
    }
    return out;
  };
  w.pools = zones(8, 50, 95);
  w.pads = zones(8, 30, 36);
  w.ice = zones(8, 110, 190);
  const portalSpots = zones(4, 26, 26);
  const colors = [0xb388ff, 0x69f0ae];
  for (let i = 0; i + 1 < portalSpots.length; i += 2) {
    w.portals.push({ a: portalSpots[i], b: portalSpots[i + 1], color: colors[i / 2] });
  }
  return w;
}

export function insideAnyWall(w: World, x: number, y: number, r: number): boolean {
  return w.walls.some((o) => x + r > o.x && x - r < o.x + o.w && y + r > o.y && y - r < o.y + o.h);
}

/** A random spot inside `b`, clear of walls and at least `minDist` from every point in `avoid`. */
export function freeSpot(w: World, r: number, b: Bounds, avoid: Vec[] = [], minDist = 0): Vec {
  let best: Vec = { x: CENTER.x, y: CENTER.y };
  let bestScore = -Infinity;
  for (let i = 0; i < 30; i++) {
    const x = w.rng.range(b.x0 + r + 10, b.x1 - r - 10);
    const y = w.rng.range(b.y0 + r + 10, b.y1 - r - 10);
    if (insideAnyWall(w, x, y, r + 4)) continue;
    let nearest = Infinity;
    for (const a of avoid) nearest = Math.min(nearest, Math.hypot(a.x - x, a.y - y));
    if (nearest >= minDist) return { x, y };
    if (nearest > bestScore) { bestScore = nearest; best = { x, y }; }
  }
  return best;
}

export function newPlayer(w: World, info: PlayerInfo, at: Vec): PlayerEnt {
  return {
    id: info.id, name: info.name, color: info.color,
    x: at.x, y: at.y, vx: 0, vy: 0, r: 16,
    hp: MAX_HP, score: 0, alive: true, respawnT: 0,
    facing: 0, heading: 0, wobble: (hash32('wobble', info.id) % 1000) / 100,
    moveT: 0, lastDirX: 0, lastDirY: 0, lastIntent: { ...IDLE },
    prevAction: false, actionCd: 0, autoT: 0, dashT: 0, shieldT: 0, invulnT: 1.5,
    combo: 0, comboT: 0, distAcc: 0, stillAcc: 0, trailT: 0, padCd: 0, portalCd: 0, stealCd: 0,
  };
}

export function emit(w: World, e: GameEvent) {
  if (w.events.length < 400) w.events.push(e);
}
