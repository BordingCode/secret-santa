(function () {
  'use strict';

  const LS_PREFIX = 'ss_';
  const LS = {
    get(key) { try { return JSON.parse(localStorage.getItem(LS_PREFIX + key)); } catch { return null; } },
    set(key, val) { localStorage.setItem(LS_PREFIX + key, JSON.stringify(val)); },
    del(key) { localStorage.removeItem(LS_PREFIX + key); }
  };

  let participants = LS.get('participants') || [];
  let exclusions = LS.get('exclusions') || [];
  let kids = LS.get('kids') || [];   // children: not in the draw, but given a wishlist
  let groupLink = null;   // the encoded draw from the link; wishlists are filed under it

  // ── Screen Navigation ──
  function goScreen(name) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const el = document.getElementById('screen-' + name);
    if (el) el.classList.add('active');
  }
  window.goScreen = goScreen;

  // ── Hash Routing ──
  function handleRoute() {
    const hash = location.hash;
    if (hash.startsWith('#/g/')) {
      const encoded = hash.slice(4);
      try {
        const data = decode(encoded);
        groupLink = encoded;
        showParticipants(data);
      } catch {
        goScreen('home');
      }
    } else {
      goScreen('home');
    }
  }

  // An unshared draw is only worth resurfacing for a little while — after
  // that it's more likely stale clutter than something Mathias is about to share.
  const RESUME_DRAW_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

  function showResumeBanner() {
    const banner = document.getElementById('resume-draw-banner');
    const last = LS.get('lastDraw');
    if (!last || (Date.now() - last.ts) > RESUME_DRAW_MAX_AGE_MS) {
      banner.style.display = 'none';
      return;
    }
    const when = new Date(last.ts).toLocaleString('da-DK', { dateStyle: 'short', timeStyle: 'short' });
    document.getElementById('resume-draw-text').textContent =
      `Du har en trækning fra ${when} du ikke har delt endnu.`;
    banner.style.display = '';
    document.getElementById('btn-resume-draw').onclick = () => {
      showShareScreen(last.url, last.groupName);
    };
  }

  // ── Home Screen ──
  function initHome() {
    showResumeBanner();
    document.getElementById('btn-create').addEventListener('click', () => {
      initCreateScreen();
      goScreen('create');
    });
    document.getElementById('btn-join').addEventListener('click', () => {
      initJoinScreen();
      goScreen('join');
    });
  }

  // ── Join Screen ──
  function initJoinScreen() {
    const input = document.getElementById('join-link');
    const btn = document.getElementById('btn-join-continue');
    const error = document.getElementById('join-error');

    input.value = '';
    hideError(error);
    setTimeout(() => input.focus(), 50);

    function tryJoin() {
      const link = input.value.trim();
      if (!link) return;
      let hash = null;
      try {
        hash = new URL(link).hash;
      } catch {
        hash = link;
      }
      if (hash && hash.startsWith('#/g/')) {
        hideError(error);
        location.hash = hash;
      } else {
        showError(error, 'Ugyldigt link. Sørg for at kopiere hele linket.');
      }
    }

    btn.onclick = tryJoin;
    input.onkeydown = (e) => {
      if (e.key === 'Enter') tryJoin();
    };
  }

  // ── Create Screen ──
  function initCreateScreen() {
    const groupInput = document.getElementById('group-name');
    const list = document.getElementById('participant-list');
    const btnAdd = document.getElementById('btn-add-participant');
    const btnNext = document.getElementById('btn-next-exclusions');
    const error = document.getElementById('create-error');

    const saved = LS.get('participants');
    const savedGroup = LS.get('groupName');
    if (savedGroup) groupInput.value = savedGroup;

    if (saved && saved.length > 0) {
      participants = saved;
    } else if (participants.length === 0) {
      participants = ['', '', ''];
    }

    const kidList = document.getElementById('kid-input-list');
    kids = LS.get('kids') || [];
    renderParticipantInputs();
    renderKidInputs();

    document.getElementById('btn-add-kid-create').onclick = () => {
      readKidInputs();
      kids.push('');
      renderKidInputs();
      kidList.querySelector('.participant-row:last-child input').focus();
    };

    groupInput.oninput = () => {
      LS.set('groupName', groupInput.value);
    };

    btnAdd.onclick = () => {
      participants.push('');
      renderParticipantInputs();
    };

    btnNext.onclick = () => {
      readParticipantInputs();
      const names = participants.filter(n => n.trim());
      if (names.length < 3) {
        showError(error, 'Tilføj mindst 3 deltagere.');
        return;
      }
      const unique = new Set(names.map(n => n.trim().toLowerCase()));
      if (unique.size !== names.length) {
        showError(error, 'Alle navne skal være forskellige.');
        return;
      }
      readKidInputs();
      const kidNames = kids.map(n => n.trim()).filter(Boolean);
      const lowerPeople = new Set(names.map(n => n.trim().toLowerCase()));
      const clash = kidNames.find(n => lowerPeople.has(n.toLowerCase()));
      if (clash) {
        showError(error, `${clash} står både som deltager og som barn. Brug kun ét af stederne.`);
        return;
      }
      if (new Set(kidNames.map(n => n.toLowerCase())).size !== kidNames.length) {
        showError(error, 'Børnenes navne skal være forskellige.');
        return;
      }
      if (kidNames.length > Wishes.MAX_KIDS) {
        showError(error, `Der kan højst være ${Wishes.MAX_KIDS} børn.`);
        return;
      }
      hideError(error);
      kids = kidNames;
      LS.set('kids', kids);
      participants = names.map(n => n.trim());
      LS.set('participants', participants);
      exclusions = exclusions.filter(([a, b]) => participants.includes(a) && participants.includes(b));
      LS.set('exclusions', exclusions);
      initExclusionsSection();
      goScreen('exclusions');
    };

    function renderParticipantInputs() {
      list.innerHTML = '';
      participants.forEach((name, i) => {
        const row = document.createElement('div');
        row.className = 'participant-row';
        row.innerHTML = `
          <input type="text" class="input participant-input" placeholder="Navn ${i + 1}" value="${escHtml(name)}">
          <button class="btn-remove" data-i="${i}">&times;</button>
        `;
        list.appendChild(row);
      });

      list.querySelectorAll('.btn-remove').forEach(btn => {
        btn.addEventListener('click', () => {
          const i = parseInt(btn.dataset.i);
          if (participants.length <= 3) return;
          participants.splice(i, 1);
          renderParticipantInputs();
          saveParticipants();
        });
      });

      list.querySelectorAll('.participant-input').forEach(input => {
        input.addEventListener('input', saveParticipants);
      });
    }

    function renderKidInputs() {
      kidList.innerHTML = '';
      kids.forEach((name, i) => {
        const row = document.createElement('div');
        row.className = 'participant-row';
        row.innerHTML = `
          <input type="text" class="input participant-input" maxlength="${Wishes.MAX_NAME}" placeholder="Barnets navn" value="${escHtml(name)}">
          <button class="btn-remove" aria-label="Fjern barn">&times;</button>
        `;
        row.querySelector('input').addEventListener('input', () => { readKidInputs(); LS.set('kids', kids); });
        row.querySelector('button').addEventListener('click', () => {
          readKidInputs();
          kids.splice(i, 1);
          LS.set('kids', kids);
          renderKidInputs();
        });
        kidList.appendChild(row);
      });
    }

    function readKidInputs() {
      kids = Array.from(kidList.querySelectorAll('input'), el => el.value);
    }

    function readParticipantInputs() {
      const inputs = list.querySelectorAll('.participant-input');
      participants = Array.from(inputs).map(el => el.value);
    }

    function saveParticipants() {
      readParticipantInputs();
      LS.set('participants', participants);
    }
  }

  // ── Exclusions Screen ──
  function initExclusionsSection() {
    const chips = document.getElementById('exclusion-chips');
    const selA = document.getElementById('excl-a');
    const selB = document.getElementById('excl-b');
    const btnAdd = document.getElementById('btn-add-exclusion');
    const btnDraw = document.getElementById('btn-draw');
    const error = document.getElementById('exclusions-error');

    document.getElementById('btn-back-create').onclick = () => {
      initCreateScreen();
      goScreen('create');
    };

    renderExclusions();
    populateSelects();

    btnAdd.onclick = () => {
      const a = selA.value;
      const b = selB.value;
      if (!a || !b || a === b) return;
      const exists = exclusions.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
      if (exists) return;
      exclusions.push([a, b]);
      LS.set('exclusions', exclusions);
      renderExclusions();
    };

    btnDraw.onclick = () => {
      hideError(error);
      const result = performDraw(participants, exclusions);
      if (!result || result.impossible) {
        const msg = result && result.impossible
          ? `${result.impossible} kan ikke give gave til nogen med de nuværende undtagelser — fjern en af ${result.impossible}s undtagelser.`
          : 'Lodtrækningen er umulig med disse undtagelser. Prøv at fjerne nogle.';
        showError(error, msg);
        return;
      }
      const groupName = LS.get('groupName') || 'Secret Santa';
      const data = { name: groupName, a: result.map(r => [r.giver, r.recipient]) };
      const kidNames = Wishes.cleanKids(kids);
      if (kidNames.length) data.k = kidNames;   // the starting list; changes on the link page are saved online
      const encoded = encode(data);
      const shareUrl = location.origin + location.pathname + '#/g/' + encoded;
      LS.set('lastDraw', { url: shareUrl, groupName, ts: Date.now() });
      showShareScreen(shareUrl, groupName);
    };

    function renderExclusions() {
      chips.innerHTML = '';
      exclusions.forEach(([a, b], i) => {
        const chip = document.createElement('span');
        chip.className = 'exclusion-chip';
        chip.innerHTML = `${escHtml(a)} &harr; ${escHtml(b)} <button data-i="${i}">&times;</button>`;
        chips.appendChild(chip);
      });
      chips.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', () => {
          exclusions.splice(parseInt(btn.dataset.i), 1);
          LS.set('exclusions', exclusions);
          renderExclusions();
        });
      });
    }

    function populateSelects() {
      const options = '<option value="">Vælg...</option>' +
        participants.map(name => `<option value="${escHtml(name)}">${escHtml(name)}</option>`).join('');
      [selA, selB].forEach(sel => {
        sel.innerHTML = options;
      });
    }
  }

  // ── Share Screen ──
  function showShareScreen(url, groupName) {
    goScreen('share');
    document.getElementById('share-group-name').textContent = groupName;
    document.getElementById('share-link-text').textContent = url;

    const btnCopy = document.getElementById('btn-copy-link');
    const btnShare = document.getElementById('btn-share-link');
    const feedback = document.getElementById('copy-feedback');

    if (!navigator.share) {
      btnShare.style.display = 'none';
    }

    btnCopy.onclick = async () => {
      try {
        await navigator.clipboard.writeText(url);
      } catch {
        fallbackCopy(url);
      }
      feedback.textContent = 'Kopieret!';
      feedback.style.opacity = '1';
      setTimeout(() => { feedback.style.opacity = '0'; }, 2000);
    };

    btnShare.onclick = async () => {
      try {
        await navigator.share({ title: groupName, text: 'Åbn linket for at se, hvem du har trukket, og skriv din egen ønskeliste!', url });
      } catch {}
    };

    document.getElementById('btn-new-draw').onclick = () => {
      if (confirm('Er du sikker? Den nuværende lodtrækning slettes.')) {
        LS.del('lastDraw');
        location.hash = '';
        goScreen('home');
        showResumeBanner();
      }
    };
  }

  // ── Participants Screen (join flow) ──
  function showParticipants(data) {
    goScreen('participants');
    document.getElementById('group-title').textContent = data.name;
    const grid = document.getElementById('name-grid');
    grid.innerHTML = '';

    data.a.forEach(([giver, recipient]) => {
      const btn = document.createElement('button');
      btn.className = 'name-btn';
      btn.textContent = giver;
      btn.addEventListener('click', () => {
        showConfirmModal(giver, recipient);
      });
      grid.appendChild(btn);
    });

    showKids(data);
  }

  // ── Children (front page): not in the draw, but everyone can see and fill their wishlist ──
  let kidsLoad = 0;

  function showKids(data) {
    const load = ++kidsLoad;
    const people = data.a.map(([giver]) => giver);
    const grid = document.getElementById('kids-grid');
    const status = document.getElementById('kids-status');
    const retry = document.getElementById('btn-retry-kids');
    const btnShow = document.getElementById('btn-show-add-kid');
    const form = document.getElementById('kid-form');
    const input = document.getElementById('kid-name');
    const btnAdd = document.getElementById('btn-add-kid');
    const error = document.getElementById('kids-error');
    let kids = [];
    // Until someone changes the list on this page, it's the children named when the draw was made.
    const current = async () => (await Wishes.loadKids(groupLink)) ?? Wishes.cleanKids(data.k || []);

    function draw() {
      grid.innerHTML = '';
      kids.forEach(name => {
        const btn = document.createElement('button');
        btn.className = 'name-btn';
        btn.textContent = name;
        btn.addEventListener('click', () => showMyWishes(name, { kid: true, people }));
        grid.appendChild(btn);
      });
      status.textContent = kids.length ? '' : 'Ingen børn tilføjet endnu.';
    }

    async function addKid() {
      const name = input.value.trim().slice(0, Wishes.MAX_NAME);
      if (!name) return;
      const lower = name.toLowerCase();
      if (people.some(p => p.toLowerCase() === lower)) {
        showError(error, `${name} er allerede med i lodtrækningen.`);
        return;
      }
      btnAdd.disabled = true;
      hideError(error);
      try {
        // Fetch the newest list first, so a child someone else just added isn't lost.
        const latest = await current();
        if (latest.some(k => k.toLowerCase() === lower)) {
          kids = latest;
        } else if (latest.length >= Wishes.MAX_KIDS) {
          showError(error, `Der kan højst være ${Wishes.MAX_KIDS} børn på listen.`);
          return;
        } else {
          kids = [...latest, name];
          await Wishes.saveKids(groupLink, kids);
        }
        draw();
        input.value = '';
        form.style.display = 'none';
        btnShow.style.display = '';
      } catch (err) {
        console.error(err);
        showError(error, 'Kunne ikke gemme. Tjek din internetforbindelse, og prøv igen.');
      } finally {
        btnAdd.disabled = false;
      }
    }

    btnShow.onclick = () => {
      btnShow.style.display = 'none';
      form.style.display = '';
      input.focus();
    };
    btnAdd.onclick = addKid;
    input.onkeydown = (e) => { if (e.key === 'Enter') addKid(); };

    // Adding stays hidden until the saved list is known, so it can't be overwritten.
    async function loadList() {
      grid.innerHTML = '';
      btnShow.style.display = 'none';
      form.style.display = 'none';
      retry.style.display = 'none';
      hideError(error);
      status.textContent = 'Henter børnenes ønskelister…';
      try {
        const list = await current();
        if (load !== kidsLoad) return;
        kids = list;
        draw();
        btnShow.style.display = '';
      } catch (err) {
        if (load !== kidsLoad) return;
        console.error(err);
        status.textContent = 'Kunne ikke hente børnenes ønskelister. Tjek din internetforbindelse.';
        retry.style.display = '';
      }
    }
    retry.onclick = loadList;
    loadList();
  }

  async function removeKid(name) {
    if (!confirm(`Fjern ${name} fra børnenes ønskelister?`)) return;
    try {
      const latest = (await Wishes.loadKids(groupLink)) ?? Wishes.cleanKids(decode(groupLink).k || []);
      await Wishes.saveKids(groupLink, latest.filter(k => k !== name));
      // Empty the list too, so nothing is left behind if the name is added again.
      await Wishes.save(groupLink, name, []);
    } catch (err) {
      console.error(err);
      showError(document.getElementById('my-wishes-error'), 'Kunne ikke fjerne. Tjek din internetforbindelse, og prøv igen.');
      return;
    }
    goScreen('participants');
    showKids(decode(groupLink));
  }

  // ── Confirm Modal ──
  function showConfirmModal(giver, recipient) {
    const overlay = document.getElementById('modal-overlay');
    document.getElementById('modal-name').textContent = giver;
    overlay.classList.add('active');

    document.getElementById('modal-yes').onclick = () => {
      overlay.classList.remove('active');
      showReveal(giver, recipient);
    };
    document.getElementById('modal-no').onclick = () => {
      overlay.classList.remove('active');
    };
  }

  // ── Reveal Screen ──
  function showReveal(giver, recipient) {
    goScreen('reveal');
    document.getElementById('reveal-giver').textContent = giver;

    const nameEl = document.getElementById('reveal-recipient');
    const labelEl = document.getElementById('reveal-label');
    const giftBox = document.getElementById('gift-box');
    const btnReveal = document.getElementById('btn-reveal');

    const forEl = document.getElementById('reveal-for');
    nameEl.classList.remove('show');
    labelEl.classList.remove('show');
    forEl.classList.remove('show');
    giftBox.classList.remove('opened', 'shaking');
    btnReveal.style.display = '';
    nameEl.textContent = recipient;
    document.getElementById('reveal-wishes').style.display = 'none';
    document.getElementById('btn-my-wishes').onclick = () => showMyWishes(giver);

    initSnowfall();

    btnReveal.onclick = () => {
      btnReveal.style.display = 'none';
      giftBox.classList.add('shaking');
      setTimeout(() => {
        giftBox.classList.remove('shaking');
        giftBox.classList.add('opened');
      }, 400);
      setTimeout(() => {
        forEl.classList.add('show');
      }, 700);
      setTimeout(() => {
        nameEl.classList.add('show');
      }, 900);
      setTimeout(() => {
        labelEl.classList.add('show');
      }, 1200);
      setTimeout(() => {
        document.getElementById('reveal-wishes').style.display = '';
      }, 1500);
      loadRecipientWishes(recipient);
    };
  }

  // ── Wishlists ──
  function renderWishes(listEl, items, onRemove) {
    listEl.innerHTML = '';
    items.forEach((item, i) => {
      const li = document.createElement('li');
      li.className = 'wish-item';
      const body = document.createElement('div');
      body.className = 'wish-body';
      if (item.text) {
        const text = document.createElement('span');
        text.className = 'wish-text';
        text.textContent = item.text;
        body.appendChild(text);
      }
      if (item.url) {
        const a = document.createElement('a');
        a.className = 'wish-link';
        a.href = item.url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = item.text ? 'Åbn link' : `Åbn link på ${Wishes.siteName(item.url)}`;
        body.appendChild(a);
      }
      li.appendChild(body);
      if (onRemove) {
        const del = document.createElement('button');
        del.className = 'btn-remove';
        del.setAttribute('aria-label', `Fjern ${item.text || Wishes.siteName(item.url)}`);
        del.innerHTML = '&times;';
        del.addEventListener('click', () => onRemove(i));
        li.appendChild(del);
      }
      listEl.appendChild(li);
    });
  }

  let recipientLoad = 0;   // only the newest request may draw, if someone switches name mid-load

  async function loadRecipientWishes(recipient) {
    const load = ++recipientLoad;
    const title = document.getElementById('reveal-wishes-title');
    const list = document.getElementById('reveal-wishes-list');
    const status = document.getElementById('reveal-wishes-status');
    const retry = document.getElementById('btn-retry-wishes');
    title.textContent = `${recipient} ønsker sig`;
    list.innerHTML = '';
    status.textContent = 'Henter ønsker…';
    retry.style.display = 'none';
    retry.onclick = () => loadRecipientWishes(recipient);
    try {
      const items = await Wishes.load(groupLink, recipient);
      if (load !== recipientLoad) return;
      renderWishes(list, items);
      status.textContent = items.length ? '' : `${recipient} har ikke skrevet nogen ønsker endnu. Kig forbi igen senere.`;
    } catch (err) {
      if (load !== recipientLoad) return;
      console.error(err);
      status.textContent = 'Kunne ikke hente ønskelisten. Tjek din internetforbindelse.';
      retry.style.display = '';
    }
  }

  function showMyWishes(name, opts = {}) {
    const kid = !!opts.kid;
    goScreen('wishlist');
    document.getElementById('btn-back-wishlist').onclick = () => goScreen(kid ? 'participants' : 'reveal');
    document.getElementById('wishlist-title').textContent = kid ? `${name}s ønskeliste` : 'Min ønskeliste';
    document.getElementById('wishlist-intro').textContent = kid
      ? `${name} er ikke med i lodtrækningen. Alle med linket kan se listen og skrive på den.`
      : 'Din Secret Santa kan se det, du skriver her. Du kan ændre det når som helst.';
    document.getElementById('wish-text-label').textContent = kid ? `Hvad ønsker ${name} sig?` : 'Hvad ønsker du dig?';
    document.getElementById('wish-hint').textContent = kid
      ? 'Har barnet allerede en ønskeliste, fx på Ønskeskyen? Så indsæt bare linket, og lad det første felt stå tomt.'
      : 'Har du allerede en ønskeliste, fx på Ønskeskyen? Så indsæt bare linket, og lad det første felt stå tomt.';
    const btnRemoveKid = document.getElementById('btn-remove-kid');
    btnRemoveKid.style.display = kid ? '' : 'none';
    btnRemoveKid.textContent = `Fjern ${name} fra listen`;
    btnRemoveKid.onclick = () => removeKid(name);
    const list = document.getElementById('my-wishes-list');
    const status = document.getElementById('my-wishes-status');
    const error = document.getElementById('my-wishes-error');
    const retry = document.getElementById('btn-retry-my-wishes');
    const form = document.getElementById('wish-form');
    const textInput = document.getElementById('wish-text');
    const urlInput = document.getElementById('wish-url');
    const btnAdd = document.getElementById('btn-add-wish');
    let items = [];
    let saving = false;

    function draw() {
      renderWishes(list, items, removeWish);
    }

    // The list on screen only changes once the server has really stored the new one.
    async function store(next) {
      if (saving) return false;
      saving = true;
      btnAdd.disabled = true;
      hideError(error);
      status.textContent = 'Gemmer…';
      try {
        await Wishes.save(groupLink, name, next);
        items = next;
        draw();
        status.textContent = 'Gemt ✓';
        return true;
      } catch (err) {
        console.error(err);
        status.textContent = '';
        showError(error, 'Kunne ikke gemme. Tjek din internetforbindelse, og prøv igen.');
        return false;
      } finally {
        saving = false;
        btnAdd.disabled = false;
      }
    }

    function removeWish(i) {
      store(items.filter((_, k) => k !== i));
    }

    async function addWish() {
      const typed = Wishes.splitWish(textInput.value, urlInput.value);
      if (!typed.text && !typed.url) {
        showError(error, 'Skriv et ønske, eller indsæt et link.');
        return;
      }
      if (items.length >= Wishes.MAX_ITEMS) {
        showError(error, `Der kan højst være ${Wishes.MAX_ITEMS} ønsker på listen.`);
        return;
      }
      const url = Wishes.cleanUrl(typed.url);
      if (url === null) {
        showError(error, 'Linket ser ikke rigtigt ud. Ret det, eller lad feltet stå tomt.');
        return;
      }
      if (await store([...items, { text: typed.text, url }])) {
        textInput.value = '';
        urlInput.value = '';
        textInput.focus();
      }
    }

    btnAdd.onclick = addWish;
    textInput.onkeydown = urlInput.onkeydown = (e) => { if (e.key === 'Enter') addWish(); };

    // Without the saved list on screen the form stays hidden: saving from a
    // blank start would wipe wishes that are already there.
    async function loadMine() {
      list.innerHTML = '';
      form.style.display = 'none';
      retry.style.display = 'none';
      hideError(error);
      status.textContent = 'Henter din ønskeliste…';
      try {
        items = await Wishes.load(groupLink, name);
        draw();
        status.textContent = '';
        form.style.display = '';
      } catch (err) {
        console.error(err);
        status.textContent = '';
        showError(error, 'Kunne ikke hente din ønskeliste. Tjek din internetforbindelse.');
        retry.style.display = '';
      }
    }
    retry.onclick = loadMine;
    loadMine();
  }

  // ── Snowfall ──
  function initSnowfall() {
    const canvas = document.getElementById('snow-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let flakes = [];
    let animId;

    function resize() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    for (let i = 0; i < 60; i++) {
      flakes.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        r: Math.random() * 3 + 1,
        speed: Math.random() * 1 + 0.5,
        wobble: Math.random() * Math.PI * 2,
        wobbleSpeed: Math.random() * 0.02 + 0.01
      });
    }

    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
      flakes.forEach(f => {
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
        ctx.fill();
        f.y += f.speed;
        f.wobble += f.wobbleSpeed;
        f.x += Math.sin(f.wobble) * 0.5;
        if (f.y > canvas.height + 5) {
          f.y = -5;
          f.x = Math.random() * canvas.width;
        }
      });
      animId = requestAnimationFrame(draw);
    }
    draw();

    window._stopSnow = () => {
      cancelAnimationFrame(animId);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    };
  }

  // ── Encode / Decode ──
  function xorString(str, key) {
    let out = '';
    for (let i = 0; i < str.length; i++) {
      out += String.fromCharCode(str.charCodeAt(i) ^ key.charCodeAt(i % key.length));
    }
    return out;
  }

  function encode(data) {
    const json = JSON.stringify(data);
    const obfuscated = xorString(json, 'santa');
    return btoa(unescape(encodeURIComponent(obfuscated)));
  }

  function decode(encoded) {
    const obfuscated = decodeURIComponent(escape(atob(encoded)));
    const json = xorString(obfuscated, 'santa');
    return JSON.parse(json);
  }

  window.encode = encode;
  window.decode = decode;

  // ── Draw Algorithm ──
  function performDraw(people, excl) {
    const n = people.length;
    const excluded = new Map();
    people.forEach(p => excluded.set(p, new Set([p])));
    excl.forEach(([a, b]) => {
      if (excluded.has(a)) excluded.get(a).add(b);
      if (excluded.has(b)) excluded.get(b).add(a);
    });

    // Check feasibility
    for (const p of people) {
      const canDraw = people.filter(r => !excluded.get(p).has(r));
      if (canDraw.length === 0) return { impossible: p };
    }

    // Try random shuffle
    for (let attempt = 0; attempt < 1000; attempt++) {
      const shuffled = [...people];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      let valid = true;
      for (let i = 0; i < n; i++) {
        if (excluded.get(people[i]).has(shuffled[i])) {
          valid = false;
          break;
        }
      }
      if (valid) {
        return people.map((p, i) => ({ giver: p, recipient: shuffled[i] }));
      }
    }

    // Backtracking fallback
    const available = new Set(people);
    const assignments = [];

    function solve(idx) {
      if (idx === n) return true;
      const giver = people[idx];
      const candidates = [...available].filter(r => !excluded.get(giver).has(r));
      // Shuffle candidates for randomness
      for (let i = candidates.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
      }
      for (const recipient of candidates) {
        available.delete(recipient);
        assignments.push({ giver, recipient });
        if (solve(idx + 1)) return true;
        assignments.pop();
        available.add(recipient);
      }
      return false;
    }

    return solve(0) ? assignments : null;
  }

  // ── Helpers ──
  function escHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  function showError(el, msg) {
    el.textContent = msg;
    el.classList.add('show');
  }

  function hideError(el) {
    el.classList.remove('show');
  }

  function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }

  // ── Init ──
  document.addEventListener('DOMContentLoaded', () => {
    initHome();
    handleRoute();
    window.addEventListener('hashchange', handleRoute);

    if ('serviceWorker' in navigator) {
      const hadWorker = !!navigator.serviceWorker.controller;
      navigator.serviceWorker.register('sw.js').then(reg => {
        // Opening a draw link in a tab that's already open doesn't load the page,
        // so look for a new version then, and when coming back to the app.
        const check = () => reg.update().catch(() => {});
        window.addEventListener('hashchange', check);
        document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
      }).catch(() => {});
      // A new version took over: load it, unless someone is writing their wishlist.
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (hadWorker && !document.getElementById('screen-wishlist').classList.contains('active')) location.reload();
      });
    }
  });
})();
