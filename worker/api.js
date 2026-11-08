/* Secret Santa wishlists: the request handling, shared by the real Worker
   (index.js, on Cloudflare D1) and the local test server (dev-server.mjs).

   The server only stores scrambled bytes under a meaningless id. It never sees
   a name, a wish or the group link, because all of that is encrypted on the
   phone with a key made from the link (see js/wishes.js). */

const HEX64 = /^[0-9a-f]{64}$/;
export const MAX_BLOB = 40_000;                 // 20 long wishes, encrypted, fit well inside this
export const KEEP_MS = 400 * 24 * 3600 * 1000;  // untouched lists are removed after a bit over a year

const CORS = {
  'Access-Control-Allow-Origin': '*',           // no cookies are used, so an open origin can't be abused for CSRF
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...CORS } });

/* db: { get(id) -> blob|null, put(id, blob, now), purge(before) } */
export async function handle(req, db, now = Date.now()) {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  const path = new URL(req.url).pathname;
  if (path === '/' || path === '/health') return json({ ok: true, service: 'secret-santa-wishes' });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const b = await req.json().catch(() => null);
  if (!b || !HEX64.test(b.id || '')) return json({ error: 'bad_request' }, 400);

  if (path === '/get') return json({ blob: await db.get(b.id) });
  if (path === '/put') {
    if (typeof b.blob !== 'string' || !b.blob) return json({ error: 'bad_request' }, 400);
    if (b.blob.length > MAX_BLOB) return json({ error: 'too_big' }, 413);
    await db.put(b.id, b.blob, now);
    await db.purge(now - KEEP_MS);
    return json({ ok: true });
  }
  return json({ error: 'not_found' }, 404);
}
