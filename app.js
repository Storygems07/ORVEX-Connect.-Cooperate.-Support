/* ===================== ORVEX app.js ===================== */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const INTERESTS = ['Study', 'Wellness', 'Volunteering', 'Creative', 'Gaming', 'Tech', 'Sports', 'Music'];
  const CATS = [...INTERESTS, 'Other'];

  const S = {
    token: localStorage.getItem('orvex_token') || '',
    me: null, rooms: [], users: new Map(), msgs: {}, board: [],
    unread: new Set(), view: 'chat', cur: 'lounge', filter: 'All', bType: 'need', es: null
  };

  /* ---------- helpers ---------- */
  function h(tag, props = {}, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (k === 'class') e.className = v;
      else if (k === 'style') e.style.cssText = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat(2)) if (kid != null && kid !== false) e.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return e;
  }
  const fmtTime = ts => new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const ago = ts => {
    const s = Math.max(0, Date.now() / 1000 - ts);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
  };
  const dmKey = o => 'dm:' + [S.me.id, o].sort().join(':');
  const otherOf = key => key.split(':').slice(1).find(x => x !== S.me.id);
  const U = id => S.users.get(id) || { id, name: 'Someone', color: '#8d97b8', interests: [], online: false };
  const lastTs = k => { const l = S.msgs[k]; return l && l.length ? l[l.length - 1].ts : 0; };
  const avatar = (u, size = '') => h('span', { class: 'av ' + size, style: `background:${u.color}` }, (u.name || '?')[0].toUpperCase());

  async function api(path, body) {
    const opt = body === undefined
      ? { headers: { 'X-Token': S.token } }
      : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Token': S.token }, body: JSON.stringify(body) };
    const r = await fetch(path, opt);
    let j = {};
    try { j = await r.json(); } catch (_) { /* ignore */ }
    if (!r.ok) throw Object.assign(new Error(j.error || 'Something went wrong.'), { status: r.status });
    return j;
  }

  function toast(text, onclick) {
    const t = h('div', { class: 'toast', onclick: () => { if (onclick) onclick(); t.remove(); } }, text);
    $('#toasts').append(t);
    setTimeout(() => t.remove(), 4000);
  }

  function updateTitle() {
    document.title = (S.unread.size ? `(${S.unread.size}) ` : '') + 'ORVEX';
  }

  /* ---------- join ---------- */
  function setupJoin() {
    const picked = new Set();
    INTERESTS.forEach(i => {
      const b = h('button', { type: 'button', class: 'pill', onclick: () => { picked.has(i) ? picked.delete(i) : picked.add(i); b.classList.toggle('active'); } }, i);
      $('#joinChips').append(b);
    });
    $('#joinForm').addEventListener('submit', async e => {
      e.preventDefault();
      const err = $('#joinErr'), btn = $('#joinBtn');
      err.textContent = ''; btn.disabled = true;
      try {
        const r = await api('/api/join', { name: $('#joinName').value, interests: [...picked] });
        S.token = r.token; localStorage.setItem('orvex_token', r.token);
        await boot();
      } catch (ex) { err.textContent = ex.message; }
      finally { btn.disabled = false; }
    });
  }

  /* ---------- boot ---------- */
  function applyState(st) {
    S.me = st.me; S.rooms = st.rooms;
    S.users = new Map(st.users.map(u => [u.id, u]));
    S.users.set(S.me.id, S.me);
    S.msgs = { ...st.messages };
    for (const [other, list] of Object.entries(st.dms)) S.msgs[dmKey(other)] = list;
    S.board = st.board;
  }

  async function boot() {
    applyState(await api('/api/state'));
    $('#join').classList.add('hide');
    $('#app').classList.remove('hide');
    buildStatic();
    show('chat', S.rooms.some(r => r.id === S.cur) ? S.cur : 'lounge');
    renderPeople();
    connect();
  }

  function connect() {
    if (S.es) S.es.close();
    const es = new EventSource('/api/stream?token=' + encodeURIComponent(S.token));
    S.es = es;
    let first = true;
    es.onopen = () => { setConn(true); if (!first) resync(); first = false; };
    es.onerror = () => setConn(false);
    es.addEventListener('msg', e => onMessage(JSON.parse(e.data)));
    es.addEventListener('user', e => onUser(JSON.parse(e.data)));
    es.addEventListener('board', e => onBoard(JSON.parse(e.data)));
  }

  async function resync() {
    try {
      const cur = S.cur, view = S.view;
      applyState(await api('/api/state'));
      renderSide(); renderPeople(); show(view, cur);
    } catch (_) { /* ignore */ }
  }

  function setConn(ok) {
    const c = $('#conn');
    c.classList.toggle('ok', ok);
    $('span', c).textContent = ok ? 'live' : 'reconnecting…';
  }

  /* ---------- live events ---------- */
  function onMessage(m) {
    const list = (S.msgs[m.room] = S.msgs[m.room] || []);
    if (list.some(x => x.id === m.id)) return;
    list.push(m);
    const viewing = S.view === 'chat' && S.cur === m.room && !document.hidden;
    if (viewing) {
      appendMsg(m, list[list.length - 2]);
    } else if (m.uid !== S.me.id) {
      S.unread.add(m.room);
      if (m.room.startsWith('dm:')) toast(`${m.name}: ${m.text.slice(0, 70)}`, () => show('chat', m.room));
      updateTitle();
    }
    if (m.room.startsWith('dm:')) renderSide();
    else if (!viewing) renderSide();
  }

  function onUser(u) {
    S.users.set(u.id, u);
    if (u.id === S.me.id) S.me = u;
    renderPeople(); renderSide();
    if (S.view === 'orbit') renderOrbit();
    if (S.view === 'chat' && S.cur.startsWith('dm:') && otherOf(S.cur) === u.id) renderHead();
  }

  function onBoard(p) {
    const i = S.board.findIndex(x => x.id === p.id);
    if (i >= 0) S.board[i] = p; else S.board.unshift(p);
    if (S.view === 'board') renderBoard();
  }

  /* ---------- navigation ---------- */
  function show(view, cur) {
    S.view = view;
    if (cur) S.cur = cur;
    ['chat', 'board', 'orbit'].forEach(v => $('#' + v).classList.toggle('hide', v !== view));
    if (view === 'chat') { S.unread.delete(S.cur); renderChat(); }
    if (view === 'board') renderBoard();
    if (view === 'orbit') renderOrbit();
    $('#topTitle').textContent = view === 'board' ? 'Give-Back Board' : view === 'orbit' ? 'My Orbit' : chatTitle();
    renderSide(); updateTitle();
    $('#side').classList.remove('open'); $('#scrim').classList.remove('on');
  }
  const chatTitle = () => S.cur.startsWith('dm:') ? U(otherOf(S.cur)).name : (S.rooms.find(r => r.id === S.cur) || {}).name || 'ORVEX';

  function openDM(id) {
    const k = dmKey(id);
    S.msgs[k] = S.msgs[k] || [];
    show('chat', k);
  }

  /* ---------- sidebar & people ---------- */
  function renderSide() {
    if (!S.me) return;
    $('#roomList').replaceChildren(...S.rooms.map(r =>
      h('button', { class: 'item' + (S.view === 'chat' && S.cur === r.id ? ' on' : ''), onclick: () => show('chat', r.id) },
        h('span', { class: 'ico' }, r.icon), h('span', { class: 'lbl' }, r.name),
        S.unread.has(r.id) && h('i', { class: 'dot' }))));

    const keys = Object.keys(S.msgs).filter(k => k.startsWith('dm:')).sort((a, b) => lastTs(b) - lastTs(a));
    $('#dmList').replaceChildren(...(keys.length ? keys.map(k => {
      const o = U(otherOf(k));
      return h('button', { class: 'item' + (S.view === 'chat' && S.cur === k ? ' on' : ''), onclick: () => show('chat', k) },
        avatar(o, 'sm'), h('span', { class: 'lbl' }, o.name),
        h('i', { class: 'live-dot' + (o.online ? ' live' : '') }),
        S.unread.has(k) && h('i', { class: 'dot' }));
    }) : [h('p', { class: 'hint' }, 'No messages yet. Say hi to someone from your Orbit.')]));

    $$('.item[data-view]').forEach(b => b.classList.toggle('on', S.view === b.dataset.view));
    $('#meCard').replaceChildren(avatar(S.me), h('div', {}, h('b', {}, S.me.name), h('span', {}, S.me.interests.join(' · ') || 'no interests yet')),
      h('button', { class: 'btn btn-ghost sm', title: 'Copy invite link', onclick: invite }, 'Invite'));
  }

  function renderPeople() {
    if (!S.me) return;
    const on = [...S.users.values()].filter(u => u.online && u.id !== S.me.id);
    $('#people').replaceChildren(
      h('h4', {}, 'Online now', h('span', { class: 'count' }, String(on.length + 1))),
      ...(on.length ? on.map(u => h('button', { class: 'item', onclick: () => openDM(u.id) },
        avatar(u, 'sm'), h('span', { class: 'lbl' }, u.name), h('i', { class: 'live-dot live' })))
        : [h('p', { class: 'hint' }, "You're the first one here. Invite a friend and watch this fill up."),
        h('div', { style: 'padding:10px' }, h('button', { class: 'btn btn-primary sm', onclick: invite }, 'Copy invite link'))]));
  }

  async function invite() {
    const url = location.origin + '/app';
    try { await navigator.clipboard.writeText(url); toast('Invite link copied — send it to a friend!'); }
    catch (_) { prompt('Copy this link and share it:', url); }
  }

  /* ---------- chat ---------- */
  function renderHead() {
    const key = S.cur, head = $('#chatHead');
    if (key.startsWith('dm:')) {
      const o = U(otherOf(key));
      head.replaceChildren(avatar(o), h('div', {}, h('h3', {}, o.name),
        h('p', { class: 'sub' }, (o.online ? 'Online now' : 'Offline — they will see your message when they return') + (o.interests.length ? ' · ' + o.interests.join(', ') : ''))));
    } else {
      const r = S.rooms.find(x => x.id === key) || { icon: '◎', name: key, topic: '' };
      head.replaceChildren(h('span', { class: 'ico big' }, r.icon), h('div', {}, h('h3', {}, r.name), h('p', { class: 'sub' }, r.topic)));
    }
  }

  function renderChat() {
    const key = S.cur, box = $('#msgs');
    renderHead();
    const notice = $('#notice');
    if (key === 'talk') {
      notice.textContent = 'Be gentle with each other. If someone is in danger or may hurt themselves, tell a trusted adult or call your local emergency number right away.';
      notice.classList.remove('hide');
    } else notice.classList.add('hide');
    box.replaceChildren();
    const list = (S.msgs[key] || []).slice(-150);
    if (!list.length) box.append(h('p', { class: 'empty' }, key.startsWith('dm:') ? 'This is the start of your conversation. Say hi!' : 'Nothing here yet. Be the first to say something!'));
    list.forEach((m, i) => box.append(msgEl(m, list[i - 1])));
    box.scrollTop = box.scrollHeight;
    $('#input').placeholder = key.startsWith('dm:') ? `Message ${U(otherOf(key)).name}…` : 'Write a message…';
    if (!matchMedia('(max-width:760px)').matches) $('#input').focus();
  }

  function msgEl(m, prev) {
    if (m.sys) return h('div', { class: 'sys' }, m.text);
    const mine = m.uid === S.me.id;
    const cont = prev && !prev.sys && prev.uid === m.uid && m.ts - prev.ts < 300;
    return h('div', { class: 'msg' + (mine ? ' mine' : '') + (cont ? ' cont' : '') },
      cont ? h('span', { class: 'av sp' }) : h('button', { class: 'avbtn', title: mine ? '' : 'Message ' + m.name, onclick: () => { if (!mine) openDM(m.uid); } }, avatar({ name: m.name, color: m.color })),
      h('div', { class: 'bub' },
        cont ? null : h('div', { class: 'meta' }, h('b', { style: `color:${m.color}` }, m.name), h('time', {}, fmtTime(m.ts))),
        h('div', { class: 'txt' }, m.text),
        !mine && h('button', { class: 'rep', title: 'Report this message', onclick: () => report(m) }, '⚑')));
  }

  function appendMsg(m, prev) {
    const box = $('#msgs');
    const empty = $('.empty', box); if (empty) empty.remove();
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 140 || m.uid === S.me.id;
    box.append(msgEl(m, prev));
    if (nearBottom) box.scrollTop = box.scrollHeight;
  }

  async function report(m) {
    if (!confirm('Report this message to the moderators?')) return;
    try { await api('/api/report', { id: m.id, room: m.room }); toast('Thanks — the message was reported.'); }
    catch (ex) { toast(ex.message); }
  }

  /* ---------- board ---------- */
  function buildStatic() {
    if (S.built) return;
    S.built = true;
    $('#boardCat').replaceChildren(...CATS.map(c => h('option', { value: c }, c)));
    $$('.seg button').forEach(b => b.addEventListener('click', () => {
      S.bType = b.dataset.type;
      $$('.seg button').forEach(x => x.classList.toggle('on', x === b));
      $('#boardText').placeholder = S.bType === 'need'
        ? "e.g. Stuck on quadratic equations before Friday's test…"
        : 'e.g. I can tutor Python basics on weekends…';
    }));
    $('#boardText').addEventListener('input', e => { $('#boardCount').textContent = e.target.value.length + '/240'; });
    $('#boardForm').addEventListener('submit', async e => {
      e.preventDefault();
      const ta = $('#boardText');
      try {
        await api('/api/board', { type: S.bType, category: $('#boardCat').value, text: ta.value });
        ta.value = ''; $('#boardCount').textContent = '0/240'; toast('Posted to the board!');
      } catch (ex) { toast(ex.message); }
    });
    $('#composer').addEventListener('submit', async e => {
      e.preventDefault();
      const inp = $('#input'), text = inp.value.trim();
      if (!text) return;
      inp.value = '';
      const isDM = S.cur.startsWith('dm:');
      try { await api('/api/send', isDM ? { to: otherOf(S.cur), text } : { room: S.cur, text }); }
      catch (ex) { toast(ex.message); inp.value = text; }
    });
    $$('.item[data-view]').forEach(b => b.addEventListener('click', () => show(b.dataset.view)));
    $('#menuBtn').addEventListener('click', () => { $('#side').classList.add('open'); $('#scrim').classList.add('on'); });
    $('#scrim').addEventListener('click', () => { $('#side').classList.remove('open'); $('#scrim').classList.remove('on'); });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && S.view === 'chat') { S.unread.delete(S.cur); renderSide(); updateTitle(); }
    });
  }

  function renderBoard() {
    $('#boardFilter').replaceChildren(...['All', ...CATS].map(c =>
      h('button', { class: 'pill' + (S.filter === c ? ' active' : ''), onclick: () => { S.filter = c; renderBoard(); } }, c)));
    const posts = S.board.filter(p => p.open && (S.filter === 'All' || p.category === S.filter));
    $('#boardList').replaceChildren(...(posts.length ? posts.map(p => {
      const mine = p.uid === S.me.id;
      return h('article', { class: 'post ' + p.type },
        h('div', { class: 'post-top' },
          h('span', { class: 'tag ' + p.type }, p.type === 'need' ? 'Needs help' : 'Offers help'),
          h('span', { class: 'tag' }, p.category), h('time', {}, ago(p.ts))),
        h('p', { class: 'post-text' }, p.text),
        h('div', { class: 'post-foot' },
          h('span', { class: 'by' }, avatar(p, 'sm'), mine ? 'You' : p.name),
          p.responders ? h('span', { class: 'resp' }, `${p.responders} connected`) : null,
          mine
            ? h('button', { class: 'btn btn-ghost sm', onclick: () => closePost(p.id) }, 'Close post')
            : h('button', { class: 'btn btn-primary sm', onclick: () => respond(p) }, p.type === 'need' ? 'I can help' : "I'm interested")));
    }) : [h('div', { class: 'card', style: 'text-align:center;color:var(--muted)' }, 'No posts here yet. Be the first — ask for help or offer yours above.')]));
  }

  async function respond(p) {
    try { const r = await api('/api/board/respond', { id: p.id }); S.msgs[r.room] = S.msgs[r.room] || []; show('chat', r.room); }
    catch (ex) { toast(ex.message); }
  }
  async function closePost(id) {
    try { await api('/api/board/close', { id }); toast('Post closed.'); } catch (ex) { toast(ex.message); }
  }

  /* ---------- orbit ---------- */
  function renderOrbit() {
    const mine = new Set(S.me.interests);
    $('#myInterests').replaceChildren(...INTERESTS.map(i =>
      h('button', { class: 'pill' + (mine.has(i) ? ' active' : ''), onclick: async () => {
        mine.has(i) ? mine.delete(i) : mine.add(i);
        try { await api('/api/profile', { interests: [...mine] }); } catch (ex) { toast(ex.message); }
      } }, i)));
    const people = [...S.users.values()].filter(u => u.online && u.id !== S.me.id)
      .map(u => ({ u, shared: u.interests.filter(i => mine.has(i)) }))
      .sort((a, b) => b.shared.length - a.shared.length || a.u.name.localeCompare(b.u.name));
    $('#orbitList').replaceChildren(...(people.length ? people.map(({ u, shared }) =>
      h('div', { class: 'pcard' }, avatar(u, 'lg'), h('h4', {}, u.name),
        h('div', { class: 'chips' }, u.interests.length ? u.interests.map(i => h('span', { class: 'tag' + (mine.has(i) ? ' hit' : '') }, i)) : h('span', { class: 'tag' }, 'no interests yet')),
        h('p', { class: 'match' }, shared.length ? `${shared.length} in common` : 'New connection'),
        h('button', { class: 'btn btn-primary sm', onclick: () => openDM(u.id) }, 'Say hi')))
      : [h('div', { class: 'card invite' }, h('h4', {}, "You're the first one here"),
        h('p', { class: 'muted' }, 'Nobody else is online right now. Invite a friend and your orbit will fill up.'),
        h('button', { class: 'btn btn-primary', onclick: invite }, 'Copy invite link'))]));
  }

  /* ---------- start ---------- */
  (async function init() {
    setupJoin();
    if (S.token) {
      try { await boot(); return; }
      catch (e) { if (e.status === 401) { S.token = ''; localStorage.removeItem('orvex_token'); } }
    }
    $('#join').classList.remove('hide');
  })();
})();
