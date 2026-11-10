import { describe, expect, it } from 'vitest';
import { applyCommand, captureState, restoreState, stateHash, type AppCommand, type AppState, type SaveData } from '../src/app/commands';
import { emptyRuleState, RULE_IDS } from '../src/contracts/catalog';
import type { Intent, PlayerInfo, PlayerSystem } from '../src/contracts/players';
import { sharedFieldPos } from '../src/game/field';
import { Game } from '../src/game/Game';
import { NAV_SPEED } from '../src/game/sim/playerSim';
import { linkPair } from '../src/net/link';
import { NetPlayers, type NetHooks } from '../src/net/NetPlayers';
import { PlayerSwitch } from '../src/players/PlayerSwitch';
import { NoiseFieldRules, placeholderImage } from '../src/rules/field/NoiseFieldRules';
import { SeededRandomRules } from '../src/rules/random/SeededRandomRules';
import { SeedModes } from '../src/seed/SeedModes';
import { Rng } from '../src/shared/rng';

const maxDiff = (a: Record<string, number>, b: Record<string, number>) => Math.max(...RULE_IDS.map((id) => Math.abs(a[id] - b[id])));
const activeCount = (s: Record<string, number>) => RULE_IDS.filter((id) => s[id] > 0).length;

describe('NoiseFieldRules', () => {
  const c0 = [0.3, -1.2, 2.5, 0, 0.7, -0.4, 1.1, 3.3];

  it('is deterministic and seed-dependent', () => {
    expect(new NoiseFieldRules(5).sample(c0)).toEqual(new NoiseFieldRules(5).sample(c0));
    expect(new NoiseFieldRules(5).sample(c0)).not.toEqual(new NoiseFieldRules(6).sample(c0));
  });

  it('is smooth: a small step changes rules a little, a big step a lot', () => {
    for (const source of ['random', 'image'] as const) {
      const f = new NoiseFieldRules(9);
      f.source = source;
      let worstSmall = 0;
      let bigTotal = 0;
      const rng = new Rng(1);
      for (let k = 0; k < 40; k++) {
        const c = c0.map(() => rng.range(-20, 20));
        const near = c.map((v) => v + rng.range(-0.01, 0.01));
        const far = c.map((v) => v + rng.range(-6, 6));
        worstSmall = Math.max(worstSmall, maxDiff(f.sample(c), f.sample(near)));
        bigTotal += maxDiff(f.sample(c), f.sample(far));
      }
      expect(worstSmall, source).toBeLessThan(0.15);
      expect(bigTotal / 40, source).toBeGreaterThan(0.35);
    }
  });

  it('activity controls how many rules are on', () => {
    const f = new NoiseFieldRules(3);
    const rng = new Rng(2);
    const avg = (activity: number) => {
      f.activity = activity;
      let n = 0;
      for (let k = 0; k < 60; k++) n += activeCount(f.sample(c0.map(() => rng.range(-30, 30))));
      return n / 60;
    };
    const lo = avg(0.15), mid = avg(0.45), hi = avg(0.85);
    expect(lo).toBeLessThan(mid);
    expect(mid).toBeLessThan(hi);
    expect(mid).toBeGreaterThan(4);
    expect(mid).toBeLessThan(30);
  });

  it('every rule gets partial strengths somewhere (all rules are degrees)', () => {
    const f = new NoiseFieldRules(4);
    f.activity = 0.7;
    const seen = new Map<string, Set<number>>();
    const rng = new Rng(3);
    for (let k = 0; k < 400; k++) {
      const s = f.sample(c0.map(() => rng.range(-40, 40)));
      for (const id of RULE_IDS) {
        if (!seen.has(id)) seen.set(id, new Set());
        if (s[id] > 0.05 && s[id] < 0.95) seen.get(id)!.add(Math.round(s[id] * 10));
      }
    }
    for (const id of RULE_IDS) expect(seen.get(id)!.size, id).toBeGreaterThan(0);
  });

  it('image source differs from random and survives a snapshot', () => {
    const f = new NoiseFieldRules(8);
    const rnd = f.sample(c0);
    f.setImage(placeholderImage(99));
    f.source = 'image';
    const img = f.sample(c0);
    expect(img).not.toEqual(rnd);
    const g = new NoiseFieldRules(1);
    g.restore(JSON.parse(JSON.stringify(f.snapshot())));
    expect(g.sample(c0)).toEqual(img);
    expect(g.hasImage()).toBe(true);
  });
});

// ── exploration, coins and influence in the sim ────────────────────────
class Scripted implements PlayerSystem {
  script: (tick: number, id: string) => Partial<Intent> = () => ({});
  constructor(private infos: PlayerInfo[]) {}
  roster() { return this.infos; }
  inputsFor(tick: number) {
    return new Map(this.infos.map((p) => [p.id, { x: 0, y: 0, action: false, ...this.script(tick, p.id) }]));
  }
}
const P = (id: string): PlayerInfo => ({ id, name: id, color: 1, local: id === 'p1' });

function fieldGame(players: Scripted) {
  const field = new NoiseFieldRules(11);
  const g = new Game({ field, rules: new SeededRandomRules(), seeds: new SeedModes(11), players, worldSeed: 11 });
  g.setRuleMode('field');
  g.fieldWalk = 0;
  return { g, field };
}

describe('field exploration', () => {
  it('arrows travel along the chosen dims; cycling never lands on the other dim', () => {
    const ps = new Scripted([P('p1')]);
    const { g } = fieldGame(ps);
    g.step();
    const me = g.world.players[0];
    expect([me.dimX, me.dimY]).toEqual([0, 1]);
    const start = [...me.coord];

    ps.script = () => ({ navX: 1 });
    for (let i = 0; i < 60; i++) g.step();
    expect(me.coord[0] - start[0]).toBeCloseTo(NAV_SPEED, 1);
    expect(me.coord.slice(1)).toEqual(start.slice(1));

    const once = (s: Partial<Intent>) => { let done = false; ps.script = () => (done ? {} : ((done = true), s)); g.step(); };
    once({ cycleX: 1 });
    expect(me.dimX).toBe(2); // skipped 1, which the Y axis uses
    once({ cycleX: -1 });
    expect(me.dimX).toBe(0);
    once({ cycleX: -1 });
    expect(me.dimX).toBe(7); // wraps
    once({ cycleY: -1 });
    expect(me.dimY).toBe(0);
    once({ cycleY: -1 });
    expect(me.dimY).toBe(6); // skipped 7
    for (let k = 0; k < 30; k++) { once({ cycleX: 1 }); expect(me.dimX).not.toBe(me.dimY); }

    ps.script = () => ({ navY: -1 });
    const before = me.coord[me.dimY];
    for (let i = 0; i < 30; i++) g.step();
    expect(me.coord[me.dimY]).toBeLessThan(before);
  });

  it('rules follow you smoothly as you travel', () => {
    const ps = new Scripted([P('p1')]);
    const { g } = fieldGame(ps);
    ps.script = () => ({ navX: 1, navY: 0.5 });
    g.step();
    let prev = { ...g.target };
    let worst = 0;
    let changed = 0;
    for (let i = 0; i < 400; i++) {
      g.step();
      worst = Math.max(worst, maxDiff(prev, g.target));
      changed += maxDiff(prev, g.target) > 0 ? 1 : 0;
      prev = { ...g.target };
    }
    expect(worst).toBeLessThan(0.12); // gradual, never a jump
    expect(changed).toBeGreaterThan(200); // but always moving
  });

  it('walking around the arena moves you through the field when walk > 0', () => {
    const ps = new Scripted([P('p1')]);
    const { g } = fieldGame(ps);
    g.fieldWalk = 3;
    g.step();
    const c0 = [...g.world.fieldCoord];
    ps.script = () => ({ x: 1 });
    for (let i = 0; i < 90; i++) g.step();
    expect(Math.abs(g.world.fieldCoord[0] - c0[0])).toBeGreaterThan(0.2);
  });

  it('coins fill the wallet; Q spends one, Shift+Q spends all; influence decays', () => {
    const ps = new Scripted([P('p1')]);
    const { g } = fieldGame(ps);
    g.step();
    const me = g.world.players[0];
    // Drop three coins right on the player.
    for (let i = 0; i < 3; i++) g.world.coins.push({ id: 9000 + i, x: me.x, y: me.y, vx: 0, vy: 0, ttl: 10, dead: false });
    g.step();
    expect(me.wallet).toBe(3);

    let n = 0;
    ps.script = () => (n++ === 0 ? { spend: true } : {});
    g.step();
    expect(me.wallet).toBe(2);
    expect(me.influence).toBeCloseTo(1, 1);

    n = 0;
    ps.script = () => (n++ === 0 ? { spendAll: true } : {});
    g.step();
    expect(me.wallet).toBe(0);
    expect(me.influence).toBeCloseTo(3, 1);

    ps.script = () => ({});
    for (let i = 0; i < 15 * 60; i++) g.step(); // one half-life
    expect(me.influence).toBeGreaterThan(1.3);
    expect(me.influence).toBeLessThan(1.7);
  });

  it('influence pulls the shared rule position toward you', () => {
    const ps = new Scripted([P('p1'), P('p2')]);
    const { g } = fieldGame(ps);
    g.step();
    const [a, b] = g.world.players;
    a.coord = a.coord.map(() => 0);
    b.coord = b.coord.map(() => 10);
    expect(sharedFieldPos(g.world, 0)[0]).toBeCloseTo(5);
    a.influence = 3; // weight 4 vs 1
    expect(sharedFieldPos(g.world, 0)[0]).toBeCloseTo(2);
  });

  it('every rule at half strength runs cleanly', () => {
    for (const id of RULE_IDS) {
      const st = emptyRuleState();
      st[id] = 0.5;
      const g = new Game({
        field: new NoiseFieldRules(1),
        rules: { name: 'fixed', generate: () => st },
        seeds: { seedAt: () => 1 },
        players: new Scripted([P('p1'), P('p2')]),
        worldSeed: 3,
      });
      for (let i = 0; i < 240; i++) g.step();
      for (const b of [...g.world.players, ...g.world.enemies, ...g.world.coins, ...g.world.bullets]) {
        expect(Number.isFinite(b.x) && Number.isFinite(b.y), id).toBe(true);
        expect(b.x > -300 && b.x < 2100 && b.y > -300 && b.y < 1500, `${id} escaped`).toBe(true);
      }
    }
  });
});

describe('field mode over P2P', () => {
  it('two peers exploring and spending stay identical', () => {
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
      return { read: (): Intent => ({ x: r.int(-1, 1), y: r.int(-1, 1), action: r.chance(0.1), navX: r.int(-1, 1), navY: r.int(-1, 1), cycleX: r.chance(0.02) ? 1 : 0, spend: r.chance(0.05) }) };
    };
    const host = mk(21, (h) => NetPlayers.host(h, script(1)));
    host.game.step();
    host.game.world.players[0].wallet = 40; // host has coins to spend; travels to the client in the welcome
    const [hl, cl] = linkPair(queue);
    host.net.addLink(hl);
    const cli = mk(77, (h) => NetPlayers.client(h, script(2), cl));
    host.net.submit({ k: 'ruleMode', mode: 'field' } satisfies AppCommand);
    host.net.submit({ k: 'fieldImage', image: placeholderImage(5) } satisfies AppCommand);
    for (let r = 0; r < 900; r++) {
      flush();
      for (const p of [host, cli]) if (p.game.step()) p.hashes.set(p.game.world.tick, stateHash(p.state));
    }
    expect(cli.state.game.ruleMode).toBe('field');
    expect(cli.state.field.source).toBe('image');
    let compared = 0;
    for (const [t, h] of cli.hashes) if (host.hashes.has(t)) { expect(h, `tick ${t}`).toBe(host.hashes.get(t)); compared++; }
    expect(compared).toBeGreaterThan(700);
    expect(cli.net.desyncs).toBe(0);
    expect(host.game.world.players.some((p) => p.influence > 0)).toBe(true);
  });
});
