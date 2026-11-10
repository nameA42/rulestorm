import type { Params } from '../params';
import { CENTER, type Body, type Bounds, type Wall, type World } from '../world';

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/** Push a circle out of a rectangle. Returns true on contact. */
export function collideWall(b: Body, wall: Wall, bounce: number): boolean {
  const cx = clamp(b.x, wall.x, wall.x + wall.w);
  const cy = clamp(b.y, wall.y, wall.y + wall.h);
  const dx = b.x - cx;
  const dy = b.y - cy;
  const d2 = dx * dx + dy * dy;
  if (d2 >= b.r * b.r) return false;
  let nx: number, ny: number, pen: number;
  if (d2 > 1e-6) {
    const d = Math.sqrt(d2);
    nx = dx / d; ny = dy / d; pen = b.r - d;
  } else {
    const left = b.x - wall.x, right = wall.x + wall.w - b.x;
    const top = b.y - wall.y, bottom = wall.y + wall.h - b.y;
    const m = Math.min(left, right, top, bottom);
    if (m === left) { nx = -1; ny = 0; pen = left + b.r; }
    else if (m === right) { nx = 1; ny = 0; pen = right + b.r; }
    else if (m === top) { nx = 0; ny = -1; pen = top + b.r; }
    else { nx = 0; ny = 1; pen = bottom + b.r; }
  }
  b.x += nx * pen;
  b.y += ny * pen;
  const vn = b.vx * nx + b.vy * ny;
  if (vn < 0) {
    b.vx -= (1 + bounce) * vn * nx;
    b.vy -= (1 + bounce) * vn * ny;
  }
  return true;
}

/** Overlap test without resolving. */
export function touchesWall(b: Body, wall: Wall): boolean {
  const cx = clamp(b.x, wall.x, wall.x + wall.w);
  const cy = clamp(b.y, wall.y, wall.y + wall.h);
  return (b.x - cx) ** 2 + (b.y - cy) ** 2 < b.r * b.r;
}

/**
 * Walls with a solidity: fully solid walls block (and bounce); softer walls
 * let you wade through, dragging on you the more solid they are.
 * Returns true if the body touched any wall.
 */
export function collideWalls(w: World, b: Body, p: Params, dt: number, bounce: number): boolean {
  let hit = false;
  for (const wall of w.walls) {
    if (p.wallSolid >= 0.97) {
      if (collideWall(b, wall, bounce)) hit = true;
    } else if (p.wallSolid > 0.001 && touchesWall(b, wall)) {
      const drag = Math.exp(-p.wallSolid * 14 * dt);
      b.vx *= drag;
      b.vy *= drag;
      hit = true;
    }
  }
  return hit;
}

/**
 * Keep a body inside the arena. The centered `wrap` fraction of every edge is
 * a wrap-around gap; elsewhere the edge is solid with `bounce` restitution.
 * Returns true if the body touched a solid edge.
 */
export function applyEdges(b: Body, B: Bounds, wrap: number, bounce: number): boolean {
  const W = B.x1 - B.x0, H = B.y1 - B.y0;
  const gapY = Math.abs(b.y - (B.y0 + B.y1) / 2) < (wrap * H) / 2; // can cross left/right edges here
  const gapX = Math.abs(b.x - (B.x0 + B.x1) / 2) < (wrap * W) / 2; // can cross top/bottom edges here
  let touched = false;
  if (gapY && b.x < B.x0) b.x += W;
  else if (gapY && b.x > B.x1) b.x -= W;
  else if (!gapY && b.x - b.r < B.x0) { b.x = B.x0 + b.r; if (b.vx < 0) b.vx = -b.vx * bounce; touched = true; }
  else if (!gapY && b.x + b.r > B.x1) { b.x = B.x1 - b.r; if (b.vx > 0) b.vx = -b.vx * bounce; touched = true; }
  if (gapX && b.y < B.y0) b.y += H;
  else if (gapX && b.y > B.y1) b.y -= H;
  else if (!gapX && b.y - b.r < B.y0) { b.y = B.y0 + b.r; if (b.vy < 0) b.vy = -b.vy * bounce; touched = true; }
  else if (!gapX && b.y + b.r > B.y1) { b.y = B.y1 - b.r; if (b.vy > 0) b.vy = -b.vy * bounce; touched = true; }
  return touched;
}

/** Restitution of solid arena edges. */
export function edgeBounce(p: Params): number {
  return Math.min(1.3, p.edgeBounce);
}

/** Environmental forces shared by players, enemies and coins. */
export function applyFields(w: World, p: Params, b: Body, dt: number, weight = 1) {
  if (p.blackHole > 0) {
    const dx = CENTER.x - b.x, dy = CENTER.y - b.y;
    const d = Math.max(Math.hypot(dx, dy), 1);
    const a = 2000 * p.blackHole * Math.min(1, 260 / d) * weight;
    b.vx += (dx / d) * a * dt;
    b.vy += (dy / d) * a * dt;
  }
  if (p.conveyor > 0) {
    const band = Math.floor(b.y / 150);
    b.vx += (band % 2 === 0 ? 1 : -1) * p.conveyor * weight * dt;
  }
  if (p.quake > 0 && w.rng.chance(6 * dt)) {
    const a = w.rng.range(0, Math.PI * 2);
    const kick = 260 * p.quake * weight;
    b.vx += Math.cos(a) * kick;
    b.vy += Math.sin(a) * kick;
  }
}

export function windDir(time: number): { x: number; y: number } {
  const a = time * 0.25 + Math.sin(time * 0.13) * 2;
  return { x: Math.cos(a), y: Math.sin(a) };
}

export function inBlackHole(p: Params, b: Body): boolean {
  return p.blackHole > 0.05 && Math.hypot(b.x - CENTER.x, b.y - CENTER.y) < 36 * p.blackHole;
}

export function limitSpeed(b: Body, max: number) {
  const s = Math.hypot(b.vx, b.vy);
  if (s > max) { b.vx *= max / s; b.vy *= max / s; }
}
