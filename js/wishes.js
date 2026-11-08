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
      .map(i => ({ text: typeof i.text === 'string' ? i.text.trim().slice(0, MAX_TEXT) : '', url: cleanUrl(i.url) || '' }))
      .filter(i => i.text || i.url)            // a wish can be just a link, e.g. to a list elsewhere
      .slice(0, MAX_ITEMS);
  }

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

  root.Wishes = { load, save, cleanUrl, cleanItems, splitWish, siteName, idFor, seal, open, MAX_ITEMS, MAX_TEXT, MAX_URL };
})(globalThis);
