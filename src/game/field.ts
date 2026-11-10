import type { RuleField } from '../contracts/rules';
import { CENTER, WORLD_W, type PlayerEnt, type World } from './world';

/**
 * Where things are in the n-dimensional rule field.
 * A player's field position = their explored coordinate, plus (optionally)
 * an offset from where they stand in the arena along dims 0 and 1, so
 * walking around shifts the rules gradually.
 */
export function playerFieldPos(pl: PlayerEnt, walk: number): number[] {
  const c = [...pl.coord];
  if (walk > 0 && c.length >= 2) {
    c[0] += ((pl.x - CENTER.x) / WORLD_W) * walk;
    c[1] += ((pl.y - CENTER.y) / WORLD_W) * walk;
  }
  return c;
}

/** Weight of a player's pull on the shared rule position. */
export function fieldWeight(pl: PlayerEnt): number {
  return 1 + pl.influence;
}

/** The shared point the rules are read from: players' positions, weighted by influence. */
export function sharedFieldPos(w: World, walk: number): number[] {
  if (!w.players.length) return [...w.fieldOrigin];
  const out = new Array(w.fieldDims).fill(0);
  let total = 0;
  for (const pl of w.players) {
    const wt = fieldWeight(pl);
    const c = playerFieldPos(pl, walk);
    for (let i = 0; i < out.length; i++) out[i] += (c[i] ?? 0) * wt;
    total += wt;
  }
  return out.map((v) => v / total);
}

/**
 * The field direction that makes one rule stronger fastest, at coord
 * (numerical gradient of the field's raw value). null if the field can't say
 * or it's flat here.
 */
export function ruleDirection(field: RuleField, rule: number, coord: readonly number[], h = 0.1): number[] | null {
  if (!field.values) return null;
  const c = [...coord];
  const g = new Array(c.length).fill(0);
  let m = 0;
  for (let i = 0; i < c.length; i++) {
    c[i] = coord[i] + h;
    const a = field.values(c)[rule];
    c[i] = coord[i] - h;
    const b = field.values(c)[rule];
    c[i] = coord[i];
    g[i] = (a - b) / (2 * h);
    m += g[i] * g[i];
  }
  m = Math.sqrt(m);
  return m > 1e-6 ? g.map((v) => v / m) : null;
}
