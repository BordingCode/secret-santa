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
        showParticipants(data);
      } catch {
        goScreen('home');
      }
    } else {
      goScreen('home');
    }
  }

  // ── Home Screen ──
  function initHome() {
    document.getElementById('btn-create').addEventListener('click', () => {
      initCreateScreen();
      goScreen('create');
    });
    document.getElementById('btn-join').addEventListener('click', () => {
      const link = prompt('Indsæt det delte link her:');
      if (link) {
        try {
          const url = new URL(link);
          const hash = url.hash;
          if (hash.startsWith('#/g/')) {
            location.hash = hash;
          } else {
            alert('Ugyldigt link. Sørg for at kopiere hele linket.');
          }
        } catch {
          if (link.startsWith('#/g/')) {
            location.hash = link;
          } else {
            alert('Ugyldigt link. Sørg for at kopiere hele linket.');
          }
        }
      }
    });
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

    renderParticipantInputs();

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
      hideError(error);
      participants = names.map(n => n.trim());
      LS.set('participants', participants);
      exclusions = exclusions.filter(([a, b]) => participants.includes(a) && participants.includes(b));
      LS.set('exclusions', exclusions);
      initExclusionsSection();
      goScreen('exclusions');
    });

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
    });

    btnDraw.onclick = () => {
      hideError(error);
      const result = performDraw(participants, exclusions);
      if (!result) {
        showError(error, 'Lodtrækningen er umulig med disse undtagelser. Prøv at fjerne nogle.');
        return;
      }
      const groupName = LS.get('groupName') || 'Secret Santa';
      const data = { name: groupName, a: result.map(r => [r.giver, r.recipient]) };
      const encoded = encode(data);
      const shareUrl = location.origin + location.pathname + '#/g/' + encoded;
      showShareScreen(shareUrl, groupName);
    });

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
      [selA, selB].forEach(sel => {
        sel.innerHTML = '<option value="">Vælg...</option>';
        participants.forEach(name => {
          sel.innerHTML += `<option value="${escHtml(name)}">${escHtml(name)}</option>`;
        });
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
        await navigator.share({ title: groupName, text: 'Åbn linket for at se din Secret Santa!', url });
      } catch {}
    };

    document.getElementById('btn-new-draw').onclick = () => {
      if (confirm('Er du sikker? Den nuværende lodtrækning slettes.')) {
        location.hash = '';
        goScreen('home');
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
    };
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
      if (canDraw.length === 0) return null;
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
      navigator.serviceWorker.register('sw.js');
    }
  });
})();
