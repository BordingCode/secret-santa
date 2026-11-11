// ── Wishlists: encryption and storage ──
// Each person's list is encrypted on the phone before it's uploaded. The id it's
// stored under and the key that locks it are both made from the group link and
// the person's name, so anyone holding the link can read it and the server can't.
(function (root) {
  'use strict';

  const SERVER = 'https://secret-santa-wishes.mathiasjob.workers.dev';
  const MAX_ITEMS = 20, MAX_TEXT = 200, MAX_URL = 500;
  const utf8 = new TextEncoder();

  // ?wishes=http://localhost:8789 points the app at the local test server. Only
  // localhost is accepted, so a crafted link can't redirect anyone's wishes.
  function server() {
    try {
      const u = new URLSearchParams(root.location.search).get('wishes');
      if (u && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(u)) return u;
    } catch {}
    return SERVER;
  }

  const digest = (label, link, name) =>
    crypto.subtle.digest('SHA-256', utf8.encode(`${label}\0${link}\0${name}`));
  const toB64 = (bytes) => btoa(String.fromCharCode(...bytes));
  const fromB64 = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0));

  async function idFor(link, name) {
    const bytes = new Uint8Array(await digest('santa-wish-id', link, name));
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  }
  async function keyFor(link, name) {
    return crypto.subtle.importKey('raw', await digest('santa-wish-key', link, name), 'AES-GCM', false, ['encrypt', 'decrypt']);
  }

  async function seal(value, link, name) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await keyFor(link, name), utf8.encode(JSON.stringify(value)));
    return `${toB64(iv)}.${toB64(new Uint8Array(data))}`;
  }
  async function open(blob, link, name) {
    const [iv, data] = blob.split('.').map(fromB64);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, await keyFor(link, name), data);
    return JSON.parse(new TextDecoder().decode(plain));
  }

  const findLink = (s) => (s.match(/https?:\/\/\S+/i) || [''])[0];

  /** A safe web address, or '' if empty, or null if it isn't one. */
  function cleanUrl(raw) {
    const input = String(raw || '').trim();
    const s = findLink(input) || input;    // apps often share "See my list: https://…"
    if (!s) return '';
    if (s.length > MAX_URL) return null;
    let u;
    try { u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`); } catch { return null; }
    if ((u.protocol !== 'https:' && u.protocol !== 'http:') || !u.hostname.includes('.')) return null;
    return u.href;
  }

  // Anyone with the link can upload, so what comes back is checked like any outside input.
  function cleanItems(value) {
    if (!Array.isArray(value)) return [];
    return value
      .filter(i => i && typeof i === 'object')
      .map(i => {
        const w = { text: typeof i.text === 'string' ? i.text.trim().slice(0, MAX_TEXT) : '', url: cleanUrl(i.url) || '' };
        if (typeof i.id === 'string' && WISH_ID.test(i.id)) w.id = i.id;
        return w;
      })
      .filter(i => i.text || i.url)            // a wish can be just a link, e.g. to a list elsewhere
      .slice(0, MAX_ITEMS);
  }

  // Every wish has an id, so a reservation stays on the right wish when the list is
  // edited or reordered. Wishes from before ids existed get one made from their content.
  const WISH_ID = /^[a-z0-9]{1,16}$/;
  function wishId(item) {
    if (item.id && WISH_ID.test(item.id)) return item.id;
    let h = 0x811c9dc5;
    for (const c of `${item.text}\0${item.url}`) { h ^= c.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
    return 'h' + h.toString(36);
  }
  const newWishId = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), b => (b % 36).toString(36)).join('');

  /** What was typed, with a link pasted into the wish field moved to the link field. */
  function splitWish(text, url) {
    const t = String(text || '').trim();
    const found = String(url || '').trim() ? '' : findLink(t);
    return found ? { text: t.replace(found, '').trim(), url: found } : { text: t, url: String(url || '').trim() };
  }

  /** "onskeskyen.dk" from a full address. */
  const siteName = (url) => new URL(url).hostname.replace(/^www\./, '');

  async function call(path, body) {
    const res = await fetch(server() + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`wishes ${path}: ${res.status}`);
    return res.json();
  }

  /** The person's wishes; [] if they haven't written any. Throws if it can't be fetched. */
  async function load(link, name) {
    const { blob } = await call('/get', { id: await idFor(link, name) });
    return blob ? cleanItems(await open(blob, link, name)) : [];
  }

  async function save(link, name, items) {
    await call('/put', { id: await idFor(link, name), blob: await seal(cleanItems(items), link, name) });
  }

  // ── Reservations ("Jeg køber den") ──
  // Stored per list and wish id. `me` is a secret made on this phone; the server only
  // gets a fingerprint of it mixed with the list id, so it can't tie one phone's
  // reservations together across lists, and it never hands it out again.
  async function holder(listId, secret) {
    const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', utf8.encode(`santa-holder\0${secret}\0${listId}`)));
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  }
  async function resArgs(link, name, secret) {
    const id = await idFor(link, name);
    return { id, me: await holder(id, secret) };
  }

  /** [{ w: wishId, mine: bool }] for the list. Throws if it can't be fetched. */
  async function reservations(link, name, secret) {
    return (await call('/res', await resArgs(link, name, secret))).res;
  }

  /** true if reserved by this phone now, false if someone else got there first. */
  async function reserve(link, name, wish, secret) {
    try {
      await call('/res/take', { ...(await resArgs(link, name, secret)), w: wish });
      return true;
    } catch (err) {
      if (/: 409$/.test(err.message)) return false;
      throw err;
    }
  }

  async function unreserve(link, name, wish, secret) {
    await call('/res/drop', { ...(await resArgs(link, name, secret)), w: wish });
  }

  // The group's children (not in the draw, but with a wishlist) are kept as their own
  // encrypted list. A typed name can't contain \0, so this can't clash with a person.
  const KIDS = '\0children', MAX_KIDS = 30, MAX_NAME = 40;

  function cleanKids(value) {
    if (!Array.isArray(value)) return [];
    const seen = new Set();
    return value
      .filter(n => typeof n === 'string')
      .map(n => n.trim().slice(0, MAX_NAME))
      .filter(n => n && !n.includes('\0') && !seen.has(n.toLowerCase()) && seen.add(n.toLowerCase()))
      .slice(0, MAX_KIDS);
  }

  /** The children's names, or null if the list was never saved. Throws if it can't be fetched. */
  async function loadKids(link) {
    const { blob } = await call('/get', { id: await idFor(link, KIDS) });
    return blob ? cleanKids(await open(blob, link, KIDS)) : null;
  }

  async function saveKids(link, names) {
    await call('/put', { id: await idFor(link, KIDS), blob: await seal(cleanKids(names), link, KIDS) });
  }

  root.Wishes = { load, save, wishId, newWishId, reservations, reserve, unreserve, loadKids, saveKids, cleanKids, MAX_KIDS, MAX_NAME, cleanUrl, cleanItems, splitWish, siteName, idFor, seal, open, MAX_ITEMS, MAX_TEXT, MAX_URL };
})(globalThis);
