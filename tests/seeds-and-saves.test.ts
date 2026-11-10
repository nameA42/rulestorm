import { describe, expect, it } from 'vitest';
import type { Intent, PlayerId, PlayerInfo, PlayerSystem } from '../src/contracts/players';
import { Game } from '../src/game/Game';
import { SeededRandomRules } from '../src/rules/random/SeededRandomRules';
import { PositionSeedSource } from '../src/seed/PositionSeedSource';
import { SeedModes } from '../src/seed/SeedModes';
import { TimedSeedSource } from '../src/seed/TimedSeedSource';
import { Rng } from '../src/shared/rng';

const at = (tick: number, ...pts: [string, number, number][]) => ({ tick, players: pts.map(([id, x, y]) => ({ id, x, y })) });

describe('PositionSeedSource', () => {
  it('same zones → same seed; new zone → new seed', () => {
    const s = new PositionSeedSource(1, 300, 0);
    const a = s.seedAt(at(0, ['p1', 100, 100]));
    expect(s.seedAt(at(1, ['p1', 250, 280]))).toBe(a); // same cell
    expect(s.seedAt(at(2, ['p1', 350, 100]))).not.toBe(a); // next cell
  });

  it('does not depend on which player is where', () => {
    const s1 = new PositionSeedSource(9, 300, 0);
    const s2 = new PositionSeedSource(9, 300, 0);
    expect(s1.seedAt(at(0, ['p1', 10, 10], ['p2', 700, 500]))).toBe(s2.seedAt(at(0, ['p1', 700, 500], ['p2', 10, 10])));
  });

  it('hysteresis: hovering on a boundary does not flicker', () => {
    const s = new PositionSeedSource(1, 300, 28);
    const a = s.seedAt(at(0, ['p1', 290, 100]));
    expect(s.seedAt(at(1, ['p1', 310, 100]))).toBe(a); // 10px over: still old zone
    expect(s.seedAt(at(2, ['p1', 295, 100]))).toBe(a);
    const b = s.seedAt(at(3, ['p1', 340, 100])); // 40px over: switches
    expect(b).not.toBe(a);
    expect(s.seedAt(at(4, ['p1', 285, 100]))).toBe(b); // back 15px: stays in new zone
  });

  it('base seed changes the mapping', () => {
    expect(new PositionSeedSource(1).seedAt(at(0, ['p1', 5, 5]))).not.toBe(new PositionSeedSource(2).seedAt(at(0, ['p1', 5, 5])));
  });
});

describe('TimedSeedSource', () => {
  it('rolls over every period and can be paused', () => {
    const t = new TimedSeedSource(1, 10);
    const s0 = t.seedAt(at(0));
    for (let i = 1; i < 10; i++) expect(t.seedAt(at(i))).toBe(s0);
    const s1 = t.seedAt(at(10));
    expect(s1).not.toBe(s0);
    t.paused = true;
    for (let i = 11; i < 100; i++) expect(t.seedAt(at(i))).toBe(s1);
    t.paused = false;
    for (let i = 100; i < 109; i++) expect(t.seedAt(at(i))).toBe(s1);
    expect(t.seedAt(at(110))).not.toBe(s1);
  });
});

describe('SeedModes', () => {
  it('switches source without the game knowing', () => {
    const m = new SeedModes(5, 'timer');
    const ctxA = at(0, ['p1', 100, 100]);
    const timerSeed = m.seedAt(ctxA);
    m.mode = 'position';
    const posSeed = m.seedAt(at(1, ['p1', 100, 100]));
    expect(posSeed).not.toBe(timerSeed);
    expect(m.seedAt(at(2, ['p1', 120, 120]))).toBe(posSeed);
    m.mode = 'both';
    expect(m.seedAt(at(3, ['p1', 120, 120]))).not.toBe(posSeed);
  });
});

class Scripted implements PlayerSystem {
  private infos: PlayerInfo[] = [
    { id: 'p1', name: 'P1', color: 1, local: true },
    { id: 'p2', name: 'P2', color: 2, local: true },
  ];
  roster() { return this.infos; }
  inputsFor(tick: number): ReadonlyMap<PlayerId, Intent> {
    const r = new Rng(tick * 31 + 7);
    return new Map(this.infos.map((p) => [p.id, { x: r.int(-1, 1), y: r.int(-1, 1), action: r.chance(0.2) }]));
  }
}

describe('save / load', () => {
  it('restoring a snapshot replays identically', () => {
    for (const mode of ['timer', 'position', 'both'] as const) {
      const make = () => {
        const seeds = new SeedModes(77, mode);
        seeds.timer.periodTicks = 90;
        return { seeds, game: new Game({ rules: new SeededRandomRules(), seeds, players: new Scripted(), worldSeed: 77 }) };
      };
      const a = make();
      for (let i = 0; i < 700; i++) a.game.step();
      const saved = { game: a.game.snapshot(), seeds: JSON.parse(JSON.stringify(a.seeds.snapshot())) };
      for (let i = 0; i < 900; i++) a.game.step();

      const b = make();
      for (let i = 0; i < 50; i++) b.game.step(); // different state first
      b.seeds.restore(saved.seeds);
      b.game.restore(saved.game);
      for (let i = 0; i < 900; i++) b.game.step();

      expect(JSON.stringify({ ...b.game.world, events: [] }), mode).toBe(JSON.stringify({ ...a.game.world, events: [] }));
      expect(b.game.seed, mode).toBe(a.game.seed);
    }
  });

  it('restart gives a fresh world', () => {
    const seeds = new SeedModes(3);
    const g = new Game({ rules: new SeededRandomRules(), seeds, players: new Scripted(), worldSeed: 3 });
    for (let i = 0; i < 300; i++) g.step();
    g.restart(3);
    seeds.reset();
    expect(g.world.tick).toBe(0);
    expect(g.world.players.length).toBe(0);
    g.step();
    expect(g.world.players.length).toBe(2);
    expect(g.seed).not.toBeNull();
  });
});
