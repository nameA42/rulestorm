import type { PlayerEnt } from './world';

/**
 * Player orientation in the n-dimensional field.
 *
 * Any rotation in n dimensions is built out of rotations in 2-D planes, so the
 * controls only ever turn one plane at a time, and the planes on offer are the
 * ones the player can see: the map's two axes (spin) and each map axis against
 * a chosen third "depth" axis (tilt). Cycling the axes reaches every plane,
 * so every orientation is reachable with a handful of keys, in any number of
 * dimensions. Steering (turnToward) then covers "I want *that* rule" without
 * knowing which plane it lives in.
 *
 * Turn steps use a rational parametrisation of sin/cos (t = tan(θ/2)) so the
 * maths is plain + − × ÷ — bit-identical on every peer in lockstep play.
 */
const T = 0.0125; // ≈ 1.5 rad/s at 60 Hz
const COS = (1 - T * T) / (1 + T * T);
const SIN = (2 * T) / (1 + T * T);

/** Field direction of the player's axis k (a unit vector). */
export function axis(pl: PlayerEnt, n: number, k: number): number[] {
  const f = pl.frame;
  if (!f || f.length !== n * n) {
    const v = new Array(n).fill(0);
    v[k] = 1;
    return v;
  }
  return f.slice(k * n, k * n + n);
}

export function isTurned(pl: PlayerEnt): boolean {
  return !!pl.frame;
}

function ensureFrame(pl: PlayerEnt, n: number): number[] {
  if (!pl.frame || pl.frame.length !== n * n) {
    pl.frame = new Array(n * n).fill(0);
    for (let k = 0; k < n; k++) pl.frame[k * n + k] = 1;
  }
  return pl.frame;
}

/** Rotate axis a toward axis b (dir +1) or away (dir -1) by one tick's turn. */
export function turnPlane(pl: PlayerEnt, n: number, a: number, b: number, dir: number) {
  if (a === b || !dir) return;
  const f = ensureFrame(pl, n);
  const s = dir > 0 ? SIN : -SIN;
  for (let i = 0; i < n; i++) {
    const x = f[a * n + i], y = f[b * n + i];
    f[a * n + i] = COS * x + s * y;
    f[b * n + i] = COS * y - s * x;
  }
}

/**
 * Turn the whole frame (rigidly) so axis k swings toward `target` (unit) by at
 * most one tick's turn, in the plane the two span. Returns true once aligned.
 */
export function turnToward(pl: PlayerEnt, n: number, k: number, target: readonly number[]): boolean {
  const f = ensureFrame(pl, n);
  const u = f.slice(k * n, k * n + n);
  let d = 0;
  for (let i = 0; i < n; i++) d += u[i] * target[i];
  const w = new Array(n);
  let m = 0;
  for (let i = 0; i < n; i++) { w[i] = target[i] - d * u[i]; m += w[i] * w[i]; }
  m = Math.sqrt(m);
  if (m < 1e-9) {
    if (d > 0) return true;
    // Pointing straight away: any perpendicular will do — use the next axis.
    const j = (k + 1) % n;
    for (let i = 0; i < n; i++) w[i] = f[j * n + i];
    m = 1;
  } else {
    for (let i = 0; i < n; i++) w[i] /= m;
  }
  const done = d >= COS;
  const c = done ? d : COS;
  const s = done ? m : SIN;
  // In the (u, w) plane: u → c·u + s·w, w → c·w − s·u; everything else stays.
  for (let j = 0; j < n; j++) {
    let a = 0, b = 0;
    for (let i = 0; i < n; i++) { a += u[i] * f[j * n + i]; b += w[i] * f[j * n + i]; }
    for (let i = 0; i < n; i++) f[j * n + i] += (c - 1) * (a * u[i] + b * w[i]) + s * (a * w[i] - b * u[i]);
  }
  return done;
}

/** dot(v, axis k) without allocating. */
export function alongAxis(pl: PlayerEnt, n: number, k: number, v: readonly number[]): number {
  const f = pl.frame;
  if (!f || f.length !== n * n) return v[k] ?? 0;
  let s = 0;
  for (let i = 0; i < n; i++) s += f[k * n + i] * (v[i] ?? 0);
  return s;
}
