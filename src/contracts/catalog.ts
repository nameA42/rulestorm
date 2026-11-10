import type { RuleCategory, RuleDef, RuleKind } from './rules';

/**
 * The rule VOCABULARY: 100 rules any generator can switch on.
 * Adding a rule = add it here + give it an effect in game/effects.ts
 * (the compiler enforces the second part).
 */

const cat =
  (category: RuleCategory) =>
  <const I extends string>(id: I, kind: RuleKind, name: string, desc: string, group?: string) =>
    ({ id, category, kind, name, desc, group }) as const;

const mv = cat('movement');
const wd = cat('world');
const en = cat('enemies');
const cn = cat('coins');
const cb = cat('combat');
const cm = cat('camera');
const T = 'toggle' as const;
const D = 'degree' as const;

export const CATALOG = [
  // ── Movement (20) ────────────────────────────────────────────────
  mv('move.fast', D, 'Fleet Feet', 'Players move faster.'),
  mv('move.slow', D, 'Heavy Boots', 'Players move slower.'),
  mv('move.ice', D, 'Ice Floor', 'Everything slides; momentum carries.'),
  mv('move.reverse', T, 'Reversed Controls', 'Up is down, left is right.'),
  mv('move.rotate', D, 'Twisted Controls', 'Input direction is rotated.'),
  mv('move.gravity', D, 'Gravity', 'A pull toward the bottom of the arena.'),
  mv('move.wind', D, 'Gusts', 'A wind that slowly changes direction.'),
  mv('move.drunk', D, 'Wobbly', 'Your steering wobbles.'),
  mv('move.cant_stop', T, "Can't Stop", 'Release the keys and you keep going.'),
  mv('move.four_way', T, 'Four-Way', 'No diagonal movement.'),
  mv('move.momentum', D, 'Build-Up', 'Moving straight builds up speed.'),
  mv('move.dash_power', D, 'Power Dash', 'Dashes go much further.'),
  mv('move.no_dash', T, 'No Dashing', 'The dash action is disabled.'),
  mv('move.swap_axes', T, 'Swapped Axes', 'Horizontal and vertical input are swapped.'),
  mv('move.tank', T, 'Tank Controls', 'Left/right turns, up/down drives.'),
  mv('move.attract', D, 'Buddy Magnet', 'Players are pulled toward each other.', 'player_force'),
  mv('move.repel', D, 'Personal Space', 'Players push each other away.', 'player_force'),
  mv('move.teleport', D, 'Unstable Atoms', 'Players randomly teleport.'),
  mv('move.grow', D, 'Big Bodies', 'Players are bigger.', 'player_size'),
  mv('move.shrink', D, 'Tiny Bodies', 'Players are smaller.', 'player_size'),

  // ── World (20) ───────────────────────────────────────────────────
  wd('world.wrap', T, 'Wraparound', 'Leaving one edge brings you in on the other.', 'edges'),
  wd('world.bouncy_edges', D, 'Rubber Edges', 'Arena edges bounce you back.', 'edges'),
  wd('world.lava_edges', T, 'Burning Edges', 'Touching the arena edge hurts.', 'edges'),
  wd('world.shrink', D, 'Closing In', 'The arena shrinks.'),
  wd('world.walls_bouncy', D, 'Springy Walls', 'Walls bounce you off.', 'wall_mode'),
  wd('world.walls_ghost', T, 'Phantom Walls', 'Walls can be walked through.', 'wall_mode'),
  wd('world.walls_hurt', T, 'Electric Walls', 'Walls hurt to touch.'),
  wd('world.walls_drift', D, 'Drifting Walls', 'Walls slide back and forth.'),
  wd('world.walls_hidden', T, 'Invisible Walls', 'Walls are still there. You just can\'t see them.'),
  wd('world.dark', D, 'Darkness', 'Vision closes in around the action.'),
  wd('world.lava_pools', D, 'Lava Pools', 'Pools of lava appear.'),
  wd('world.speed_pads', D, 'Boost Pads', 'Pads that fling you forward.'),
  wd('world.portals', T, 'Portals', 'Linked portal pairs.'),
  wd('world.conveyors', D, 'Conveyors', 'Bands of floor push sideways.'),
  wd('world.black_hole', D, 'Black Hole', 'A singularity pulls everything to the center.'),
  wd('world.quake', D, 'Earthquake', 'The ground shakes and shoves you.'),
  wd('world.night', D, 'Nightfall', 'The world dims.'),
  wd('world.ice_patches', D, 'Ice Patches', 'Slippery patches of ice.'),
  wd('world.mirror', T, 'Mirror World', 'The view is flipped left-to-right.'),
  wd('world.light_cycles', D, 'Light Cycles', 'Players leave trails that hurt others.'),

  // ── Enemies (18) ─────────────────────────────────────────────────
  en('enemy.swarm', D, 'Swarm', 'Many more enemies.', 'enemy_count'),
  en('enemy.none', T, 'Peaceful', 'No enemies at all.', 'enemy_count'),
  en('enemy.fast', D, 'Hasty Foes', 'Enemies move faster.', 'enemy_speed'),
  en('enemy.slow', D, 'Sluggish Foes', 'Enemies move slower.', 'enemy_speed'),
  en('enemy.hunt', D, 'Hunters', 'Enemies chase the nearest player.', 'enemy_ai'),
  en('enemy.flee', T, 'Scaredy Foes', 'Enemies run from players.', 'enemy_ai'),
  en('enemy.orbit', T, 'Satellites', 'Enemies circle the nearest player.', 'enemy_ai'),
  en('enemy.mimic', T, 'Mimics', 'Enemies move the way Player 1 moves.', 'enemy_ai'),
  en('enemy.giant', D, 'Giants', 'Enemies are much larger.'),
  en('enemy.split', T, 'Splitters', 'Shot enemies split in two.'),
  en('enemy.harmless', T, 'Toothless', 'Enemies do no damage.', 'enemy_contact'),
  en('enemy.healers', T, 'Medics', 'Touching enemies heals you.', 'enemy_contact'),
  en('enemy.edible', T, 'Snack Time', 'Touch enemies to eat them for points.', 'enemy_contact'),
  en('enemy.breed', D, 'Breeding', 'Enemies multiply over time.'),
  en('enemy.gunners', D, 'Gunners', 'Enemies shoot at players.'),
  en('enemy.blink', D, 'Blinkers', 'Enemies teleport short distances.'),
  en('enemy.cloaked', D, 'Cloaked', 'Enemies fade from view.'),
  en('enemy.thieves', T, 'Coin Thieves', 'Enemies steal coins off the floor.'),

  // ── Coins & scoring (17) ─────────────────────────────────────────
  cn('coin.rain', D, 'Coin Rain', 'Coins spawn much faster.'),
  cn('coin.magnet', D, 'Coin Magnet', 'Coins fly toward players.', 'coin_motion'),
  cn('coin.shy', D, 'Shy Coins', 'Coins run away from players.', 'coin_motion'),
  cn('coin.bouncy', T, 'Bouncing Coins', 'Coins bounce around the arena.'),
  cn('coin.rich', D, 'Gold Rush', 'Coins are worth more.'),
  cn('coin.cursed', T, 'Cursed Coins', 'Coins take points away.'),
  cn('coin.fleeting', D, 'Fleeting Coins', 'Coins vanish quickly.'),
  cn('coin.combo', D, 'Combo Chain', 'Quick consecutive pickups multiply value.'),
  cn('coin.shared', T, 'Share the Wealth', 'Every pickup scores for everyone.'),
  cn('coin.healing', T, 'Golden Apples', 'Coins heal you.'),
  cn('coin.explosive', T, 'Popcorn', 'Coins explode when picked up.'),
  cn('score.steal', T, 'Pickpocket', 'Bump another player to steal their points.'),
  cn('score.drain', D, 'Inflation', 'Score slowly drains away.'),
  cn('score.distance', D, 'Marathon', 'Score points for distance travelled.'),
  cn('score.stillness', T, 'Zen', 'Score points by standing still.'),
  cn('score.double', T, 'Double Points', 'All points are doubled.'),
  cn('score.hidden', T, 'Mystery Scores', 'Scores are hidden from the HUD.'),

  // ── Combat & health (15) ─────────────────────────────────────────
  cb('action.shoot', T, 'Blaster', 'Action button fires shots.', 'action_mode'),
  cb('action.shield', T, 'Shield', 'Action button raises a shield.', 'action_mode'),
  cb('action.blink', T, 'Blink', 'Action button teleports you forward.', 'action_mode'),
  cb('combat.autofire', D, 'Auto-Fire', 'Everyone fires automatically.'),
  cb('combat.ricochet', T, 'Ricochet', 'Shots bounce off walls and edges.'),
  cb('combat.homing', D, 'Homing Shots', 'Shots curve toward targets.'),
  cb('combat.heavy', D, 'Big Bullets', 'Bigger shots with more knockback.'),
  cb('combat.friendly_fire', T, 'Friendly Fire', 'Shots hurt other players.'),
  cb('combat.cooldown', D, 'Quick Hands', 'Shorter action cooldowns.'),
  cb('hp.regen', D, 'Regeneration', 'Health regenerates over time.'),
  cb('hp.glass', T, 'Glass Bones', 'Players take 5x damage.', 'damage_mod'),
  cb('hp.invulnerable', T, 'Invincible', 'Players take no damage.', 'damage_mod'),
  cb('hp.poison', D, 'Poisoned Air', 'Health slowly drains.'),
  cb('player.ghosts', T, 'Ghost Players', 'Players pass through each other.'),
  cb('player.tag', T, "Tag, You're It", 'Whoever is "it" bleeds points. Touch to pass it on.'),

  // ── Camera, visuals & time (10) ──────────────────────────────────
  cm('cam.zoom_in', D, 'Close-Up', 'The camera zooms in.', 'cam_zoom'),
  cm('cam.zoom_out', D, 'Wide Shot', 'The camera zooms out.', 'cam_zoom'),
  cm('cam.spin', D, 'Spinning Camera', 'The camera slowly rotates.'),
  cm('cam.lag', D, 'Lazy Camera', 'The camera is slow to follow.'),
  cm('vis.trails', D, 'Motion Trails', 'Everything leaves a ghostly trail.'),
  cm('vis.invert', T, 'Negative', 'Colors are inverted.'),
  cm('vis.hue', D, 'Psychedelic', 'Colors cycle through the rainbow.'),
  cm('vis.pixelate', D, 'Low-Res', 'The world is pixelated.'),
  cm('vis.blur', D, 'Blurry Vision', 'The world is blurred.'),
  cm('time.hyper', D, 'Hyperspeed', 'The whole game runs faster.'),
] as const satisfies readonly RuleDef[];

export type RuleId = (typeof CATALOG)[number]['id'];

/** Rule strength per id, 0 = inactive, 1 = fully active. */
export type RuleState = Readonly<Record<RuleId, number>>;
export type MutableRuleState = Record<RuleId, number>;

export const RULE_IDS: readonly RuleId[] = CATALOG.map((r) => r.id);

const BY_ID = new Map<string, RuleDef>(CATALOG.map((r) => [r.id, r]));
export function getRule(id: RuleId): RuleDef {
  return BY_ID.get(id)!;
}

export function emptyRuleState(): MutableRuleState {
  const s = {} as MutableRuleState;
  for (const id of RULE_IDS) s[id] = 0;
  return s;
}
