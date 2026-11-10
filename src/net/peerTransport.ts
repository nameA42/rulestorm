import Peer, { type DataConnection } from 'peerjs';
import type { Link } from './link';

/**
 * WebRTC links via PeerJS. Only connection setup goes through the PeerJS
 * public signalling server; game traffic is browser-to-browser.
 */

const PREFIX = 'rulestorm-v1-';
const TIMEOUT_MS = 12000;

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
    const peer = id ? new Peer(id) : new Peer();
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
    const timer = setTimeout(() => { peer.destroy(); reject(new Error('Room not found or not reachable')); }, TIMEOUT_MS);
    peer.once('error', (e) => { clearTimeout(timer); peer.destroy(); reject((e as { type?: string }).type === 'peer-unavailable' ? new Error('Room not found') : e); });
    conn.once('open', () => { clearTimeout(timer); resolve({ link: wrap(conn), destroy: () => peer.destroy() }); });
  });
}
