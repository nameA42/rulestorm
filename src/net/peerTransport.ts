import Peer, { type DataConnection } from 'peerjs';
import type { Link } from './link';

/**
 * WebRTC links via PeerJS. Only connection setup goes through the PeerJS
 * public signalling server; game traffic is browser-to-browser.
 *
 * Getting two browsers talking needs ICE servers:
 *  - STUN (free, public): lets peers find each other's public address. Enough
 *    for most home networks.
 *  - TURN (a relay): needed when a network won't accept direct connections
 *    (many mobile, school, office and carrier-grade NAT networks). PeerJS's
 *    built-in TURN servers no longer exist, so relays come from the build
 *    setting VITE_ICE_SERVERS (see vite-env.d.ts). Without one, players on
 *    such networks can't connect.
 *
 * Add ?relay=only to the page URL to force every connection through the relay
 * (a quick way to check the relay works, from a single machine).
 */

const PREFIX = 'rulestorm-v1-';
const TIMEOUT_MS = 15000;

const STUN: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

function configuredRelays(): RTCIceServer[] {
  const raw = import.meta.env?.VITE_ICE_SERVERS;
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as RTCIceServer | RTCIceServer[];
    return Array.isArray(v) ? v : [v];
  } catch {
    console.warn('VITE_ICE_SERVERS is not valid JSON; ignoring it');
    return [];
  }
}

/** Read once at load: the app tidies the address bar afterwards. */
const RELAY_ONLY = (() => {
  try { return new URLSearchParams(location.search).get('relay') === 'only'; } catch { return false; }
})();

function rtcConfig(): RTCConfiguration {
  return { iceServers: [...STUN, ...configuredRelays()], iceTransportPolicy: RELAY_ONLY ? 'relay' : 'all' };
}

/** True when a TURN relay is configured for this build. */
export function hasRelay(): boolean {
  return configuredRelays().some((s) => ([] as string[]).concat(s.urls).some((u) => /^turns?:/.test(u)));
}

const NO_PATH = hasRelay()
  ? "Found the room, but couldn't connect to the host, even through the relay"
  : "Found the room, but couldn't connect to the host. One of your networks blocks direct connections, and this site has no relay server set up for that";

function wrap(conn: DataConnection): Link {
  return {
    send: (m) => { if (conn.open) conn.send(m); },
    onMessage: (cb) => { conn.on('data', cb); },
    onClose: (cb) => {
      let done = false;
      const once = () => { if (!done) { done = true; cb(); } };
      conn.on('close', once);
      conn.on('error', once);
    },
    close: () => conn.close(),
  };
}

function randomRoom(): string {
  const a = 'abcdefghjkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
}

function openPeer(id?: string): Promise<Peer> {
  return new Promise((resolve, reject) => {
    const opts = { config: rtcConfig() };
    const peer = id ? new Peer(id, opts) : new Peer(opts);
    const timer = setTimeout(() => { peer.destroy(); reject(new Error('Timed out reaching the signalling server')); }, TIMEOUT_MS);
    peer.once('open', () => { clearTimeout(timer); resolve(peer); });
    peer.once('error', (e) => { clearTimeout(timer); peer.destroy(); reject(e); });
  });
}

export interface HostHandle {
  room: string;
  onLink(cb: (l: Link) => void): void;
  destroy(): void;
}

export async function hostRoom(): Promise<HostHandle> {
  let peer: Peer | null = null;
  let room = '';
  for (let attempt = 0; attempt < 3 && !peer; attempt++) {
    room = randomRoom();
    try { peer = await openPeer(PREFIX + room); }
    catch (e) { if ((e as { type?: string }).type !== 'unavailable-id') throw e; }
  }
  if (!peer) throw new Error('Could not reserve a room id');
  const p = peer;
  // If the signalling server drops us (network blip, long-hidden tab), re-register
  // so the room stays joinable. Existing players are unaffected either way.
  p.on('disconnected', () => {
    const retry = () => { if (!p.destroyed && p.disconnected) { p.reconnect(); setTimeout(retry, 5000); } };
    setTimeout(retry, 1000);
  });
  const cbs: ((l: Link) => void)[] = [];
  p.on('connection', (conn) => {
    conn.on('open', () => { const l = wrap(conn); for (const cb of cbs) cb(l); });
  });
  return { room, onLink: (cb) => cbs.push(cb), destroy: () => p.destroy() };
}

export async function joinRoom(room: string): Promise<{ link: Link; destroy(): void }> {
  const peer = await openPeer();
  return new Promise((resolve, reject) => {
    const conn = peer.connect(PREFIX + room, { reliable: true });
    let settled = false;
    const fail = (msg: string | Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      peer.destroy();
      reject(typeof msg === 'string' ? new Error(msg) : msg);
    };
    // The signalling server answers "peer-unavailable" quickly when no such
    // room exists, so a timeout means the room exists but no network path worked.
    const timer = setTimeout(() => fail(NO_PATH), TIMEOUT_MS);
    peer.once('error', (e) => fail((e as { type?: string }).type === 'peer-unavailable' ? 'Room not found. Check the code, and that the host still has the game open' : (e as Error)));
    conn.once('error', () => fail(NO_PATH));
    const pc = (conn as unknown as { peerConnection?: RTCPeerConnection }).peerConnection;
    pc?.addEventListener('iceconnectionstatechange', () => { if (pc.iceConnectionState === 'failed') fail(NO_PATH); });
    conn.once('open', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ link: wrap(conn), destroy: () => peer.destroy() });
    });
  });
}
