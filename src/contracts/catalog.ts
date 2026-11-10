import type { RuleCategory, RuleDef } from './rules';

/**
 * The rule VOCABULARY: 100 rules any rules system can turn up or down.
 * Every rule is a degree in [0, 1] with a gradual effect.
 * Adding a rule = add it here + give it an effect in game/effects.ts
 * (the compiler enforces the second part).
 */

const cat =
  (category: RuleCategory) =>
  <const I extends string>(id: I, name: string, desc: string, group?: string) =>
    ({ id, category, name, desc, group }) as const;

const mv = cat('movement');
const wd = cat('world');
const en = cat('enemies');
const cn = cat('coins');
const cb = cat('combat');
const cm = cat('camera');

export const CATALOG = [
  // ── Movement (20) ────────────────────────────────────────────────
  mv('move.fast', 'Fleet Feet', 'Players move faster.'),
  mv('move.slow', 'Heavy Boots', 'Players move slower.'),
  mv('move.ice', 'Ice Floor', 'Everything slides; momentum carries.'),
  mv('move.reverse', 'Reversed Controls', 'Your controls rotate toward fully reversed.'),
  mv('move.rotate', 'Twisted Controls', 'Your controls are turned sideways.'),
  mv('move.gravity', 'Gravity', 'A pull toward the bottom of the arena.'),
  mv('move.wind', 'Gusts', 'A wind that slowly changes direction.'),
  mv('move.drunk', 'Wobbly', 'Your steering wobbles.'),
  mv('move.cant_stop', "Can't Stop", 'Let go of the keys and you keep coasting.'),
  mv('move.four_way', 'Four-Way', 'Movement snaps toward the four main directions.'),
  mv('move.momentum', 'Build-Up', 'Moving straight builds up speed.'),
  mv('move.dash_power', 'Power Dash', 'Dashes go much further.'),
  mv('move.no_dash', 'Weak Dash', 'Dashes get weaker, then stop working.'),
  mv('move.swap_axes', 'Swapped Axes', 'Horizontal and vertical input bleed into each other.'),
  mv('move.tank', 'Tank Controls', 'Steering blends toward tank controls: left/right turns, up/down drives.'),
  mv('move.attract', 'Buddy Magnet', 'Players are pulled toward each other.', 'player_force'),
  mv('move.repel', 'Personal Space', 'Players push each other away.', 'player_force'),
  mv('move.teleport', 'Unstable Atoms', 'Players randomly teleport.'),
  mv('move.grow', 'Big Bodies', 'Players are bigger.', 'player_size'),
  mv('move.shrink', 'Tiny Bodies', 'Players are smaller.', 'player_size'),

  // ── World (20) ───────────────────────────────────────────────────
  wd('world.wrap', 'Wraparound', 'The middle of each edge wraps to the other side; the gap widens with strength.', 'edges'),
  wd('world.bouncy_edges', 'Rubber Edges', 'Arena edges bounce you back.', 'edges'),
  wd('world.lava_edges', 'Burning Edges', 'Touching the arena edge burns.', 'edges'),
  wd('world.shrink', 'Closing In', 'The arena shrinks.'),
  wd('world.walls_bouncy', 'Springy Walls', 'Walls bounce you off.', 'wall_mode'),
  wd('world.walls_ghost', 'Phantom Walls', 'Walls soften until you can wade through them.', 'wall_mode'),
  wd('world.walls_hurt', 'Electric Walls', 'Walls shock you when you touch them.'),
  wd('world.walls_drift', 'Drifting Walls', 'Walls slide back and forth.'),
  wd('world.walls_hidden', 'Invisible Walls', "Walls fade out of view. They're still there."),
  wd('world.dark', 'Darkness', 'Vision closes in around the action.'),
  wd('world.lava_pools', 'Lava Pools', 'Pools of lava appear.'),
  wd('world.speed_pads', 'Boost Pads', 'Pads that fling you forward.'),
  wd('world.portals', 'Portals', 'Linked portal pairs open up and grow.'),
  wd('world.conveyors', 'Conveyors', 'Bands of floor push sideways.'),
  wd('world.black_hole', 'Black Hole', 'A singularity pulls everything to the center.'),
  wd('world.quake', 'Earthquake', 'The ground shakes and shoves you.'),
  wd('world.night', 'Nightfall', 'The world dims.'),
  wd('world.ice_patches', 'Ice Patches', 'Slippery patches of ice.'),
  wd('world.mirror', 'Mirror World', 'The view flips left-to-right, like turning a page.'),
  wd('world.light_cycles', 'Light Cycles', 'Players leave trails that hurt others.'),

  // ── Enemies (18) ─────────────────────────────────────────────────
  en('enemy.swarm', 'Swarm', 'Many more enemies.', 'enemy_count'),
  en('enemy.none', 'Peaceful', 'Fewer enemies; none at full strength.', 'enemy_count'),
  en('enemy.fast', 'Hasty Foes', 'Enemies move faster.', 'enemy_speed'),
  en('enemy.slow', 'Sluggish Foes', 'Enemies move slower.', 'enemy_speed'),
  en('enemy.hunt', 'Hunters', 'Enemies chase the nearest player.', 'enemy_ai'),
  en('enemy.flee', 'Scaredy Foes', 'Enemies run from players.', 'enemy_ai'),
  en('enemy.orbit', 'Satellites', 'Enemies circle the nearest player.', 'enemy_ai'),
  en('enemy.mimic', 'Mimics', "Enemies copy the first player's movement.", 'enemy_ai'),
  en('enemy.giant', 'Giants', 'Enemies are much larger.'),
  en('enemy.split', 'Splitters', 'Shot enemies may split in two.'),
  en('enemy.harmless', 'Toothless', 'Enemies hit softer, then not at all.', 'enemy_contact'),
  en('enemy.healers', 'Medics', 'Touching enemies heals you.', 'enemy_contact'),
  en('enemy.edible', 'Snack Time', 'Touch enemies to eat them for points.', 'enemy_contact'),
  en('enemy.breed', 'Breeding', 'Enemies multiply over time.'),
  en('enemy.gunners', 'Gunners', 'Enemies shoot at players.'),
  en('enemy.blink', 'Blinkers', 'Enemies teleport short distances.'),
  en('enemy.cloaked', 'Cloaked', 'Enemies fade from view.'),
  en('enemy.thieves', 'Coin Thieves', 'Enemies snatch coins off the floor.'),

  // ── Coins & scoring (17) ─────────────────────────────────────────
  cn('coin.rain', 'Coin Rain', 'Coins spawn much faster.'),
  cn('coin.magnet', 'Coin Magnet', 'Coins fly toward players.', 'coin_motion'),
  cn('coin.shy', 'Shy Coins', 'Coins run away from players.', 'coin_motion'),
  cn('coin.bouncy', 'Bouncing Coins', 'Coins bounce around the arena.'),
  cn('coin.rich', 'Gold Rush', 'Coins are worth more.'),
  cn('coin.cursed', 'Cursed Coins', 'Coins are worth less, then cost you points.'),
  cn('coin.fleeting', 'Fleeting Coins', 'Coins vanish quickly.'),
  cn('coin.combo', 'Combo Chain', 'Quick consecutive pickups multiply value.'),
  cn('coin.shared', 'Share the Wealth', 'Other players get a cut of every pickup.'),
  cn('coin.healing', 'Golden Apples', 'Coins heal you.'),
  cn('coin.explosive', 'Popcorn', 'Coins blow up when picked up.'),
  cn('score.steal', 'Pickpocket', 'Bump another player to steal their points.'),
  cn('score.drain', 'Inflation', 'Score slowly drains away.'),
  cn('score.distance', 'Marathon', 'Score points for distance travelled.'),
  cn('score.stillness', 'Zen', 'Standing still earns points.'),
  cn('score.double', 'Double Points', 'Points are multiplied, up to double.'),
  cn('score.hidden', 'Mystery Scores', 'Scores get blurrier, then hidden.'),

  // ── Combat & health (15) ─────────────────────────────────────────
  cb('action.shoot', 'Blaster', 'Your action button blends toward firing shots.', 'action_mode'),
  cb('action.shield', 'Shield', 'Your action button blends toward raising a shield.', 'action_mode'),
  cb('action.blink', 'Blink', 'Your action button blends toward a teleport.', 'action_mode'),
  cb('combat.autofire', 'Auto-Fire', 'Everyone fires automatically.'),
  cb('combat.ricochet', 'Ricochet', 'Shots keep more of their speed when they bounce.'),
  cb('combat.homing', 'Homing Shots', 'Shots curve toward targets.'),
  cb('combat.heavy', 'Big Bullets', 'Bigger shots with more knockback.'),
  cb('combat.friendly_fire', 'Friendly Fire', 'Shots hurt other players.'),
  cb('combat.cooldown', 'Quick Hands', 'Shorter action cooldowns.'),
  cb('hp.regen', 'Regeneration', 'Health regenerates over time.'),
  cb('hp.glass', 'Glass Bones', 'Players take up to 5x damage.', 'damage_mod'),
  cb('hp.invulnerable', 'Invincible', 'Players take less damage; none at full strength.', 'damage_mod'),
  cb('hp.poison', 'Poisoned Air', 'Health slowly drains.'),
  cb('player.ghosts', 'Ghost Players', 'Players pass through each other.'),
  cb('player.tag', "Tag, You're It", 'Whoever is "it" loses points. Touch someone to pass it on.'),

  // ── Camera, visuals & time (10) ──────────────────────────────────
  cm('cam.zoom_in', 'Close-Up', 'The camera zooms in.', 'cam_zoom'),
  cm('cam.zoom_out', 'Wide Shot', 'The camera zooms out.', 'cam_zoom'),
  cm('cam.spin', 'Spinning Camera', 'The camera slowly rotates.'),
  cm('cam.lag', 'Lazy Camera', 'The camera is slow to follow.'),
  cm('vis.trails', 'Motion Trails', 'Everything leaves a ghostly trail.'),
  cm('vis.invert', 'Negative', 'Colors invert.'),
  cm('vis.hue', 'Psychedelic', 'Colors cycle through the rainbow.'),
  cm('vis.pixelate', 'Low-Res', 'The world is pixelated.'),
  cm('vis.blur', 'Blurry Vision', 'The world is blurred.'),
  cm('time.hyper', 'Hyperspeed', 'The whole game runs faster.'),
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
