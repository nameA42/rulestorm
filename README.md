# Rulestorm

A top-down arena game whose rules come from a seed and keep changing.
TypeScript + Phaser 3 + Vite.

```bash
npm install
npm run dev      # http://localhost:5180  (?seed=anything pins a seed, &mode=position|both|constant|timerpos)
npm test         # determinism, all 100 rules smoke-tested, generator properties
```

**Controls** (one player per browser; multiplayer is online-only):

| Key | Does |
|---|---|
| WASD | move in the arena |
| Space | action (dash / shot / shield / blink, blended by the rules) |
| Arrows | travel through the rule field along your map's two axes |
| Shift+Arrows | turn the map: tilt its → / ↓ axis toward the depth axis |
| , / . | spin the map within its own plane |
| B / N | previous / next depth axis |
| O | straighten the map (undo all turning) |
| ⌖ (panel, per rule) | steer: turn your → axis toward where that rule gets stronger |
| Z / X | previous / next dim for the map's horizontal axis |
| C / V | previous / next dim for the map's vertical axis (never the same as the other axis) |
| Q / Shift+Q | spend one coin / all your coins on influence |
| M | show / hide the field map |
| P · T · R · `` ` `` | pause · pause rule timer · randomize · toggle panel |

**Every rule is a degree.** All 100 rules take any strength from 0 to 1 and have a gradual effect. For example:
- **Wraparound:** the centred stretch of each edge that wraps grows with strength.
- **Mirror World:** the view turns like a page.
- **The action modes** (dash, shoot, shield, blink) blend together by their weights.
- **Enemy behaviours** (hunt, flee, orbit, mimic) mix together.
- **Walls** soften until you can wade through them.

**What makes the rules change** (panel → "Rules change by"):
- **✦ Noise field** (gradual): the rules are an 8-dimensional field of smooth noise. Every point in that space is a rule set, and nearby points are similar, so moving changes the rules gradually rather than all at once.
  - **Your position:** each player has their own position in the field. The arrow keys move you through it. Optionally, walking around the arena can also nudge you along dims 0 and 1: the *Walk* slider, which is off (0) by default.
  - **Shared rules:** the rules everyone plays under come from the players' average field position, weighted by influence.
  - **Influence:** every coin you pick up goes into your wallet. Spending coins (Q, or Shift+Q for all) adds influence, which pulls the shared rules toward your spot. Influence halves every 15 seconds.
  - **Noise source:** *Random* sums random plane waves. *Image* reads a picture you load: each rule looks at it through its own random projection from 8D to 2D, so bright and dark regions become rule regions.
    *Rule space* is 100-dimensional, one axis per rule, and each axis carries its own 1-D noise, so a rule only cares how far along its own axis you are. The space you travel in (field space) is a seeded random rotation of rule space, so every arrow-key step is a diagonal that nudges many rules at once.
  - **Turning:** each player has their own orientation in the field. Any n-D rotation is made of 2-D plane rotations, so the controls turn one plane at a time, and only planes you can see: the map's own plane (spin) and each map axis against a chosen *depth* axis (tilt). Cycling the axes reaches every plane, so a handful of keys covers any number of dimensions. For "I want *that* rule" there's steering (⌖ in the panel): your → axis swings smoothly to the direction that strengthens that rule fastest, and → then travels toward it. Under the map, *→* and *↓* list the rules each axis pushes most.
  - **Activity:** sets how many rules are on at once.
  - **Field map** (bottom right): shows a 2D slice of the field through your position along your two chosen dims. Colour shows the rule category and brightness shows how much is active. Players are dots, and the dashed ring is the shared rule position. Hover to list the rules at any point.
- **Timer:** a new rule set every N seconds. The timer can be paused or skipped.
- **Zones:** the arena is cut into zones. The set of zones the players are standing in picks the rules, so stepping into a new zone changes them. There's a 28px margin, so standing on a boundary doesn't make the rules flicker. The occupied zones are highlighted.
- **Zones+Timer:** a zone change *or* the timer changes the rules.
- **Live pos** (constant position): the players' exact positions pick the rules on every tick, so every pixel you move gives a new rule set. Stand still to keep the rules you like. The *Precision* slider rounds positions (for example, 25px) to calm it down. Anything that keeps you drifting, such as ice, wind or conveyors, also keeps the rules changing.
- **Timed pos** (timer position): the same as Live pos, but positions are only sampled when the timer rolls over. The sampled spot is marked with a crosshair.

**Sections:** each category header in the rule list has an `auto / ALL ON / ALL OFF` toggle. ALL ON switches on every rule in that category, but only one per mutually exclusive group (for example, one edge behaviour). A rule's own toggle beats its section's. "Clear forced" resets both.

**Online (P2P):** click **🌐 Host online game**, then **Copy invite link** and send it to your friends. Opening the link joins the game, and up to 8 players are supported, each in their own browser. Anyone can pause (it pauses everyone), randomize, change the mode or load a save, and every change applies on the same tick for all players. A player who joins mid-game receives a snapshot of the current game. Every 2 seconds the host sends a checksum of the game state; a client that disagrees (for example, from floating-point differences between browsers) is resynced automatically.
Under the hood this is host-relayed deterministic lockstep with a 4-tick input delay, in `src/net/NetPlayers.ts`. It's just another `PlayerSystem`, so the game code has no networking in it. Connections use WebRTC through PeerJS. Only the initial handshake uses PeerJS's free public signalling server (0.peerjs.com); game traffic goes directly between browsers. Some strict corporate or mobile networks block direct WebRTC, and those players would need a TURN relay, which isn't set up.

**Saves:** "Save current game" stores the whole match (world, scores, rules, seed mode, timer state and players) in this browser's localStorage. Loading one picks up exactly where it was; the simulation is deterministic, and a test checks this.

## Architecture: three systems, joined only by contracts

```
src/contracts/        ← the only things systems share
  catalog.ts          the 100-rule vocabulary (id, name, kind, group)
  rules.ts            RuleGenerator:  seed → RuleState (0..1 per rule)
  players.ts          PlayerSystem:   roster() + inputsFor(tick)
  seed.ts             SeedSource:     SeedContext{tick, player positions} → seed

src/rules/            RULES SYSTEMS  – random/SeededRandomRules (RuleGenerator: seed → rules)
                                       field/NoiseFieldRules (RuleField: n-dim point → rules)
src/players/          PLAYER SYSTEM  – LocalPlayers (one player), PlayerSwitch (local ↔ online)
src/net/              PLAYER SYSTEM  – NetPlayers: P2P lockstep over WebRTC (PeerJS)
src/app/              commands.ts (every shared-state change) + Session (offline/host/client)
src/seed/             SEED SOURCE    – SeedModes: timer | zones | both | constant | timerpos
src/saves/            SaveStore (localStorage slots)
src/game/             GAME           – depends on contracts only
  Game.ts             orchestrator: seed → rules → fade → params → step
  effects.ts          what each rule DOES (compiler-checked: one per rule)
  params.ts           the knobs effects bend
  sim/                deterministic fixed-step simulation (no Phaser, no Math.random)
  view/GameScene.ts   Phaser rendering, camera, post-FX, HUD
src/debug/            rule inspector panel (force/inspect any rule)
src/main.ts           composition root — the only file naming concrete classes
```

### Swapping a system

- **A grammar instead of random picks:** write a class that implements `RuleGenerator` and change one line in `main.ts`. The grammar's output is a strength (0 to 1) for each catalog rule. If you want the grammar to invent new kinds of rule, add them to `catalog.ts` and `effects.ts`.
- **Multiplayer:** done, as `NetPlayers`, without changing `src/game/`. Tests run a host and two clients over in-memory links, including a late join, shared commands, and a forced desync that gets repaired.
- **Another seed source:** implement `SeedSource` (it receives tick + player positions). `PositionSeedSource` is the example.

### Adding a rule

Add an entry to `CATALOG` in `contracts/catalog.ts`, then add its effect in `game/effects.ts`. The build fails until both exist. If the rule needs new behavior, add a field to `Params` and read it in `sim/`.

## Deploying to GitHub Pages

`.github/workflows/deploy.yml` tests, builds and deploys `dist/` on every push to `main`.

1. Make this folder (`rulestorm/`) the root of a GitHub repo and push it to `main`.
2. In the repo, go to Settings → Pages → Build and deployment and set **Source: GitHub Actions**.
3. The game is then served at `https://<user>.github.io/<repo>/`. Invite links use that URL automatically.

Vite is set to `base: './'`, so the build works from any subpath.
