import { describe, expect, it } from 'vitest';
import { applyCommand, captureState, restoreState, stateHash, type AppCommand, type AppState, type SaveData } from '../src/app/commands';
import { CATALOG, RULE_IDS } from '../src/contracts/catalog';
import type { Intent, PlayerSystem } from '../src/contracts/players';
import { Game } from '../src/game/Game';
import { linkPair } from '../src/net/link';
import { NetPlayers, type NetHooks } from '../src/net/NetPlayers';
import { PlayerSwitch } from '../src/players/PlayerSwitch';
import { SeededRandomRules } from '../src/rules/random/SeededRandomRules';
import { SeedModes } from '../src/seed/SeedModes';
import { Rng } from '../src/shared/rng';

const ctx = (tick: number, ...pts: [number, number][]) => ({ tick, players: pts.map(([x, y], i) => ({ id: `p${i + 1}`, x, y })) });

describe('constant position mode', () => {
  it('every distinct position is a new seed; standing still keeps it', () => {
    const m = new SeedModes(1, 'constant');
    const a = m.seedAt(ctx(0, [100, 100]));
    expect(m.seedAt(ctx(1, [100, 100]))).toBe(a);
    expect(m.seedAt(ctx(2, [101, 100]))).not.toBe(a);
  });
  it('precision coarsens it', () => {
    const m = new SeedModes(1, 'constant');
    m.exact.precision = 50;
    const a = m.seedAt(ctx(0, [100, 100]));
    expect(m.seedAt(ctx(1, [110, 90]))).toBe(a);
    expect(m.seedAt(ctx(2, [140, 100]))).not.toBe(a);
  });
});

describe('timed position mode', () => {
  it('samples positions only when the timer rolls over', () => {
    const m = new SeedModes(1, 'timerpos');
    m.timer.periodTicks = 10;
    const a = m.seedAt(ctx(0, [100, 100]));
    for (let t = 1; t < 10; t++) expect(m.seedAt(ctx(t, [100 + t * 30, 100]))).toBe(a); // moving doesn't matter
    const b = m.seedAt(ctx(10, [700, 300]));
    expect(b).not.toBe(a);
    expect(m.seedAt(ctx(11, [50, 50]))).toBe(b);
    expect(m.overlay()?.points).toEqual([{ x: 700, y: 300 }]);
  });
  it('same sampled positions → same seed regardless of epoch', () => {
    const m1 = new SeedModes(4, 'timerpos'), m2 = new SeedModes(4, 'timerpos');
    m2.timer.rerollNow();
    expect(m1.seedAt(ctx(0, [5, 5]))).toBe(m2.seedAt(ctx(0, [5, 5])));
  });
});

class Idle implements PlayerSystem {
  roster() { return [{ id: 'p1', name: 'P1', color: 1, local: true }]; }
  inputsFor() { return new Map([['p1', { x: 0, y: 0, action: false }]]); }
}

describe('section overrides', () => {
  const game = () => {
    const g = new Game({ rules: new SeededRandomRules(), seeds: new SeedModes(2), players: new Idle(), worldSeed: 2 });
    g.step();
    return g;
  };
  it('OFF silences a whole category', () => {
    const g = game();
    g.setSection('enemies', 'off');
    for (const d of CATALOG) if (d.category === 'enemies') expect(g.live[d.id]).toBe(0);
  });
  it('ON enables the category with one rule per exclusive group', () => {
    const g = game();
    g.setSection('world', 'on');
    const groups = new Map<string, number>();
    for (const d of CATALOG) {
      if (d.category !== 'world') continue;
      const grp = (d as { group?: string }).group;
      if (grp) groups.set(grp, (groups.get(grp) ?? 0) + g.live[d.id]);
      else expect(g.live[d.id]).toBe(1);
    }
    for (const n of groups.values()) expect(n).toBe(1);
  });
  it('per-rule overrides beat the section; clearing resets both', () => {
    const g = game();
    g.setSection('movement', 'on');
    g.setOverride('move.fast', 0);
    expect(g.live['move.fast']).toBe(0);
    expect(g.live['move.slow']).toBe(1);
    g.clearOverrides();
    expect(g.sections.size).toBe(0);
    for (const id of RULE_IDS) expect(g.live[id]).toBe(g.target[id] > 0 ? g.live[id] : 0);
  });
  it('survives a save/restore', () => {
    const g = game();
    g.setSection('coins', 'off');
    const s = g.snapshot();
    const g2 = game();
    g2.restore(s);
    expect(g2.sections.get('coins')).toBe('off');
  });
});

// ── P2P lockstep, simulated with in-memory links ───────────────────────
interface Peer { game: Game; state: AppState; net: NetPlayers; hashes: Map<number, number> }

function scripted(seed: number) {
  const r = new Rng(seed);
  let i: Intent = { x: 0, y: 0, action: false };
  return { read: () => { if (r.chance(0.05)) i = { x: r.int(-1, 1), y: r.int(-1, 1), action: r.chance(0.3) }; return i; } };
}

function makePeer(seed: number, worldSeed: number, connect: (hooks: NetHooks) => NetPlayers): Peer {
  const seeds = new SeedModes(worldSeed);
  seeds.timer.periodTicks = 150;
  const sw = new PlayerSwitch(new Idle());
  const game = new Game({ rules: new SeededRandomRules(), seeds, players: sw, worldSeed });
  const state: AppState = { game, seeds, worldSeed };
  const hooks: NetHooks = {
    tick: () => game.world.tick,
    snapshot: () => captureState(state, []),
    restore: (s) => restoreState(state, s as SaveData),
    apply: (c) => applyCommand(state, c as AppCommand),
    hash: () => stateHash(state),
  };
  const net = connect(hooks);
  sw.current = net;
  void seed;
  return { game, state, net, hashes: new Map() };
}

describe('P2P lockstep', () => {
  it('host + 2 clients (one late) stay identical, share commands, and recover from a desync', () => {
    const queue: (() => void)[] = [];
    const flush = () => { while (queue.length) queue.shift()!(); };

    const host = makePeer(1, 111, (h) => NetPlayers.host(h, scripted(1)));
    for (let i = 0; i < 100; i++) host.game.step(); // host was playing solo first

    const [h1, c1] = linkPair(queue);
    host.net.addLink(h1);
    const a = makePeer(2, 999 /* different local world: must be replaced */, (h) => NetPlayers.client(h, scripted(2), c1));
    const peers = [host, a];

    const round = () => {
      flush();
      for (const p of peers) {
        if (p.game.step()) p.hashes.set(p.game.world.tick, stateHash(p.state));
      }
    };

    for (let r = 0; r < 300; r++) round();

    // Late joiner
    const [h2, c2] = linkPair(queue);
    host.net.addLink(h2);
    const b = makePeer(3, 555, (h) => NetPlayers.client(h, scripted(3), c2));
    peers.push(b);
    for (let r = 0; r < 300; r++) round();

    // A client changes shared state: lands on every peer.
    a.net.submit({ k: 'setMode', mode: 'timerpos' } satisfies AppCommand);
    b.net.submit({ k: 'section', cat: 'enemies', mode: 'off' } satisfies AppCommand);
    for (let r = 0; r < 200; r++) round();
    for (const p of peers) {
      expect(p.state.seeds.mode).toBe('timerpos');
      expect(p.game.sections.get('enemies')).toBe('off');
      expect(p.game.world.players.map((x) => x.id).sort()).toEqual(['p1', 'p2', 'p3']);
    }

    // Force a desync on client A; the periodic hash check must repair it.
    a.game.world.players[0].x += 37;
    for (let r = 0; r < 400; r++) round();
    expect(a.net.desyncs).toBe(1);

    // Every tick all peers ran in common — after the repair — matches exactly.
    const repairedFrom = Math.max(...[...a.hashes.keys()].filter((t) => a.hashes.get(t) !== host.hashes.get(t)), 0) + 1;
    let compared = 0;
    for (const [t, hh] of host.hashes) {
      if (t < repairedFrom) continue;
      for (const p of [a, b]) {
        const ph = p.hashes.get(t);
        if (ph !== undefined) { expect(ph, `tick ${t}`).toBe(hh); compared++; }
      }
    }
    expect(compared).toBeGreaterThan(400);
    // And B (never desynced) matched the host from the moment it joined.
    for (const [t, bh] of b.hashes) if (host.hashes.has(t)) expect(bh).toBe(host.hashes.get(t));
  });

  it('a leaving client is removed for everyone and nobody stalls', () => {
    const queue: (() => void)[] = [];
    const flush = () => { while (queue.length) queue.shift()!(); };
    const host = makePeer(1, 7, (h) => NetPlayers.host(h, scripted(1)));
    const [h1, c1] = linkPair(queue);
    host.net.addLink(h1);
    const a = makePeer(2, 8, (h) => NetPlayers.client(h, scripted(2), c1));
    for (let r = 0; r < 120; r++) { flush(); host.game.step(); a.game.step(); }
    expect(host.game.world.players.length).toBe(2);
    c1.close();
    const t0 = host.game.world.tick;
    for (let r = 0; r < 60; r++) { flush(); host.game.step(); }
    expect(host.game.world.tick).toBeGreaterThan(t0 + 50);
    expect(host.game.world.players.map((p) => p.id)).toEqual(['p1']);
  });
});
