import { CATALOG, emptyRuleState, type RuleState } from '../../contracts/catalog';
import type { RuleDef, RuleGenerator, Seed } from '../../contracts/rules';
import { Rng, hash32 } from '../../shared/rng';

export interface SeededRandomOptions {
  minActive?: number;
  maxActive?: number;
  /** Lowest strength a degree rule gets when it is picked. */
  minDegree?: number;
}

/**
 * The first rules system: shuffle the catalog with the seed and switch on a
 * handful of rules, respecting exclusive groups. Swap this class out for a
 * grammar (or anything else implementing RuleGenerator) and nothing else changes.
 */
export class SeededRandomRules implements RuleGenerator {
  readonly name = 'seeded-random';
  private readonly min: number;
  private readonly max: number;
  private readonly minDegree: number;

  constructor(
    private readonly catalog: readonly RuleDef[] = CATALOG,
    opts: SeededRandomOptions = {},
  ) {
    this.min = opts.minActive ?? 5;
    this.max = opts.maxActive ?? 11;
    this.minDegree = opts.minDegree ?? 0.35;
  }

  generate(seed: Seed): RuleState {
    const rng = new Rng(hash32('seeded-random-rules', seed));
    const state = emptyRuleState() as Record<string, number>;
    const target = rng.int(this.min, this.max);
    const usedGroups = new Set<string>();
    let active = 0;
    for (const def of rng.shuffle([...this.catalog])) {
      if (active >= target) break;
      if (def.group && usedGroups.has(def.group)) continue;
      state[def.id] =
        def.kind === 'toggle'
          ? 1
          : Math.round((this.minDegree + (1 - this.minDegree) * rng.next()) * 100) / 100;
      if (def.group) usedGroups.add(def.group);
      active++;
    }
    return state as RuleState;
  }
}
