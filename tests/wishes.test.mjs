// Tests for the wishlist encryption, clean-up and server. Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../js/wishes.js';
import { handle, MAX_BLOB, KEEP_MS } from '../worker/api.js';
import { memoryDb } from '../worker/dev-server.mjs';

const { Wishes } = globalThis;
const LINK = 'abc123encodedgroup';
const post = (db, path, body, now) => handle(new Request('http://x' + path, { method: 'POST', body: JSON.stringify(body) }), db, now);
const ID = 'a'.repeat(64);

function useServer() {
  const db = memoryDb();
  globalThis.fetch = (url, opts) => handle(new Request(url, opts), db);
  return db;
}

test('wishes round-trip through the server, and the server only holds scrambled text', async () => {
  const db = useServer();
  const items = [{ text: 'Blå uldsokker æøå', url: 'https://example.com/sokker' }];
  await Wishes.save(LINK, 'Anna', items);
  assert.deepEqual(await Wishes.load(LINK, 'Anna'), items);
  const [[id, row]] = [...db.rows];
  assert.match(id, /^[0-9a-f]{64}$/);
  for (const secret of ['Blå', 'sokker', 'Anna', LINK]) assert.ok(!row.blob.includes(secret) && !id.includes(secret));
});

test('nobody written yet gives an empty list; people and groups are kept apart', async () => {
  useServer();
  await Wishes.save(LINK, 'Anna', [{ text: 'Bog', url: '' }]);
  assert.deepEqual(await Wishes.load(LINK, 'Bo'), []);
  assert.deepEqual(await Wishes.load('another-group', 'Anna'), []);
  assert.notEqual(await Wishes.idFor(LINK, 'Anna'), await Wishes.idFor('another-group', 'Anna'));
});

test('a saved list can be changed and emptied', async () => {
  useServer();
  await Wishes.save(LINK, 'Anna', [{ text: 'Bog', url: '' }]);
  await Wishes.save(LINK, 'Anna', [{ text: 'Spil', url: '' }]);
  assert.deepEqual(await Wishes.load(LINK, 'Anna'), [{ text: 'Spil', url: '' }]);
  await Wishes.save(LINK, 'Anna', []);
  assert.deepEqual(await Wishes.load(LINK, 'Anna'), []);
});

test('the wrong link cannot unlock a wishlist', async () => {
  const blob = await Wishes.seal([{ text: 'Hemmelig' }], LINK, 'Anna');
  await assert.rejects(Wishes.open(blob, 'wrong-link', 'Anna'));
});

test('a server failure is reported, not turned into an empty list', async () => {
  globalThis.fetch = async () => new Response('{}', { status: 500 });
  await assert.rejects(Wishes.load(LINK, 'Anna'));
  await assert.rejects(Wishes.save(LINK, 'Anna', []));
});

test('web addresses: normal ones work, dangerous ones are refused', () => {
  assert.equal(Wishes.cleanUrl(''), '');
  assert.equal(Wishes.cleanUrl(' www.example.com/a '), 'https://www.example.com/a');
  assert.equal(Wishes.cleanUrl('http://example.dk'), 'http://example.dk/');
  assert.equal(Wishes.cleanUrl('javascript:alert(1)'), null);
  assert.equal(Wishes.cleanUrl('data:text/html,x'), null);
  assert.equal(Wishes.cleanUrl('bare ord'), null);
  assert.equal(Wishes.cleanUrl('https://x.dk/' + 'a'.repeat(600)), null);
});

test('junk uploaded by someone else is cleaned before it is shown', () => {
  assert.deepEqual(Wishes.cleanItems('nonsense'), []);
  assert.deepEqual(Wishes.cleanItems([null, { text: 5 }, { text: '  ' }, { text: ' ok ', url: 'javascript:x' }]), [{ text: 'ok', url: '' }]);
  assert.equal(Wishes.cleanItems(Array(50).fill({ text: 'a' })).length, Wishes.MAX_ITEMS);
  assert.equal(Wishes.cleanItems([{ text: 'x'.repeat(999) }])[0].text.length, Wishes.MAX_TEXT);
});

test('a full list of long wishes fits within the server limit', async () => {
  const items = Array(Wishes.MAX_ITEMS).fill({ text: 'æ'.repeat(Wishes.MAX_TEXT), url: 'https://x.dk/' + 'a'.repeat(Wishes.MAX_URL - 20) });
  assert.ok((await Wishes.seal(items, LINK, 'Anna')).length < MAX_BLOB);
});

test('server: refuses bad requests and oversized lists', async () => {
  const db = memoryDb();
  assert.equal((await post(db, '/get', { id: 'nope' })).status, 400);
  assert.equal((await post(db, '/put', { id: ID })).status, 400);
  assert.equal((await post(db, '/put', { id: ID, blob: 'x'.repeat(MAX_BLOB + 1) })).status, 413);
  assert.equal((await post(db, '/other', { id: ID })).status, 404);
  assert.equal(db.rows.size, 0);
});

test('server: lists untouched for over a year are removed', async () => {
  const db = memoryDb(), t0 = 1_000_000_000_000;
  await post(db, '/put', { id: ID, blob: 'old' }, t0);
  await post(db, '/put', { id: 'b'.repeat(64), blob: 'new' }, t0 + KEEP_MS + 1);
  assert.equal(await db.get(ID), null);
  assert.equal(await db.get('b'.repeat(64)), 'new');
});

test('a wish can be just a link, but not nothing or a dangerous link', () => {
  const list = 'https://onskeskyen.dk/liste/abc';
  assert.deepEqual(Wishes.cleanItems([{ text: '', url: list }]), [{ text: '', url: list }]);
  assert.deepEqual(Wishes.cleanItems([{ url: list }]), [{ text: '', url: list }]);
  assert.deepEqual(Wishes.cleanItems([{ text: '', url: '' }, { url: 'javascript:alert(1)' }]), []);
  assert.equal(Wishes.siteName('https://www.onskeskyen.dk/liste/abc'), 'onskeskyen.dk');
});

test('a link wish survives saving and loading', async () => {
  useServer();
  const items = [{ text: '', url: 'https://onskeskyen.dk/liste/abc' }];
  await Wishes.save(LINK, 'Anna', items);
  assert.deepEqual(await Wishes.load(LINK, 'Anna'), items);
});

test('the link is picked out of what a share button copies', () => {
  assert.equal(Wishes.cleanUrl('Se min ønskeliste: https://onskeskyen.dk/liste/abc'), 'https://onskeskyen.dk/liste/abc');
  assert.equal(Wishes.cleanUrl('javascript:alert(1) https://ok.dk/a'), 'https://ok.dk/a');
});

test('a link pasted into the wish field is treated as the link', () => {
  const url = 'https://onskeskyen.dk/liste/abc';
  assert.deepEqual(Wishes.splitWish(url, ''), { text: '', url });
  assert.deepEqual(Wishes.splitWish(`Min liste ${url}`, ''), { text: 'Min liste', url });
  assert.deepEqual(Wishes.splitWish('Blå sokker', ''), { text: 'Blå sokker', url: '' });
  assert.deepEqual(Wishes.splitWish(url, 'https://andet.dk'), { text: url, url: 'https://andet.dk' }, 'a typed link is left alone');
});


test('children list round-trips, stays scrambled, and never clashes with a person', async () => {
  const db = useServer();
  assert.equal(await Wishes.loadKids(LINK), null);
  await Wishes.saveKids(LINK, ['Ida', 'Malte']);
  await Wishes.save(LINK, 'Ida', [{ text: 'Lego', url: '' }]);
  assert.deepEqual(await Wishes.loadKids(LINK), ['Ida', 'Malte']);
  assert.deepEqual(await Wishes.load(LINK, 'Ida'), [{ text: 'Lego', url: '' }]);
  assert.equal(await Wishes.loadKids('another-group'), null);
  await Wishes.saveKids(LINK, []);
  assert.deepEqual(await Wishes.loadKids(LINK), []);   // emptied on purpose is not the same as never saved
  for (const [, row] of db.rows) for (const secret of ['Ida', 'Malte', 'Lego']) assert.ok(!row.blob.includes(secret));
});

test('children names are cleaned: trimmed, no blanks or duplicates, capped', () => {
  assert.deepEqual(Wishes.cleanKids(['  Ida ', '', 'ida', 7, null, 'Bo']), ['Ida', 'Bo']);
  assert.deepEqual(Wishes.cleanKids('nope'), []);
  assert.equal(Wishes.cleanKids(Array.from({ length: 50 }, (_, i) => 'b' + i)).length, Wishes.MAX_KIDS);
  assert.equal(Wishes.cleanKids(['x'.repeat(100)])[0].length, Wishes.MAX_NAME);
});

test('reservations: first come first served, only the reserver sees it as theirs or can undo it', async () => {
  const db = useServer();
  const BO = 'bo-phone-secret', CARL = 'carl-phone-secret';
  assert.deepEqual(await Wishes.reservations(LINK, 'Anna', BO), []);
  assert.equal(await Wishes.reserve(LINK, 'Anna', 'w1', BO), true);
  assert.equal(await Wishes.reserve(LINK, 'Anna', 'w1', BO), true, 'asking again is fine');
  assert.equal(await Wishes.reserve(LINK, 'Anna', 'w1', CARL), false, 'someone else got there first');
  assert.deepEqual(await Wishes.reservations(LINK, 'Anna', BO), [{ w: 'w1', mine: true }]);
  assert.deepEqual(await Wishes.reservations(LINK, 'Anna', CARL), [{ w: 'w1', mine: false }]);
  await Wishes.unreserve(LINK, 'Anna', 'w1', CARL);   // not Carl's to undo
  assert.equal((await Wishes.reservations(LINK, 'Anna', BO)).length, 1);
  await Wishes.unreserve(LINK, 'Anna', 'w1', BO);
  assert.deepEqual(await Wishes.reservations(LINK, 'Anna', CARL), []);
  // Other people's lists and other groups are kept apart.
  await Wishes.reserve(LINK, 'Anna', 'w1', BO);
  assert.deepEqual(await Wishes.reservations(LINK, 'Bo', BO), []);
  assert.deepEqual(await Wishes.reservations('othergroup', 'Anna', BO), []);
  // The server never holds the phone's secret, a name or the link.
  for (const r of db.res.values()) for (const secret of [BO, 'Anna', LINK]) assert.ok(!JSON.stringify(r).includes(secret));
});

test('server: reservations refuse bad input and are removed after a year', async () => {
  const db = memoryDb(), t0 = 1_000_000_000_000, ME = 'c'.repeat(64);
  assert.equal((await post(db, '/res', { id: ID })).status, 400);
  assert.equal((await post(db, '/res/take', { id: ID, me: ME, w: 'BAD ID!' })).status, 400);
  assert.equal((await post(db, '/res/take', { id: ID, me: ME, w: 'w1' }, t0)).status, 200);
  await post(db, '/put', { id: 'b'.repeat(64), blob: 'x' }, t0 + KEEP_MS + 1);
  assert.equal(db.res.size, 0);
});

test('wish ids: kept when valid, made from the content for old wishes, new ones are random', () => {
  const [kept, junk] = Wishes.cleanItems([{ text: 'a', id: 'abc123' }, { text: 'b', id: '<script>' }]);
  assert.equal(kept.id, 'abc123');
  assert.equal(junk.id, undefined);
  assert.equal(Wishes.wishId(junk), Wishes.wishId({ text: 'b', url: '' }));
  assert.notEqual(Wishes.wishId(junk), Wishes.wishId({ text: 'c', url: '' }));
  assert.match(Wishes.newWishId(), /^[a-z0-9]{8}$/);
  assert.notEqual(Wishes.newWishId(), Wishes.newWishId());
});
