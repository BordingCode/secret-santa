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
  purge: (before) => DB.batch([
    DB.prepare('DELETE FROM wishlists WHERE updated < ?').bind(before),
    DB.prepare('DELETE FROM reservations WHERE updated < ?').bind(before),
  ]),
  resList: async (id) => (await DB.prepare('SELECT wish, holder FROM reservations WHERE list = ?').bind(id).all()).results,
  // The primary key (list, wish) makes this first-come-first-served even when two press at once.
  resTake: async (id, wish, holder, now) => {
    await DB.prepare('INSERT INTO reservations (list, wish, holder, updated) VALUES (?, ?, ?, ?) ON CONFLICT(list, wish) DO NOTHING')
      .bind(id, wish, holder, now).run();
    const r = await DB.prepare('SELECT holder FROM reservations WHERE list = ? AND wish = ?').bind(id, wish).first();
    return !!r && r.holder === holder;
  },
  resDrop: (id, wish, holder) =>
    DB.prepare('DELETE FROM reservations WHERE list = ? AND wish = ? AND holder = ?').bind(id, wish, holder).run(),
});

export default {
  fetch: (req, env) => handle(req, d1(env.DB)),
};
