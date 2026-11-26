/* ===================== ORVEX — script.js ===================== */
(() => {
  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fine = matchMedia('(hover:hover) and (pointer:fine)').matches;

  /* ---------- 1. OPENING ANIMATION ---------- */
  const logs = ['initializing orbit engine', 'linking nodes', 'calibrating empathy', 'opening connections', 'ready'];
  const bar = $('#loaderBar'), pct = $('#loaderPct'), log = $('#loaderLog'), loader = $('#loader');
  const DURATION = reduce ? 300 : 2800;
  let startT = null;

  function loadStep(t) {
    if (!startT) startT = t;
    let p = Math.min((t - startT) / DURATION, 1);
    const eased = 1 - Math.pow(1 - p, 3);
    bar.style.width = (eased * 100) + '%';
    pct.textContent = Math.round(eased * 100) + '%';
    log.textContent = logs[Math.min(Math.floor(eased * logs.length), logs.length - 1)];
    if (p < 1) requestAnimationFrame(loadStep);
    else setTimeout(openSite, 380);
  }

  function openSite() {
    loader.classList.add('done');
    document.body.classList.remove('loading');
    document.body.classList.add('ready');
    startReveals();
    setTimeout(() => loader.remove(), 1600);
  }
  window.addEventListener('load', () => requestAnimationFrame(loadStep));

  /* ---------- 2. SCROLL REVEAL ---------- */
  function startReveals() {
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { threshold: .15, rootMargin: '0px 0px -40px 0px' });
    $$('.reveal').forEach(el => io.observe(el));
  }

  /* ---------- 3. SCROLL PROGRESS + NAV ---------- */
  const prog = $('#progress'), nav = $('#nav');
  function onScroll() {
    const h = document.documentElement;
    const p = h.scrollTop / (h.scrollHeight - h.clientHeight || 1);
    prog.style.transform = `scaleX(${p})`;
    nav.classList.toggle('scrolled', h.scrollTop > 40);
  }
  addEventListener('scroll', onScroll, { passive: true }); onScroll();

  const secs = $$('main section[id]'), navLinks = $$('.links a');
  const spy = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) navLinks.forEach(a => a.classList.toggle('active', a.getAttribute('href') === '#' + e.target.id));
    });
  }, { rootMargin: '-45% 0px -50% 0px' });
  secs.forEach(s => spy.observe(s));

  const burger = $('#burger'), links = $('#links');
  burger.addEventListener('click', () => { burger.classList.toggle('open'); links.classList.toggle('open'); });
  navLinks.forEach(a => a.addEventListener('click', () => { burger.classList.remove('open'); links.classList.remove('open'); }));

  /* ---------- 4. CURSOR GLOW ---------- */
  const glow = $('#glow');
  let gx = innerWidth / 2, gy = innerHeight / 2, tx = gx, ty = gy;
  const mouse = { x: -9999, y: -9999 };
  addEventListener('mousemove', e => { tx = e.clientX; ty = e.clientY; mouse.x = e.clientX; mouse.y = e.clientY; });
  (function glowLoop() {
    gx += (tx - gx) * .08; gy += (ty - gy) * .08;
    glow.style.transform = `translate(${gx}px,${gy}px)`;
    requestAnimationFrame(glowLoop);
  })();

  /* ---------- 5. ROTATING WORD ---------- */
  const words = ['classmates', 'neighbors', 'volunteers', 'friends', 'whole communities', 'anyone who needs a hand'];
  const rot = $('#rotator'); let wi = 0;
  if (!reduce) setInterval(() => {
    rot.classList.add('out');
    setTimeout(() => { wi = (wi + 1) % words.length; rot.textContent = words[wi]; rot.classList.remove('out'); }, 380);
  }, 2400);

  /* ---------- 6. 3D TILT + SPOTLIGHT ---------- */
  if (fine && !reduce) {
    $$('[data-tilt]').forEach(el => {
      el.addEventListener('mousemove', e => {
        const r = el.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
        el.style.setProperty('--ry', ((px - .5) * 10).toFixed(2) + 'deg');
        el.style.setProperty('--rx', ((.5 - py) * 10).toFixed(2) + 'deg');
        el.style.setProperty('--mx', (px * 100) + '%');
        el.style.setProperty('--my', (py * 100) + '%');
      });
      el.addEventListener('mouseleave', () => { el.style.setProperty('--rx', '0deg'); el.style.setProperty('--ry', '0deg'); });
    });

    // magnetic buttons
    $$('[data-magnetic]').forEach(b => {
      b.addEventListener('mousemove', e => {
        const r = b.getBoundingClientRect();
        b.style.transform = `translate(${(e.clientX - r.left - r.width / 2) * .25}px,${(e.clientY - r.top - r.height / 2) * .35}px)`;
      });
      b.addEventListener('mouseleave', () => b.style.transform = '');
    });

    // hero orb parallax
    const ow = $('#orbWrap');
    addEventListener('mousemove', e => {
      const x = (e.clientX / innerWidth - .5) * 2, y = (e.clientY / innerHeight - .5) * 2;
      ow.style.transform = `rotateY(${x * 12}deg) rotateX(${-y * 12}deg)`;
    });
  }

  /* ---------- 7. BACKGROUND NETWORK (connection theme) ---------- */
  const bg = $('#bg'), bctx = bg.getContext('2d');
  let BW, BH, pts = [];
  function sizeBG() {
    const d = Math.min(devicePixelRatio || 1, 2);
    BW = innerWidth; BH = innerHeight;
    bg.width = BW * d; bg.height = BH * d;
    bctx.setTransform(d, 0, 0, d, 0, 0);
    const n = Math.min(Math.floor(BW * BH / 15000), 110);
    pts = Array.from({ length: n }, () => ({
      x: Math.random() * BW, y: Math.random() * BH,
      vx: (Math.random() - .5) * .35, vy: (Math.random() - .5) * .35, r: Math.random() * 1.6 + .6
    }));
  }
  sizeBG(); addEventListener('resize', sizeBG);
  function drawBG() {
    bctx.clearRect(0, 0, BW, BH);
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0 || p.x > BW) p.vx *= -1;
      if (p.y < 0 || p.y > BH) p.vy *= -1;
      const dx = mouse.x - p.x, dy = mouse.y - p.y, dm = Math.hypot(dx, dy);
      if (dm < 160 && dm > 1) { p.x -= dx / dm * .5; p.y -= dy / dm * .5; }
      bctx.beginPath(); bctx.arc(p.x, p.y, p.r, 0, 6.283);
      bctx.fillStyle = 'rgba(160,220,255,.65)'; bctx.fill();
      for (let j = i + 1; j < pts.length; j++) {
        const q = pts[j], d = Math.hypot(p.x - q.x, p.y - q.y);
        if (d < 130) {
          bctx.strokeStyle = `rgba(110,170,255,${(1 - d / 130) * .22})`;
          bctx.lineWidth = 1; bctx.beginPath(); bctx.moveTo(p.x, p.y); bctx.lineTo(q.x, q.y); bctx.stroke();
        }
      }
      if (dm < 190) {
        bctx.strokeStyle = `rgba(77,243,255,${(1 - dm / 190) * .5})`;
        bctx.beginPath(); bctx.moveTo(p.x, p.y); bctx.lineTo(mouse.x, mouse.y); bctx.stroke();
      }
    }
    if (!reduce) requestAnimationFrame(drawBG);
  }
  drawBG();

  /* ---------- 8. INTERACTIVE ORBIT DEMO ---------- */
  const oc = $('#orbitCanvas'), octx = oc.getContext('2d');
  const COLORS = { study: '#4df3ff', wellness: '#ff4ecd', volunteer: '#8b5cf6', create: '#ffd166' };
  const TITLES = { study: 'Study help', wellness: 'Someone to talk to', volunteer: 'Volunteer', create: 'Create together' };
  const PEOPLE = [
    ['Aria', 'study', 0], ['Mateo', 'wellness', 0], ['Priya', 'volunteer', 0], ['Jonah', 'create', 0],
    ['Lena', 'create', 1], ['Omar', 'study', 1], ['Sofia', 'wellness', 1], ['Kai', 'volunteer', 1],
    ['Zara', 'volunteer', 2], ['Noah', 'create', 2], ['Mei', 'study', 2], ['Diego', 'wellness', 2]
  ];
  const ring = [.22, .35, .47], speed = [.00045, -.00032, .00022];
  const nodes = PEOPLE.map((p, i) => ({ name: p[0], tag: p[1], ring: p[2], a: (i % 4) * 1.57 + p[2] * .7, x: 0, y: 0 }));
  let tag = 'study', connected = new Set(), hover = null, OW, OH, running = false;

  function sizeOrbit() {
    const d = Math.min(devicePixelRatio || 1, 2), r = oc.getBoundingClientRect();
    OW = r.width; OH = r.height;
    oc.width = OW * d; oc.height = OH * d; octx.setTransform(d, 0, 0, d, 0, 0);
  }
  sizeOrbit(); addEventListener('resize', sizeOrbit);

  function updatePanel() {
    const n = nodes.filter(n => n.tag === tag).length;
    $('#orbitTitle').textContent = TITLES[tag];
    $('#orbitText').textContent = `${n} people in this orbit can help. Click a glowing node to connect.`;
    $('#orbitConnected').innerHTML = [...connected].map(nm => `<span>${nm}</span>`).join('');
  }
  updatePanel();

  $$('#orbitChips .pill').forEach(b => b.addEventListener('click', () => {
    $$('#orbitChips .pill').forEach(x => x.classList.remove('active'));
    b.classList.add('active'); tag = b.dataset.tag; updatePanel();
  }));

  function radii(r) {
    const ry = Math.min(OW, OH) * r * .95;
    const rx = Math.min(ry * 1.6, OW / 2 - 26);
    return [rx, ry];
  }
  function pos(n, t) {
    const [rx, ry] = radii(ring[n.ring]);
    const ang = n.a + t * speed[n.ring] * 16;
    n.x = OW / 2 + Math.cos(ang) * rx;
    n.y = OH / 2 + Math.sin(ang) * ry;
  }

  function drawOrbit(t) {
    octx.clearRect(0, 0, OW, OH);
    const cx = OW / 2, cy = OH / 2, col = COLORS[tag];
    // rings
    ring.forEach(r => {
      const [rx, ry] = radii(r);
      octx.beginPath(); octx.ellipse(cx, cy, rx, ry, 0, 0, 6.283);
      octx.strokeStyle = 'rgba(255,255,255,.08)'; octx.setLineDash([4, 8]); octx.stroke(); octx.setLineDash([]);
    });
    nodes.forEach(n => pos(n, t));
    // links
    nodes.forEach(n => {
      const on = n.tag === tag, con = connected.has(n.name);
      if (!on && !con) return;
      const c = COLORS[n.tag];
      const g = octx.createLinearGradient(cx, cy, n.x, n.y);
      g.addColorStop(0, c + (con ? 'ff' : '66')); g.addColorStop(1, c + (con ? 'aa' : '11'));
      octx.strokeStyle = g; octx.lineWidth = con ? 2.2 : 1;
      octx.beginPath(); octx.moveTo(cx, cy); octx.lineTo(n.x, n.y); octx.stroke();
      if (con) { // travelling pulse
        const k = (t / 900 + n.a) % 1;
        octx.fillStyle = '#fff'; octx.beginPath();
        octx.arc(cx + (n.x - cx) * k, cy + (n.y - cy) * k, 2.6, 0, 6.283); octx.fill();
      }
    });
    // center
    const pulse = 1 + Math.sin(t / 400) * .08;
    const cg = octx.createRadialGradient(cx - 6, cy - 6, 2, cx, cy, 30 * pulse);
    cg.addColorStop(0, '#fff'); cg.addColorStop(.35, col); cg.addColorStop(1, '#2a0f5e');
    octx.shadowColor = col; octx.shadowBlur = 40;
    octx.fillStyle = cg; octx.beginPath(); octx.arc(cx, cy, 26 * pulse, 0, 6.283); octx.fill();
    octx.shadowBlur = 0;
    octx.fillStyle = '#04050b'; octx.font = '700 10px Syne, sans-serif'; octx.textAlign = 'center'; octx.fillText('YOU', cx, cy + 4);
    // nodes
    nodes.forEach(n => {
      const on = n.tag === tag, con = connected.has(n.name), c = COLORS[n.tag];
      const rad = con ? 11 : on ? 9 + Math.sin(t / 300 + n.a) * 1.5 : 5;
      if (on || con) { octx.shadowColor = c; octx.shadowBlur = con ? 28 : 18; }
      octx.fillStyle = on || con ? c : 'rgba(255,255,255,.25)';
      octx.beginPath(); octx.arc(n.x, n.y, rad, 0, 6.283); octx.fill(); octx.shadowBlur = 0;
      if (con) { octx.strokeStyle = c; octx.lineWidth = 1.5; octx.beginPath(); octx.arc(n.x, n.y, rad + 6 + Math.sin(t / 250) * 2, 0, 6.283); octx.stroke(); }
      if (on || con || hover === n) {
        octx.fillStyle = '#eaf0ff'; octx.font = '500 12px Space Grotesk, sans-serif'; octx.textAlign = 'center';
        octx.fillText(n.name, n.x, n.y - rad - 10);
      }
    });
  }
  function orbitLoop(t) { if (!running) return; drawOrbit(t); requestAnimationFrame(orbitLoop); }
  new IntersectionObserver(es => es.forEach(e => {
    running = e.isIntersecting; if (running) requestAnimationFrame(orbitLoop);
  })).observe(oc);

  function nearest(e) {
    const r = oc.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    return nodes.find(n => Math.hypot(n.x - x, n.y - y) < 18) || null;
  }
  oc.addEventListener('mousemove', e => { hover = nearest(e); oc.style.cursor = hover && hover.tag === tag ? 'pointer' : 'crosshair'; });
  oc.addEventListener('mouseleave', () => hover = null);
  oc.addEventListener('click', e => {
    const n = nearest(e);
    if (!n || n.tag !== tag && !connected.has(n.name)) return;
    connected.has(n.name) ? connected.delete(n.name) : connected.add(n.name);
    updatePanel();
  });

  /* ---------- 9. MISC ---------- */
  $('#year').textContent = new Date().getFullYear();
})();
