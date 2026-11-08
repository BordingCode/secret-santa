/* Secret Santa wishlists Worker. All the logic lives in api.js; this file only
   connects it to the D1 database. */
import { handle } from './api.js';

const d1 = (DB) => ({
  get: async (id) => {
    const r = await DB.prepare('SELECT blob FROM wishlists WHERE id = ?').bind(id).first();
    return r ? r.blob : null;
  },
  put: (id, blob, now) => DB.prepare(
    'INSERT INTO wishlists (id, blob, updated) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET blob = excluded.blob, updated = excluded.updated'
  ).bind(id, blob, now).run(),
  purge: (before) => DB.prepare('DELETE FROM wishlists WHERE updated < ?').bind(before).run(),
});

export default {
  fetch: (req, env) => handle(req, d1(env.DB)),
};
