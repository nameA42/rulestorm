import { IDLE, type Intent, type PlayerId, type PlayerInfo, type PlayerSystem } from '../contracts/players';
import type { InputSource } from '../players/KeyboardReader';
import type { Link } from './link';

/**
 * Peer-to-peer multiplayer as a PlayerSystem — the game doesn't know it's online.
 *
 * Host-relayed deterministic lockstep:
 *  - Every peer samples its own input for tick T+DELAY and sends it to the host.
 *  - When the host has everyone's input for tick T it broadcasts a FRAME
 *    (inputs + any scheduled commands), and every peer — host included —
 *    runs tick T with exactly that frame. Until a frame arrives, inputsFor()
 *    returns null and the game simply waits.
 *  - Shared-state changes (seed, rules, restarts, loads…) travel inside frames
 *    as commands, so they land on the same tick everywhere.
 *  - Joiners get a full snapshot (welcome), then frames from that tick on.
 *  - Every HASH_EVERY ticks the host includes a state hash; a peer that
 *    disagrees (e.g. float differences between browsers) asks for a resync.
 */

export const INPUT_DELAY = 4;
export const HASH_EVERY = 120;
export const MAX_PLAYERS = 8;
const COLORS = [0x4fc3f7, 0xffb74d, 0x81c784, 0xf06292, 0xba68c8, 0xfff176, 0x4db6ac, 0xe57373];

type NetCmd = { k: 'join'; info: PlayerInfo } | { k: 'leave'; id: PlayerId } | { k: 'app'; cmd: unknown };
interface Frame { tick: number; inputs: [PlayerId, Intent][]; cmds: NetCmd[]; hash?: number }
type Msg =
  | { t: 'hello' }
  | { t: 'welcome'; you: PlayerId; tick: number; state: unknown; roster: PlayerInfo[]; joinTicks: [PlayerId, number][] }
  | { t: 'in'; tick: number; i: Intent }
  | { t: 'frame'; f: Frame }
  | { t: 'cmd'; cmd: unknown }
  | { t: 'resync' }
  | { t: 'full' };

/** What the network layer needs from the app (wired in main.ts). */
export interface NetHooks {
  /** Tick the game will run next. */
  tick(): number;
  /** Full serializable state (for joiners / resync). */
  snapshot(): unknown;
  restore(state: unknown): void;
  /** Run a scheduled app command. */
  apply(cmd: unknown): void;
  /** Fingerprint of the deterministic state. */
  hash(): number;
}

export interface NetInfo {
  role: 'host' | 'client';
  me: PlayerId | null;
  roster: readonly PlayerInfo[];
  connected: boolean;
  desyncs: number;
  resyncs: number;
}

interface Peer { link: Link; id: PlayerId | null }

export class NetPlayers implements PlayerSystem {
  me: PlayerId | null = null;
  connected = true;
  desyncs = 0;
  resyncs = 0;
  private rosterList: PlayerInfo[] = [];
  private joinTicks = new Map<PlayerId, number>();
  private statusCbs = new Set<() => void>();

  // host
  private peers: Peer[] = [];
  private pending = new Map<number, Map<PlayerId, Intent>>();
  private queued: NetCmd[] = [];
  private gone = new Set<PlayerId>();

  // client
  private hostLink: Link | null = null;
  private frames = new Map<number, Frame>();
  private welcomed = false;
  private lastSent = -1;
  private resyncAsked = false;

  private constructor(
    readonly role: 'host' | 'client',
    private hooks: NetHooks,
    private input: InputSource,
  ) {}

  /** Become host. The existing P1 (id 'p1') keeps playing as the host's player. */
  static host(hooks: NetHooks, input: InputSource): NetPlayers {
    const n = new NetPlayers('host', hooks, input);
    n.me = 'p1';
    n.rosterList = [{ id: 'p1', name: 'P1', color: COLORS[0], local: true }];
    n.joinTicks.set('p1', hooks.tick());
    return n;
  }

  /** Join through a link to the host. Waits (inputsFor → null) until welcomed. */
  static client(hooks: NetHooks, input: InputSource, link: Link): NetPlayers {
    const n = new NetPlayers('client', hooks, input);
    n.hostLink = link;
    link.onMessage((m) => n.onClientMsg(m as Msg));
    link.onClose(() => { n.connected = false; n.emit(); });
    link.send({ t: 'hello' } satisfies Msg);
    return n;
  }

  // ── PlayerSystem ──────────────────────────────────────────────────
  roster(): readonly PlayerInfo[] {
    return this.rosterList;
  }

  inputsFor(tick: number): ReadonlyMap<PlayerId, Intent> | null {
    return this.role === 'host' ? this.hostTick(tick) : this.clientTick(tick);
  }

  // ── public API ────────────────────────────────────────────────────
  /** Schedule an app command onto the shared timeline. */
  submit(cmd: unknown) {
    if (this.role === 'host') this.queued.push({ k: 'app', cmd });
    else this.hostLink?.send({ t: 'cmd', cmd } satisfies Msg);
  }

  /** Host: accept a new peer connection. */
  addLink(link: Link) {
    const peer: Peer = { link, id: null };
    this.peers.push(peer);
    link.onMessage((m) => this.onHostMsg(peer, m as Msg));
    link.onClose(() => this.dropPeer(peer));
  }

  info(): NetInfo {
    return { role: this.role, me: this.me, roster: this.rosterList, connected: this.connected, desyncs: this.desyncs, resyncs: this.resyncs };
  }

  onStatus(cb: () => void): () => void {
    this.statusCbs.add(cb);
    return () => this.statusCbs.delete(cb);
  }

  close() {
    for (const p of this.peers) p.link.close();
    this.hostLink?.close();
    this.peers = [];
    this.connected = false;
  }

  // ── host ──────────────────────────────────────────────────────────
  private hostTick(T: number): ReadonlyMap<PlayerId, Intent> | null {
    this.put(T + INPUT_DELAY, this.me!, this.input.read());

    const inputs = new Map<PlayerId, Intent>();
    for (const p of this.rosterList) {
      if (T < (this.joinTicks.get(p.id) ?? 0) + INPUT_DELAY || this.gone.has(p.id)) {
        inputs.set(p.id, IDLE);
        continue;
      }
      const i = this.pending.get(T)?.get(p.id);
      if (!i) return null; // still waiting on someone
      inputs.set(p.id, i);
    }

    const frame: Frame = { tick: T, inputs: [...inputs], cmds: this.queued.splice(0) };
    if (T % HASH_EVERY === 0) frame.hash = this.hooks.hash();
    for (const peer of this.peers) if (peer.id) peer.link.send({ t: 'frame', f: frame } satisfies Msg);
    for (const k of this.pending.keys()) if (k <= T) this.pending.delete(k);
    this.applyCmds(frame.cmds, T);
    return inputs;
  }

  private onHostMsg(peer: Peer, m: Msg) {
    switch (m.t) {
      case 'hello': {
        if (peer.id) return;
        const id = this.freeId();
        if (!id) { peer.link.send({ t: 'full' } satisfies Msg); peer.link.close(); return; }
        peer.id = id;
        const n = Number(id.slice(1));
        this.queued.push({ k: 'join', info: { id, name: `P${n}`, color: COLORS[(n - 1) % COLORS.length], local: false } });
        this.welcome(peer);
        this.emit();
        break;
      }
      case 'in':
        if (peer.id && m.tick >= this.hooks.tick()) this.put(m.tick, peer.id, m.i);
        break;
      case 'cmd':
        if (peer.id) this.queued.push({ k: 'app', cmd: m.cmd });
        break;
      case 'resync':
        if (peer.id) { this.resyncs++; this.welcome(peer); this.emit(); }
        break;
    }
  }

  /** Message handlers run between ticks, so the state now is "before tick T". */
  private welcome(peer: Peer) {
    peer.link.send({
      t: 'welcome',
      you: peer.id!,
      tick: this.hooks.tick(),
      state: this.hooks.snapshot(),
      roster: this.rosterList,
      joinTicks: [...this.joinTicks],
    } satisfies Msg);
  }

  private dropPeer(peer: Peer) {
    this.peers = this.peers.filter((p) => p !== peer);
    if (peer.id && this.rosterList.some((p) => p.id === peer.id)) {
      this.gone.add(peer.id);
      this.queued.push({ k: 'leave', id: peer.id });
    } else if (peer.id) {
      // Joined but not applied yet: cancel the join.
      this.queued = this.queued.filter((c) => !(c.k === 'join' && c.info.id === peer.id));
    }
    this.emit();
  }

  private freeId(): PlayerId | null {
    const used = new Set([...this.rosterList.map((p) => p.id), ...this.peers.map((p) => p.id)]);
    for (let n = 1; n <= MAX_PLAYERS; n++) if (!used.has(`p${n}`)) return `p${n}`;
    return null;
  }

  private put(tick: number, id: PlayerId, i: Intent) {
    let m = this.pending.get(tick);
    if (!m) this.pending.set(tick, (m = new Map()));
    m.set(id, { x: i.x, y: i.y, action: i.action });
  }

  // ── client ────────────────────────────────────────────────────────
  private clientTick(T: number): ReadonlyMap<PlayerId, Intent> | null {
    if (!this.welcomed || !this.hostLink) return null;
    while (this.lastSent < T + INPUT_DELAY) {
      this.lastSent++;
      if (this.lastSent >= T) this.hostLink.send({ t: 'in', tick: this.lastSent, i: this.input.read() } satisfies Msg);
    }
    const f = this.frames.get(T);
    if (!f) return null;
    this.frames.delete(T);
    if (f.hash !== undefined && !this.resyncAsked && this.hooks.hash() !== f.hash) {
      this.desyncs++;
      this.resyncAsked = true;
      this.hostLink.send({ t: 'resync' } satisfies Msg);
      this.emit();
    }
    this.applyCmds(f.cmds, T);
    return new Map(f.inputs);
  }

  private onClientMsg(m: Msg) {
    switch (m.t) {
      case 'welcome': {
        this.hooks.restore(m.state);
        this.me = m.you;
        this.rosterList = m.roster.map((p) => ({ ...p, local: p.id === m.you }));
        this.joinTicks = new Map(m.joinTicks);
        for (const k of this.frames.keys()) if (k < m.tick) this.frames.delete(k);
        if (!this.welcomed) this.lastSent = m.tick + INPUT_DELAY - 1; // host treats our first DELAY ticks as idle
        this.welcomed = true;
        this.resyncAsked = false;
        this.emit();
        break;
      }
      case 'frame':
        this.frames.set(m.f.tick, m.f);
        break;
      case 'full':
        this.connected = false;
        this.emit();
        break;
    }
  }

  // ── shared ────────────────────────────────────────────────────────
  private applyCmds(cmds: NetCmd[], T: number) {
    let rosterChanged = false;
    for (const c of cmds) {
      if (c.k === 'join') {
        if (!this.rosterList.some((p) => p.id === c.info.id)) {
          this.rosterList = [...this.rosterList, { ...c.info, local: c.info.id === this.me }];
          this.joinTicks.set(c.info.id, T);
          rosterChanged = true;
        }
      } else if (c.k === 'leave') {
        this.rosterList = this.rosterList.filter((p) => p.id !== c.id);
        this.joinTicks.delete(c.id);
        this.gone.delete(c.id);
        rosterChanged = true;
      } else {
        this.hooks.apply(c.cmd);
      }
    }
    if (rosterChanged) this.emit();
  }

  private emit() {
    for (const cb of this.statusCbs) cb();
  }
}
