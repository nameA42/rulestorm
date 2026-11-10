import Phaser from 'phaser';
import type { AppCommand } from './app/commands';
import { fileToFieldImage } from './app/fieldImage';
import { Session } from './app/Session';
import type { PanelHost } from './debug/PanelHost';
import { RulePanel } from './debug/RulePanel';
import { FixedStepper, startHeartbeat } from './game/FixedStepper';
import { Game } from './game/Game';
import { FieldMap } from './game/view/FieldMap';
import { GameScene } from './game/view/GameScene';
import { KeyboardReader } from './players/KeyboardReader';
import { LocalPlayers } from './players/LocalPlayers';
import { PlayerSwitch } from './players/PlayerSwitch';
import { NoiseFieldRules } from './rules/field/NoiseFieldRules';
import { SeededRandomRules } from './rules/random/SeededRandomRules';
import { SaveStore } from './saves/SaveStore';
import { SEED_MODES, SeedModes, type SeedMode } from './seed/SeedModes';
import { TICKS_PER_SECOND } from './seed/TimedSeedSource';
import { hash32 } from './shared/rng';

/*
 * Composition root — the ONLY file that knows the concrete implementations.
 * To try a different rules system, player system or seed source, change
 * the line that constructs it here.
 */

const url = new URL(location.href);
const parseSeed = (s: string) => (/^\d+$/.test(s) ? Number(s) >>> 0 : hash32(s));
const randomSeed = () => (Math.random() * 2 ** 32) >>> 0;
const urlMode = url.searchParams.get('mode') as SeedMode | 'field' | null;
const roomParam = url.searchParams.get('room');

const baseSeed = url.searchParams.has('seed') ? parseSeed(url.searchParams.get('seed')!) : randomSeed();
const seeds = new SeedModes(baseSeed, urlMode && urlMode !== 'field' && SEED_MODES.includes(urlMode) ? urlMode : 'timer');
const rules = new SeededRandomRules(); // discrete rules system: seed → rule set
const field = new NoiseFieldRules(baseSeed, 8); // continuous rules system: 8-D noise field
const keyboard = new KeyboardReader(window); // the one local player's keys
const local = new LocalPlayers(keyboard);
const players = new PlayerSwitch(local); // offline ↔ P2P online

const game = new Game({ rules, seeds, field, players, worldSeed: baseSeed });
if (urlMode === 'field') game.setRuleMode('field');
// The simulation clock. Frames drive it while visible; a worker heartbeat keeps it
// ticking in background tabs so online games don't freeze when you tab away.
const stepper = new FixedStepper(game);
startHeartbeat(() => stepper.advance());
const session = new Session(game, seeds, field, baseSeed, players, local, () => keyboard);
const dispatch = (c: AppCommand) => session.dispatch(c);

// ── Phaser ────────────────────────────────────────────────────────────
const host = document.getElementById('game')!;
let phaser: Phaser.Game | null = null;

/** Boot Phaser only once the host has a real size — WebGL framebuffers
 *  created at 0×0 are incomplete and kill the renderer (e.g. hidden tabs). */
function bootWhenSized() {
  if (host.clientWidth < 2 || host.clientHeight < 2) return;
  if (phaser) {
    // Phaser only watches window resizes; the panel and app panes resize the host too.
    phaser.scale.refresh();
    return;
  }
  phaser = new Phaser.Game({
    type: Phaser.AUTO,
    parent: host,
    backgroundColor: '#06070b',
    scale: { mode: Phaser.Scale.RESIZE, width: host.clientWidth, height: host.clientHeight },
    scene: [new GameScene(game, stepper)],
  });
}
new ResizeObserver(bootWhenSized).observe(host);
bootWhenSized();

// ── URL: keep ?seed&mode shareable (offline), ?room while a client ────
function syncUrl() {
  const u = new URL(location.href);
  if (session.mode === 'client' || session.mode === 'joining') {
    u.search = '';
    if (session.room) u.searchParams.set('room', session.room);
  } else {
    u.searchParams.delete('room');
    u.searchParams.set('seed', String(seeds.baseSeed));
    if (seeds.mode === 'timer') u.searchParams.delete('mode');
    else u.searchParams.set('mode', seeds.mode);
    if (game.ruleMode === 'field') u.searchParams.set('mode', 'field');
  }
  if (u.toString() !== location.href) history.replaceState(null, '', u);
}
setInterval(syncUrl, 1000);
session.onChange(syncUrl);
syncUrl();

// ── Panel host ────────────────────────────────────────────────────────
const store = new SaveStore<ReturnType<Session['capture']>>();

const app: PanelHost = {
  game: {
    isPaused: () => game.paused,
    setPaused: (p) => { game.paused = p; },
    restart: () => dispatch({ k: 'restart', worldSeed: session.worldSeed }),
    newGame: () => dispatch({ k: 'restart', worldSeed: randomSeed() }),
  },
  rules: {
    setOverride: (id, v) => dispatch({ k: 'override', id, v }),
    setSection: (cat, mode) => dispatch({ k: 'section', cat, mode }),
    clearForced: () => dispatch({ k: 'clearForced' }),
  },
  seed: {
    getBase: () => seeds.baseSeed,
    setBase: (input) => dispatch({ k: 'setBase', seed: parseSeed(input.trim()) }),
    randomize: () => dispatch({ k: 'setBase', seed: randomSeed() }),
    rerollNow: () => dispatch({ k: 'skip' }),
    getMode: () => (game.ruleMode === 'field' ? 'field' : seeds.mode),
    setMode: (mode) => {
      if (mode === 'field') return dispatch({ k: 'ruleMode', mode: 'field' });
      dispatch({ k: 'ruleMode', mode: 'seed' });
      dispatch({ k: 'setMode', mode });
    },
    getPeriodSec: () => seeds.timer.periodTicks / TICKS_PER_SECOND,
    setPeriodSec: (seconds) => dispatch({ k: 'setPeriod', seconds }),
    getZoneSize: () => seeds.position.cellSize,
    setZoneSize: (px) => dispatch({ k: 'setZone', px }),
    getPrecision: () => seeds.exact.precision,
    setPrecision: (px) => dispatch({ k: 'setPrecision', px }),
    isTimerPaused: () => seeds.timer.paused,
    setTimerPaused: (paused) => dispatch({ k: 'timerPaused', paused }),
    shareLink: () => location.href,
  },
  field: {
    getSource: () => field.source,
    setSource: (source) => dispatch({ k: 'fieldSource', source }),
    hasImage: () => field.hasImage(),
    loadImage: async (file) => {
      try {
        dispatch({ k: 'fieldImage', image: await fileToFieldImage(file) });
        return null;
      } catch (e) {
        return `Couldn't read that image: ${(e as Error).message ?? e}`;
      }
    },
    clearImage: () => dispatch({ k: 'fieldImage', image: null }),
    getActivity: () => field.activity,
    setActivity: (value) => dispatch({ k: 'fieldActivity', value }),
    getWalk: () => game.fieldWalk,
    setWalk: (value) => dispatch({ k: 'fieldWalk', value }),
    dims: () => field.dims,
    steer: (id) => keyboard.aim(id),
    straighten: () => keyboard.straighten(),
  },
  saves: {
    list: () => store.list(),
    save: () => {
      const w = game.world;
      const best = Math.max(0, ...w.players.map((p) => Math.round(p.score)));
      const name = `${seeds.mode} · ${w.players.length}P · best ${best} · ${Math.floor(w.tick / TICKS_PER_SECOND)}s`;
      return store.save(name, session.capture()) ? null : `Save failed: ${store.lastError ?? 'storage unavailable'}`;
    },
    load: (id) => {
      const data = store.load(id);
      if (data?.version === 1) dispatch({ k: 'load', data });
    },
    remove: (id) => store.remove(id),
  },
  net: {
    mode: () => session.mode,
    room: () => session.room,
    error: () => session.error,
    info: () => session.net?.info() ?? null,
    inviteLink: () => session.shareLink(),
    host: () => { void session.host(); },
    join: (room) => { void session.join(room.trim().toLowerCase()); },
    leave: () => session.leave(),
  },
};

new RulePanel(document.getElementById('panel')!, game, app);
const fieldMap = new FieldMap(host, game);

if (roomParam) void session.join(roomParam);

// ── Hotkeys ───────────────────────────────────────────────────────────
window.addEventListener('keydown', (e) => {
  const el = e.target as HTMLElement | null;
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return;
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
  switch (e.code) {
    case 'Backquote': document.body.classList.toggle('panel-hidden'); break;
    case 'KeyP': app.game.setPaused(!app.game.isPaused()); break;
    case 'KeyT': app.seed.setTimerPaused(!app.seed.isTimerPaused()); break;
    case 'KeyR': app.seed.randomize(); break;
    case 'KeyM': fieldMap.toggle(); break;
    default: return;
  }
  e.preventDefault();
});

// Handy from the dev console.
Object.assign(window, { game, seeds, field, session, getPhaser: () => phaser });
