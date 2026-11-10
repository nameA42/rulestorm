import { describe, expect, it } from 'vitest';
import { applyCommand, captureState, restoreState, stateHash, type AppCommand, type AppState, type SaveData } from '../src/app/commands';
import { RULE_IDS } from '../src/contracts/catalog';
import type { Intent, PlayerInfo, PlayerSystem } from '../src/contracts/players';
import { playerFieldPos, ruleDirection } from '../src/game/field';
import { axis, turnPlane, turnToward } from '../src/game/frame';
import { Game } from '../src/game/Game';
import { NAV_SPEED } from '../src/game/sim/playerSim';
import type { PlayerEnt } from '../src/game/world';
import { linkPair } from '../src/net/link';
import { NetPlayers, type NetHooks } from '../src/net/NetPlayers';
import { PlayerSwitch } from '../src/players/PlayerSwitch';
import { NoiseFieldRules } from '../src/rules/field/NoiseFieldRules';
import { SeededRandomRules } from '../src/rules/random/SeededRandomRules';
import { SeedModes } from '../src/seed/SeedModes';
import { Rng } from '../src/shared/rng';

const N = RULE_IDS.length;
const dot = (a: readonly number[], b: readonly number[]) => a.reduce((s, v, i) => s + v * b[i], 0);
const activeCount = (s: Record<string, number>) => RULE_IDS.filter((id) => s[id] > 0).length;

class Scripted implements PlayerSystem {
  script: (tick: number, id: string) => Partial<Intent> = () => ({});
  constructor(private infos: PlayerInfo[]) {}
  roster() { return this.infos; }
  inputsFor(tick: number) {
    return new Map(this.infos.map((p) => [p.id, { x: 0, y: 0, action: false, ...this.script(tick, p.id) }]));
  }
}
const P = (id: string): PlayerInfo => ({ id, name: id, color: 1, local: id === 'p1' });

describe('rotated rule space', () => {
  const axes = (seed = 4) => { const f = new NoiseFieldRules(seed); f.source = 'axes'; return f; };

  it('has one dimension per rule, and switching source changes dims', () => {
    const f = new NoiseFieldRules(4);
    expect(f.dims).toBe(8);
    f.source = 'axes';
    expect(f.dims).toBe(N);
    expect(f.describe()).toContain('rotated rule space');
  });

  it('each rule only cares about its own (rotated) axis', () => {
    // Moving perpendicular to rule r's axis must not change rule r at all;
    // moving along it does. The axis is what ruleDirection finds.
    const f = axes();
    const rng = new Rng(3);
    const c = Array.from({ length: N }, () => rng.range(-5, 5));
    const r = 17;
    const dir = ruleDirection(f, r, c, 1e-4)!;
    expect(dir).not.toBeNull();
    const perp = Array.from({ length: N }, () => rng.range(-1, 1));
    const k = dot(perp, dir);
    for (let i = 0; i < N; i++) perp[i] -= k * dir[i];
    const v0 = f.values(c)[r];
    expect(f.values(c.map((v, i) => v + 2 * perp[i]))[r]).toBeCloseTo(v0, 6);
    expect(f.values(c.map((v, i) => v + 0.2 * dir[i]))[r]).toBeGreaterThan(v0);
  });

  it('a step along one field axis nudges many rules (it is rotated, not axis-aligned)', () => {
    const f = axes();
    const c = new Array(N).fill(0.5);
    const a = f.values(c);
    const b = f.values(c.map((v, i) => (i === 0 ? v + 0.05 : v)));
    const moved = RULE_IDS.filter((_, r) => Math.abs(a[r] - b[r]) > 1e-4).length;
    expect(moved).toBeGreaterThan(80);
  });

  it('a sensible number of rules are on, and travel is gradual', () => {
    const f = axes(8);
    const rng = new Rng(5);
    let on = 0;
    for (let k = 0; k < 40; k++) on += activeCount(f.sample(Array.from({ length: N }, () => rng.range(-30, 30))));
    expect(on / 40).toBeGreaterThan(4);
    expect(on / 40).toBeLessThan(30);
    // 1/60 s of arrow travel never jumps a rule much.
    const c = Array.from({ length: N }, () => rng.range(-30, 30));
    let worst = 0;
    for (let t = 0; t < 300; t++) {
      const a = f.sample(c);
      c[3] += NAV_SPEED / 60;
      const b = f.sample(c);
      worst = Math.max(worst, ...RULE_IDS.map((id) => Math.abs(a[id] - b[id])));
    }
    expect(worst).toBeLessThan(0.1);
  });

  it('the map fast path (sampleGrid) matches sampling point by point, for every source', () => {
    for (const source of ['random', 'image', 'axes'] as const) {
      const f = new NoiseFieldRules(6);
      f.source = source;
      const n = f.dims;
      const rng = new Rng(4);
      const unitVec = () => { const v = Array.from({ length: n }, () => rng.range(-1, 1)); const m = Math.hypot(...v); return v.map((x) => x / m); };
      const center = Array.from({ length: n }, () => rng.range(-10, 10));
      const U = unitVec(), V = unitVec();
      const res = 7, range = 3;
      const grid = f.sampleGrid(center, U, V, range, res);
      let worst = 0;
      for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
        const a = ((i / (res - 1)) * 2 - 1) * range, b = ((j / (res - 1)) * 2 - 1) * range;
        const st = f.sample(center.map((v, k) => v + a * U[k] + b * V[k]));
        RULE_IDS.forEach((id, r) => { worst = Math.max(worst, Math.abs(st[id] - grid[(j * res + i) * N + r])); });
      }
      expect(worst, source).toBeLessThan(2e-3);
      const t = performance.now();
      f.sampleGrid(center, U, V, range, 44);
      console.log(`${source} map slice: ${(performance.now() - t).toFixed(1)} ms`);
    }
  });

  it('aligned: each field axis moves exactly one rule; a random tilt mixes them again', () => {
    const f = axes(8);
    f.setTilt(0);
    expect(f.describe()).toContain('aligned');
    const c = new Array(N).fill(0.7);
    const base = f.values(c);
    for (const k of [0, 13, 57, 99]) {
      const moved = f.values(c.map((v, i) => (i === k ? v + 0.3 : v)));
      const changed = RULE_IDS.map((_, r) => r).filter((r) => Math.abs(moved[r] - base[r]) > 1e-12);
      expect(changed).toEqual([k]);
    }
    f.setTilt(12345);
    const a = f.values(c), b = f.values(c.map((v, i) => (i === 0 ? v + 0.05 : v)));
    expect(RULE_IDS.filter((_, r) => Math.abs(a[r] - b[r]) > 1e-4).length).toBeGreaterThan(80);
    const g = new NoiseFieldRules(1);
    g.restore(f.snapshot());
    expect(g.tilt).toBe(12345);
    expect(g.values(c)).toEqual(f.values(c));
  });

  it('waves per axis: more waves change the profile; the default is unchanged; the map fast path agrees', () => {
    const rng = new Rng(21);
    const c = Array.from({ length: N }, () => rng.range(-5, 5));
    const f = axes(3);
    expect(f.axisWaveCount).toBe(3);
    const three = f.values(c);
    f.setAxisWaves(6);
    expect(f.values(c)).not.toEqual(three);
    expect(f.describe()).toContain('6 waves/axis');
    f.setAxisWaves(3);
    expect(f.values(c)).toEqual(three);
    f.setAxisWaves(99);
    expect(f.axisWaveCount).toBe(8);
    for (const k of [0, 1, 5, 8]) {
      f.setAxisWaves(k);
      const U = new Array(N).fill(0), V = new Array(N).fill(0);
      U[0] = 1; V[4] = 1;
      const grid = f.sampleGrid(c, U, V, 3, 5);
      const st = f.sample(c.map((v, i) => v + (i === 0 ? 1.5 : 0) + (i === 4 ? -3 : 0)));
      RULE_IDS.forEach((id, r) => expect(grid[(0 * 5 + 3) * N + r]).toBeCloseTo(st[id], 2));
    }
  });

  it('0 waves is linear: strength = your coordinate on the rule axis, bounded to 0..1', () => {
    const f = axes(5);
    f.setAxisWaves(0);
    f.setTilt(0);
    expect(f.describe()).toContain('linear');
    const c = new Array(N).fill(0);
    c[0] = 0.25; c[1] = 0.8; c[2] = 1.7; c[3] = -0.4;
    const st = f.sample(c);
    expect([st[RULE_IDS[0]], st[RULE_IDS[1]], st[RULE_IDS[2]], st[RULE_IDS[3]], st[RULE_IDS[4]]]).toEqual([0.25, 0.8, 1, 0, 0]);
    expect(f.bound(c.map((v) => Math.min(1, Math.max(0, v))))).toBeNull();
    const b = f.bound(c)!;
    expect([b[0], b[1], b[2], b[3]]).toEqual([0.25, 0.8, 1, 0]);
    // Tilted: the bound is in rule coordinates, so every rule coordinate ends up in 0..1.
    f.setTilt(777);
    const rng = new Rng(8);
    const far = Array.from({ length: N }, () => rng.range(-3, 3));
    const inside = f.bound(far)!;
    const p = f.values(inside); // linear: values are the rule coordinates
    for (let r = 0; r < N; r++) { expect(p[r]).toBeGreaterThan(-1e-9); expect(p[r]).toBeLessThan(1 + 1e-9); }
    expect(f.bound(inside)).toBeNull();
    // other modes are unbounded
    f.setAxisWaves(2);
    expect(f.bound(far)).toBeNull();
  });

  it('survives a snapshot', () => {
    const f = axes(12);
    const c = new Array(N).fill(1.5);
    const g = new NoiseFieldRules(1);
    g.restore(f.snapshot());
    expect(g.source).toBe('axes');
    expect(g.sample(c)).toEqual(f.sample(c));
  });
});

describe('turning the map', () => {
  const fake = (n: number) => ({ frame: null, aimDir: null } as unknown as PlayerEnt);

  it('plane turns stay a proper rotation after thousands of steps', () => {
    const n = N;
    const pl = fake(n);
    const rng = new Rng(9);
    for (let t = 0; t < 3000; t++) {
      const a = rng.int(0, n - 1);
      const b = (a + rng.int(1, n - 1)) % n;
      turnPlane(pl, n, a, b, rng.chance(0.5) ? 1 : -1);
    }
    for (const [i, j] of [[0, 0], [5, 5], [0, 1], [3, 70], [99, 98]]) {
      expect(dot(axis(pl, n, i), axis(pl, n, j))).toBeCloseTo(i === j ? 1 : 0, 9);
    }
  });

  it('a quarter turn swaps two axes', () => {
    const pl = fake(8);
    let ticks = 0;
    while (axis(pl, 8, 0)[2] < 0.9999 && ticks < 1000) { turnPlane(pl, 8, 0, 2, 1); ticks++; }
    expect(ticks).toBeGreaterThan(55); // ~1.5 rad/s → about a second
    expect(ticks).toBeLessThan(70);
    expect(axis(pl, 8, 2)[0]).toBeCloseTo(-1, 3);
  });

  it('turnToward lines an axis up with any target and keeps the frame rigid', () => {
    const n = N;
    const pl = fake(n);
    const rng = new Rng(2);
    const target = Array.from({ length: n }, () => rng.range(-1, 1));
    const m = Math.hypot(...target);
    for (let i = 0; i < n; i++) target[i] /= m;
    let ticks = 0;
    while (!turnToward(pl, n, 4, target) && ticks < 500) ticks++;
    expect(ticks).toBeLessThan(500);
    expect(dot(axis(pl, n, 4), target)).toBeCloseTo(1, 9);
    expect(dot(axis(pl, n, 4), axis(pl, n, 9))).toBeCloseTo(0, 9);
    expect(dot(axis(pl, n, 9), axis(pl, n, 9))).toBeCloseTo(1, 9);
  });
});

describe('turning and steering in the game', () => {
  function game(ps: Scripted, source: 'random' | 'axes' = 'axes') {
    const field = new NoiseFieldRules(11);
    field.source = source;
    const g = new Game({ field, rules: new SeededRandomRules(), seeds: new SeedModes(11), players: ps, worldSeed: 11 });
    g.setRuleMode('field');
    return { g, field };
  }

  it('linear mode keeps travellers inside the 0..1 box; travel along a rule axis takes it from off to full', () => {
    const ps = new Scripted([P('p1')]);
    const { g, field } = game(ps);
    field.setTilt(0);
    field.setAxisWaves(0);
    g.step();
    const me = g.world.players[0];
    me.coord = new Array(N).fill(0.5);
    ps.script = () => ({ navX: 1 });
    for (let i = 0; i < 120; i++) g.step(); // 1.8 units: hits the wall at 1
    expect(me.coord[0]).toBeCloseTo(1, 9);
    expect(g.target[RULE_IDS[0]]).toBe(1);
    ps.script = () => ({ navX: -1 });
    for (let i = 0; i < 120; i++) g.step();
    expect(me.coord[0]).toBeCloseTo(0, 9);
    expect(g.target[RULE_IDS[0]]).toBe(0);
    expect(me.coord[1]).toBeCloseTo(0.5, 9); // other rules untouched
    // Tilted: travelling slides along the walls but never leaves the box.
    field.setTilt(4242);
    ps.script = (t) => ({ navX: 1, navY: t % 200 < 100 ? 1 : -1, turnX: t % 50 < 10 ? 1 : 0 });
    for (let i = 0; i < 400; i++) {
      g.step();
      const p = field.values(me.coord);
      for (let r = 0; r < N; r++) expect(p[r] >= -1e-9 && p[r] <= 1 + 1e-9).toBe(true);
    }
  });

  it('the world resizes when the field changes dimension', () => {
    const ps = new Scripted([P('p1')]);
    const { g, field } = game(ps, 'random');
    g.step();
    expect(g.world.players[0].coord.length).toBe(8);
    field.source = 'axes';
    g.step();
    expect(g.world.fieldDims).toBe(N);
    expect(g.world.players[0].coord.length).toBe(N);
    expect(g.world.fieldCoord.length).toBe(N);
    field.source = 'random';
    g.step();
    expect(g.world.players[0].coord.length).toBe(8);
  });

  it('Shift+arrows tilt the map toward the depth axis; arrows then travel the tilted way', () => {
    const ps = new Scripted([P('p1')]);
    const { g } = game(ps);
    g.step();
    const me = g.world.players[0];
    const n = g.world.fieldDims;
    expect([me.dimX, me.dimY, me.dimZ]).toEqual([0, 1, 2]);
    ps.script = () => ({ turnX: 1 });
    for (let i = 0; i < 30; i++) g.step(); // ~0.75 rad
    const u = axis(me, n, 0);
    expect(u[0]).toBeGreaterThan(0.6);
    expect(u[2]).toBeGreaterThan(0.6);
    const start = [...me.coord];
    ps.script = () => ({ navX: 1 });
    for (let i = 0; i < 60; i++) g.step();
    const moved = me.coord.map((v, i) => v - start[i]);
    expect(moved[0]).toBeGreaterThan(0.3);
    expect(moved[2]).toBeGreaterThan(0.3);
    expect(Math.hypot(...moved)).toBeCloseTo(NAV_SPEED, 2); // same speed, new direction

    // depth cycling skips the map axes; O straightens
    let done = false;
    ps.script = () => (done ? {} : ((done = true), { cycleZ: -1 }));
    g.step();
    expect(me.dimZ).toBe(n - 1);
    done = false;
    ps.script = () => (done ? {} : ((done = true), { resetTurn: true }));
    g.step();
    expect(me.frame).toBeNull();
  });

  it('steering toward a rule turns → to where it grows; travelling → then strengthens it', () => {
    const ps = new Scripted([P('p1')]);
    const { g, field } = game(ps);
    g.step();
    const me = g.world.players[0];
    const n = g.world.fieldDims;
    const r = RULE_IDS.indexOf('gravity' as never) >= 0 ? RULE_IDS.indexOf('gravity' as never) : 10;
    let sent = false;
    ps.script = () => (sent ? {} : ((sent = true), { aim: RULE_IDS[r] }));
    g.step();
    expect(me.aimDir).not.toBeNull();
    const target = [...me.aimDir!];
    for (let i = 0; i < 200 && me.aimDir; i++) g.step();
    expect(me.aimDir).toBeNull();
    expect(dot(axis(me, n, me.dimX), target)).toBeCloseTo(1, 6);
    const before = field.values(playerFieldPos(me, g.fieldWalk))[r];
    ps.script = () => ({ navX: 1 });
    for (let i = 0; i < 6; i++) g.step();
    expect(field.values(playerFieldPos(me, g.fieldWalk))[r]).toBeGreaterThan(before);
  });
});

describe('rotated rule space over P2P', () => {
  it('two peers turning, steering and travelling stay identical', () => {
    const queue: (() => void)[] = [];
    const flush = () => { while (queue.length) queue.shift()!(); };
    const mk = (seed: number, connect: (h: NetHooks) => NetPlayers) => {
      const seeds = new SeedModes(seed);
      const field = new NoiseFieldRules(seed);
      const sw = new PlayerSwitch(new Scripted([P('p1')]));
      const game = new Game({ field, rules: new SeededRandomRules(), seeds, players: sw, worldSeed: seed });
      const state: AppState = { game, seeds, field, worldSeed: seed };
      const net = connect({
        tick: () => game.world.tick,
        snapshot: () => captureState(state, []),
        restore: (s) => restoreState(state, s as SaveData),
        apply: (c) => applyCommand(state, c as AppCommand),
        hash: () => stateHash(state),
      });
      sw.current = net;
      return { game, state, net, hashes: new Map<number, number>() };
    };
    const script = (seed: number) => {
      const r = new Rng(seed);
      return {
        read: (): Intent => ({
          x: r.int(-1, 1), y: r.int(-1, 1), action: r.chance(0.1),
          navX: r.int(-1, 1), navY: r.int(-1, 1),
          turnX: r.int(-1, 1), turnY: r.chance(0.3) ? r.int(-1, 1) : 0, spin: r.chance(0.2) ? 1 : 0,
          cycleZ: r.chance(0.02) ? 1 : 0, cycleX: r.chance(0.01) ? 1 : 0,
          aim: r.chance(0.01) ? RULE_IDS[r.int(0, N - 1)] : undefined,
        }),
      };
    };
    const host = mk(21, (h) => NetPlayers.host(h, script(1)));
    host.game.step();
    const [hl, cl] = linkPair(queue);
    host.net.addLink(hl);
    const cli = mk(77, (h) => NetPlayers.client(h, script(2), cl));
    host.net.submit({ k: 'ruleMode', mode: 'field' } satisfies AppCommand);
    host.net.submit({ k: 'fieldSource', source: 'axes' } satisfies AppCommand);
    for (let r = 0; r < 600; r++) {
      flush();
      for (const p of [host, cli]) if (p.game.step()) p.hashes.set(p.game.world.tick, stateHash(p.state));
    }
    expect(cli.state.field.source).toBe('axes');
    expect(cli.game.world.fieldDims).toBe(N);
    expect(cli.game.world.players.every((p) => p.frame !== null)).toBe(true);
    let compared = 0;
    for (const [t, h] of cli.hashes) if (host.hashes.has(t)) { expect(h, `tick ${t}`).toBe(host.hashes.get(t)); compared++; }
    expect(compared).toBeGreaterThan(450);
    expect(cli.net.desyncs).toBe(0);
  });
});
