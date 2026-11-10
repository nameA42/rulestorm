import type { RuleState } from './catalog';

export type RuleKind = 'toggle' | 'degree';
export type RuleCategory = 'movement' | 'world' | 'enemies' | 'coins' | 'combat' | 'camera';

/**
 * One entry in the rule vocabulary. The catalog says WHAT rules exist;
 * a RuleGenerator decides WHICH are active (and how strongly);
 * the game decides what each rule DOES.
 */
export interface RuleDef {
  id: string;
  name: string;
  desc: string;
  category: RuleCategory;
  /** toggle: 0 or 1.  degree: any value in [0, 1]. */
  kind: RuleKind;
  /** Rules sharing a group are mutually exclusive (at most one active). */
  group?: string;
}

/** A seed is a uint32. */
export type Seed = number;

/**
 * THE RULES-SYSTEM CONTRACT.
 * Anything that can turn a seed into rule strengths can drive the game —
 * the seeded random picker today, a grammar or an LLM tomorrow.
 * Must be pure: same seed → same RuleState, on every machine.
 */
export interface RuleGenerator {
  readonly name: string;
  generate(seed: Seed): RuleState;
}
