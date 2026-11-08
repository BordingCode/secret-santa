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
