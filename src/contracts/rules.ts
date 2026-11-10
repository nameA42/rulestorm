import type { RuleState } from './catalog';

export type RuleCategory = 'movement' | 'world' | 'enemies' | 'coins' | 'combat' | 'camera';

/**
 * One entry in the rule vocabulary. The catalog says WHAT rules exist;
 * a rules system decides HOW STRONGLY each is active (0..1);
 * the game decides what each rule DOES. Every rule is a degree: any
 * strength in [0, 1] has a meaningful, gradual effect.
 */
export interface RuleDef {
  id: string;
  name: string;
  desc: string;
  category: RuleCategory;
  /** Rules sharing a group pull in different directions; seed-based
   *  generators avoid picking two of them at once. */
  group?: string;
}

/** A seed is a uint32. */
export type Seed = number;

/**
 * RULES-SYSTEM CONTRACT #1 — discrete: a seed picks a whole rule set.
 * Must be pure: same seed → same RuleState, on every machine.
 */
export interface RuleGenerator {
  readonly name: string;
  generate(seed: Seed): RuleState;
}

/**
 * RULES-SYSTEM CONTRACT #2 — continuous: an n-dimensional space where every
 * point is a rule set and nearby points have similar rule sets. Moving
 * through it changes the rules gradually.
 * Must be pure and smooth: same coord → same RuleState; small step → small change.
 */
export interface RuleField {
  readonly name: string;
  readonly dims: number;
  sample(coord: readonly number[]): RuleState;
  /**
   * Optional: every rule's raw, unthresholded field value at coord (CATALOG
   * order; higher = more on). Lets players steer toward a rule and see which
   * rules a direction pushes.
   */
  values?(coord: readonly number[]): ArrayLike<number>;
  /**
   * Optional fast path for maps: rule strengths on a res×res grid over the
   * plane center + a·u + b·v, a and b from −range to +range.
   * Layout: out[(row * res + col) * ruleCount + rule].
   */
  sampleGrid?(center: readonly number[], u: readonly number[], v: readonly number[], range: number, res: number): Float32Array;
  /** Optional human-readable status. */
  describe?(): string;
  /** Optional save/sync support (plain JSON). */
  snapshot?(): unknown;
  restore?(state: unknown): void;
}
