import { NoiseFieldRules } from '../src/rules/field/NoiseFieldRules';
import { describe, expect, it } from 'vitest';
import { CATALOG, emptyRuleState, RULE_IDS, type RuleId, type RuleState } from '../src/contracts/catalog';
import type { Intent, PlayerId, PlayerInfo, PlayerSystem } from '../src/contracts/players';
import type { RuleGenerator } from '../src/contracts/rules';
import type { SeedSource } from '../src/contracts/seed';
import { EFFECTS } from '../src/game/effects';
import { Game } from '../src/game/Game';
import { SeededRandomRules } from '../src/rules/random/SeededRandomRules';
import { TimedSeedSource } from '../src/seed/TimedSeedSource';
import { Rng } from '../src/shared/rng';

/** A PlayerSystem with scripted, deterministic inputs — proves the seam. */
class ScriptedPlayers implements PlayerSystem {
  private infos: PlayerInfo[] = [
    { id: 'p1', name: 'P1', color: 0x4fc3f7, local: true },
    { id: 'p2', name: 'P2', color: 0xffb74d, local: false },
  ];
  roster() { return this.infos; }
  inputsFor(tick: number): ReadonlyMap<PlayerId, Intent> {
    const rng = new Rng(tick * 7919 + 13);
    const m = new Map<PlayerId, Intent>();
    for (const p of this.infos) {
      m.set(p.id, { x: rng.int(-1, 1), y: rng.int(-1, 1), action: rng.chance(0.2) });
    }
    return m;
  }
}

/** A trivial alternative rules system — proves the game doesn't care which one it gets. */
class FixedRules implements RuleGenerator {
  readonly name = 'fixed';
  constructor(private state: RuleState) {}
  generate() { return this.state; }
}

const constantSeed: SeedSource = { seedAt: () => 1 };

describe('catalog', () => {
  it('has exactly 100 unique rules, each with an effect', () => {
    expect(CATALOG.length).toBe(100);
    expect(new Set(RULE_IDS).size).toBe(100);
    for (const id of RULE_IDS) expect(typeof EFFECTS[id]).toBe('function');
    expect(Object.keys(EFFECTS).length).toBe(100);
  });
});

describe('SeededRandomRules', () => {
  const gen = new SeededRandomRules();
  it('is deterministic', () => {
    expect(gen.generate(12345)).toEqual(gen.generate(12345));
  });
  it('varies with the seed and stays in range', () => {
    const seen = new Set<string>();
    for (let s = 0; s < 200; s++) {
      const st = gen.generate(s);
      const active = RULE_IDS.filter((id) => st[id] > 0);
      expect(active.length).toBeGreaterThanOrEqual(5);
      expect(active.length).toBeLessThanOrEqual(11);
      for (const id of RULE_IDS) expect(st[id]).toBeGreaterThanOrEqual(0), expect(st[id]).toBeLessThanOrEqual(1);
      seen.add(active.sort().join(','));
    }
    expect(seen.size).toBeGreaterThan(190);
  });
  it('never activates two rules from one exclusive group', () => {
    for (let s = 0; s < 500; s++) {
      const st = gen.generate(s);
      const groups = new Map<string, number>();
      for (const def of CATALOG) {
        const g = (def as { group?: string }).group;
        if (g && st[def.id] > 0) groups.set(g, (groups.get(g) ?? 0) + 1);
      }
      for (const n of groups.values()) expect(n).toBe(1);
    }
  });
  it('touches every rule eventually', () => {
    const ever = new Set<RuleId>();
    for (let s = 0; s < 400; s++) {
      const st = gen.generate(s);
      for (const id of RULE_IDS) if (st[id] > 0) ever.add(id);
    }
    expect(ever.size).toBe(100);
  });
});

describe('Game simulation', () => {
  const run = (ticks: number, seed = 42) => {
    const game = new Game({
      field: new NoiseFieldRules(seed),
      rules: new SeededRandomRules(),
      seeds: new TimedSeedSource(seed, 120), // change rules every 2s to exercise many sets
      players: new ScriptedPlayers(),
      worldSeed: seed,
    });
    for (let i = 0; i < ticks; i++) game.step();
    return game;
  };

  it('is fully deterministic (same seeds + same inputs → identical world)', () => {
    const a = run(3000);
    const b = run(3000);
    expect(JSON.stringify({ ...a.world, events: [] })).toBe(JSON.stringify({ ...b.world, events: [] }));
  });

  it('diverges with a different seed', () => {
    expect(JSON.stringify(run(600, 1).world.players)).not.toBe(JSON.stringify(run(600, 2).world.players));
  });

  it('runs every rule at full strength without breaking (NaN / escape)', () => {
    for (const id of RULE_IDS) {
      const st = emptyRuleState();
      st[id] = 1;
      const game = new Game({ field: new NoiseFieldRules(7), rules: new FixedRules(st), seeds: constantSeed, players: new ScriptedPlayers(), worldSeed: 7 });
      for (let i = 0; i < 400; i++) game.step();
      const w = game.world;
      for (const b of [...w.players, ...w.enemies, ...w.coins, ...w.bullets]) {
        expect(Number.isFinite(b.x) && Number.isFinite(b.y), `${id}: non-finite position`).toBe(true);
        expect(b.x > -200 && b.x < 2000 && b.y > -200 && b.y < 1400, `${id}: escaped arena (${b.x},${b.y})`).toBe(true);
      }
      for (const p of w.players) expect(Number.isFinite(p.score) && Number.isFinite(p.hp), id).toBe(true);
    }
  });

  it('survives a long run of random rule combinations', () => {
    const g = run(20000, 99);
    expect(g.world.players.every((p) => Number.isFinite(p.x) && Number.isFinite(p.score))).toBe(true);
    expect(g.world.enemies.length).toBeLessThanOrEqual(42);
  });

  it('gets distinct rule effects from the same rule id regardless of generator', () => {
    const st = emptyRuleState();
    st['move.fast'] = 1;
    const g = new Game({ field: new NoiseFieldRules(7), rules: new FixedRules(st), seeds: constantSeed, players: new ScriptedPlayers(), worldSeed: 1 });
    g.step();
    expect(g.params.speed).toBeCloseTo(260 * 2.5);
  });
});
