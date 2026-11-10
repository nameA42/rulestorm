import { CATALOG, emptyRuleState, RULE_IDS, type MutableRuleState, type RuleId, type RuleState } from '../contracts/catalog';
import type { PlayerSystem } from '../contracts/players';
import type { RuleCategory, RuleField, RuleGenerator, Seed } from '../contracts/rules';
import type { SeedContext, SeedOverlay, SeedSource } from '../contracts/seed';
import { Rng } from '../shared/rng';
import { buildParams } from './effects';
import { sharedFieldPos } from './field';
import { defaultParams, type Params } from './params';
import { stepWorld } from './sim/step';
import { arenaBounds, createWorld, freeSpot, newPlayer, type World } from './world';

export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;
/** Strength per second rules fade at: seed sets jump, so fade slowly;
 *  the field is already smooth, so just take the edge off. */
const BLEND_SEED = 0.8;
const BLEND_FIELD = 3;
/** In field mode, announce rule changes at most this often (ticks). */
const ANNOUNCE_EVERY = 45;

/** 'seed': a seed source picks whole rule sets. 'field': rules are read from
 *  an n-dimensional noise field at the players' influence-weighted position. */
export type RuleMode = 'seed' | 'field';

export interface GameDeps {
  /** Discrete rules system (seed → rules). */
  rules: RuleGenerator;
  seeds: SeedSource;
  /** Continuous rules system (n-dim point → rules). */
  field: RuleField;
  players: PlayerSystem;
  worldSeed: number;
}

/** Everything the Game owns, as plain JSON (for saves). */
export interface GameSnapshot {
  world: World;
  seed: Seed | null;
  target: RuleState;
  blended: RuleState;
  overrides: [RuleId, number][];
  sections?: [RuleCategory, SectionMode][];
  ruleMode?: RuleMode;
  fieldWalk?: number;
}

/** Force a whole category of rules: 'on' (every rule, one per group) or 'off'. */
export type SectionMode = 'on' | 'off';

export interface RuleChange {
  tick: number;
  seed: Seed | null;
  added: RuleId[];
  removed: RuleId[];
}

const GROUP = new Map(CATALOG.map((r) => [r.id as RuleId, (r as { group?: string }).group]));
const CATEGORY = new Map(CATALOG.map((r) => [r.id as RuleId, r.category as RuleCategory]));

/**
 * Orchestrator. Depends only on contracts (RuleGenerator, RuleField,
 * SeedSource, PlayerSystem) — swap any implementation without touching this.
 */
export class Game {
  world: World;
  params: Params = defaultParams();
  ruleMode: RuleMode = 'seed';
  /** How far walking across the arena moves you in the field (units per arena width; 0 = off, the default). */
  fieldWalk = 0;
  seed: Seed | null = null;
  /** What the rules system asked for. */
  target: RuleState = emptyRuleState();
  /** Target after fading. */
  private blended: MutableRuleState = emptyRuleState();
  /** Blended + overrides: what the game actually runs on. */
  readonly live: MutableRuleState = emptyRuleState();
  readonly overrides = new Map<RuleId, number>();
  /** Category-level forcing; per-rule overrides win over these. */
  readonly sections = new Map<RuleCategory, SectionMode>();
  lastChange: RuleChange | null = null;
  paused = false;
  private listeners = new Set<(c: RuleChange) => void>();
  private forced = new Map<RuleId, number>();
  private announced = new Set<RuleId>();

  constructor(readonly deps: GameDeps) {
    this.world = createWorld(deps.worldSeed, deps.field.dims);
  }

  /** Advance one fixed tick. Returns false if paused or still waiting on inputs. */
  step(): boolean {
    if (this.paused) return false;
    const inputs = this.deps.players.inputsFor(this.world.tick);
    if (!inputs) return false;

    this.syncRoster();
    this.refreshRules();
    this.blend();
    stepWorld(this.world, this.params, inputs, DT);
    return true;
  }

  /** Re-read the active rules system. Runs every tick; safe to call while paused. */
  refreshRules() {
    if (this.ruleMode === 'field') this.refreshField();
    else this.refreshSeed();
  }

  setRuleMode(mode: RuleMode) {
    if (mode === this.ruleMode) return;
    this.ruleMode = mode;
    this.seed = null; // seed mode regenerates; field mode ignores it
    this.announced = new Set(RULE_IDS.filter((id) => this.target[id] > 0.05));
  }

  seedContext(): SeedContext {
    return {
      tick: this.world.tick,
      players: this.world.players.filter((p) => p.alive).map((p) => ({ id: p.id, x: p.x, y: p.y })),
    };
  }

  seedStatus(): string {
    if (this.ruleMode === 'field') {
      const lead = [...this.world.players].sort((a, b) => b.influence - a.influence)[0];
      const pull = lead && lead.influence >= 0.5 ? ` · ${lead.name} pulling (+${lead.influence.toFixed(1)})` : '';
      return `field: ${this.deps.field.describe?.() ?? this.deps.field.name}${pull}`;
    }
    return this.deps.seeds.describe?.(this.seedContext()) ?? '';
  }

  seedOverlay(): SeedOverlay | null {
    return this.ruleMode === 'seed' ? this.deps.seeds.overlay?.() ?? null : null;
  }

  /** Fresh world with a new layout; rules are regenerated on the next tick. */
  restart(worldSeed: number) {
    this.world = createWorld(worldSeed, this.deps.field.dims);
    this.seed = null;
    this.target = emptyRuleState();
    this.blended = emptyRuleState();
    this.announced.clear();
    this.applyOverrides();
  }

  snapshot(): GameSnapshot {
    return JSON.parse(JSON.stringify({
      world: { ...this.world, events: [] },
      seed: this.seed,
      target: this.target,
      blended: this.blended,
      overrides: [...this.overrides],
      sections: [...this.sections],
      ruleMode: this.ruleMode,
      fieldWalk: this.fieldWalk,
    }));
  }

  restore(s: GameSnapshot) {
    const snap: GameSnapshot = JSON.parse(JSON.stringify(s));
    const rng = new Rng(0);
    rng.state = (snap.world.rng as unknown as { state: number }).state;
    this.world = { ...snap.world, rng, events: [] };
    this.seed = snap.seed;
    this.target = snap.target;
    this.blended = { ...snap.blended };
    this.overrides.clear();
    for (const [id, v] of snap.overrides) this.overrides.set(id, v);
    this.sections.clear();
    for (const [c, m] of snap.sections ?? []) this.sections.set(c, m);
    this.ruleMode = snap.ruleMode ?? 'seed';
    this.fieldWalk = snap.fieldWalk ?? 0;
    this.announced = new Set(RULE_IDS.filter((id) => this.target[id] > 0.05));
    this.applyOverrides();
  }

  onRuleChange(cb: (c: RuleChange) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  setOverride(id: RuleId, value: number | null) {
    if (value === null) this.overrides.delete(id);
    else this.overrides.set(id, Math.max(0, Math.min(1, value)));
    this.applyOverrides();
  }

  setSection(category: RuleCategory, mode: SectionMode | null) {
    if (mode === null) this.sections.delete(category);
    else this.sections.set(category, mode);
    this.applyOverrides();
  }

  /** Clears per-rule AND per-section forcing. */
  clearOverrides() {
    this.overrides.clear();
    this.sections.clear();
    this.applyOverrides();
  }

  /** The value a rule is pinned to by a rule or section override, if any. */
  forcedValue(id: RuleId): number | undefined {
    return this.forced.get(id);
  }

  /** Match world players to the player system roster (also runs every tick). */
  syncRoster() {
    const roster = this.deps.players.roster();
    const w = this.world;
    const ids = new Set(roster.map((r) => r.id));
    if (w.players.some((p) => !ids.has(p.id))) w.players = w.players.filter((p) => ids.has(p.id));
    for (const info of roster) {
      if (w.players.some((p) => p.id === info.id)) continue;
      const spot = freeSpot(w, 20, arenaBounds(this.params.arenaScale), [...w.enemies, ...w.players], 200);
      w.players.push(newPlayer(w, info, spot));
    }
  }

  // ── seed mode ─────────────────────────────────────────────────────
  private refreshSeed() {
    const seed = this.deps.seeds.seedAt(this.seedContext());
    if (seed !== this.seed) this.applySeed(seed);
  }

  private applySeed(seed: Seed) {
    const next = this.deps.rules.generate(seed);
    const first = this.seed === null && RULE_IDS.every((id) => this.blended[id] === 0);
    const added: RuleId[] = [];
    const removed: RuleId[] = [];
    for (const id of RULE_IDS) {
      if (this.forced.has(id)) continue; // pinned rules don't really change
      if (next[id] > 0 && this.target[id] <= 0) added.push(id);
      if (next[id] <= 0 && this.target[id] > 0) removed.push(id);
    }
    this.seed = seed;
    this.target = next;
    if (first) {
      Object.assign(this.blended, next);
      this.applyOverrides();
    }
    this.emit({ tick: this.world.tick, seed, added, removed });
  }

  // ── field mode ────────────────────────────────────────────────────
  private refreshField() {
    const coord = sharedFieldPos(this.world, this.fieldWalk);
    this.world.fieldCoord = coord;
    this.target = this.deps.field.sample(coord);
    if (this.world.tick % ANNOUNCE_EVERY === 0) {
      const now = new Set(RULE_IDS.filter((id) => this.target[id] > 0.05 && !this.forced.has(id)));
      const added = [...now].filter((id) => !this.announced.has(id));
      const removed = [...this.announced].filter((id) => !now.has(id) && !this.forced.has(id));
      this.announced = now;
      if (added.length || removed.length) this.emit({ tick: this.world.tick, seed: null, added, removed });
    }
  }

  private emit(c: RuleChange) {
    this.lastChange = c;
    for (const cb of this.listeners) cb(c);
  }

  private blend() {
    const field = this.ruleMode === 'field';
    // Seed mode: a rule fading out must not fight a newly-active rule in its group.
    const claimed = new Set<string>();
    if (!field) {
      for (const id of RULE_IDS) {
        const g = GROUP.get(id);
        if (g && this.target[id] > 0) claimed.add(g);
      }
    }
    const step = (field ? BLEND_FIELD : BLEND_SEED) * DT;
    for (const id of RULE_IDS) {
      const t = this.target[id];
      const g = GROUP.get(id);
      if (t === 0 && g && claimed.has(g)) {
        this.blended[id] = 0;
      } else {
        const cur = this.blended[id];
        this.blended[id] = cur < t ? Math.min(t, cur + step) : Math.max(t, cur - step);
      }
    }
    this.applyOverrides();
  }

  private applyOverrides() {
    // Section 'on': every rule in the category, but only one per group
    // (the one currently strongest, else the first listed).
    const groupPick = new Map<string, RuleId>();
    for (const id of RULE_IDS) {
      const g = GROUP.get(id);
      if (!g || this.sections.get(CATEGORY.get(id)!) !== 'on') continue;
      const cur = groupPick.get(g);
      if (cur === undefined || this.blended[id] > this.blended[cur]) groupPick.set(g, id);
    }
    this.forced.clear();
    for (const id of RULE_IDS) {
      let v = this.overrides.get(id);
      if (v === undefined) {
        const sm = this.sections.get(CATEGORY.get(id)!);
        const g = GROUP.get(id);
        if (sm === 'off') v = 0;
        else if (sm === 'on') v = g ? (groupPick.get(g) === id ? 1 : 0) : 1;
      }
      if (v !== undefined) this.forced.set(id, v);
      this.live[id] = v ?? this.blended[id];
    }
    this.params = buildParams(this.live);
  }
}
