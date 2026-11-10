/** One reliable, ordered, two-way message pipe between two peers. */
export interface Link {
  send(msg: unknown): void;
  onMessage(cb: (msg: unknown) => void): void;
  onClose(cb: () => void): void;
  close(): void;
}

/** Two in-memory ends of a Link (tests, and a reference implementation).
 *  Delivery is synchronous unless `queue` is given, in which case messages
 *  wait in it until the test flushes them. */
export function linkPair(queue?: (() => void)[]): [Link, Link] {
  const make = () => ({ msgs: [] as ((m: unknown) => void)[], closes: [] as (() => void)[], open: true });
  const a = make(), b = make();
  const end = (me: ReturnType<typeof make>, other: ReturnType<typeof make>): Link => ({
    send: (m) => {
      if (!me.open) return;
      const copy = JSON.parse(JSON.stringify(m));
      const deliver = () => { if (other.open) for (const cb of other.msgs) cb(copy); };
      if (queue) queue.push(deliver); else deliver();
    },
    onMessage: (cb) => { me.msgs.push(cb); },
    onClose: (cb) => { me.closes.push(cb); },
    close: () => {
      if (!me.open) return;
      me.open = false; other.open = false;
      for (const cb of [...me.closes, ...other.closes]) cb();
    },
  });
  return [end(a, b), end(b, a)];
}
