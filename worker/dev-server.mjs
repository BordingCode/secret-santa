/* LOCAL TESTING ONLY, never deployed. Runs the same api.js as the real Worker
   but keeps wishlists in memory.
       node worker/dev-server.mjs   -> http://localhost:8789
   Point the app at it with ?wishes=http://localhost:8789 before the # */
import http from 'node:http';
import { handle } from './api.js';

export function memoryDb() {
  const rows = new Map();
  const res = new Map();
  return {
    rows,
    get: async (id) => rows.get(id)?.blob ?? null,
    put: async (id, blob, now) => { rows.set(id, { blob, updated: now }); },
    purge: async (before) => {
      for (const [id, r] of rows) if (r.updated < before) rows.delete(id);
      for (const [k, r] of res) if (r.updated < before) res.delete(k);
    },
    res,
    resList: async (id) => [...res.values()].filter(r => r.list === id).map(({ wish, holder }) => ({ wish, holder })),
    resTake: async (id, wish, holder, now) => {
      const k = id + '/' + wish;
      if (res.has(k)) return res.get(k).holder === holder;
      res.set(k, { list: id, wish, holder, updated: now });
      return true;
    },
    resDrop: async (id, wish, holder) => {
      const k = id + '/' + wish;
      if (res.get(k)?.holder === holder) res.delete(k);
    },
  };
}

export function serve(port = 8789, db = memoryDb()) {
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const c of req) raw += c;
    const r = await handle(new Request('http://localhost' + req.url,
      { method: req.method, headers: req.headers, body: ['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? undefined : raw }), db);
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(await r.text());
  });
  return new Promise(ok => server.listen(port, () => ok(server)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  serve().then(() => console.log('wishlist test server on http://localhost:8789'));
}
