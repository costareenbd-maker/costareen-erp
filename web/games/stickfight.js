/*
 * Stick fight across the ERP: a red ninja and black stickmen fight all day on the outlines of the page.
 * The top line of every box and button is a floor, the side lines of tall boxes are walls; they never fly,
 * only jump from one ledge to another in real arcs, and keep clear of the mouse (a circle around it) and of
 * the field being typed in. Knocked-out fighters become ragdolls that tumble down the boxes, then fade.
 * Drawn on one see-through canvas over the page that never takes a click. Loaded only when switched on.
 */
(function () {
  'use strict';
  var G = 1900, ZONE = 95;
  var SEL = '#view .card, #view .btn, #view button, #view .c3bar, #view .o_lv, #view .pill, #view .cchip, #o_cp .btn, #o_cp .cchip, #pgame';

  // ---- poses (degrees from straight down, positive = towards where he faces); the body is small, about 46 px
  var P = {
    idle: { L: 14, hy: 20, sF: 50, eF: 100, sB: 30, eB: 110, hF: 30, kF: -45, hB: -22, kB: -30 },
    run: null,
    air: { L: 10, hy: 21, sF: 70, eF: 80, sB: -40, eB: 60, hF: 70, kF: -110, hB: 30, kB: -100 },
    fall: { L: -6, hy: 21, sF: 130, eF: 20, sB: -120, eB: -20, hF: 30, kF: -40, hB: -20, kB: -30 },
    land: { L: 30, hy: 13, sF: 60, eF: 60, sB: 10, eB: 70, hF: 70, kF: -120, hB: -30, kB: -80 },
    hit: { L: -30, hy: 20, sF: -30, eF: 30, sB: -50, eB: 30, hF: 10, kF: -10, hB: -25, kB: -10 },
    cling: { L: -10, hy: 20, sF: -150, eF: 10, sB: -130, eB: 10, hF: -30, kF: 60, hB: -50, kB: 70 },
    punch: { L: 22, hy: 20, sF: 90, eF: 0, sB: 10, eB: 120, hF: 38, kF: -40, hB: -30, kB: -20 },
    kick: { L: -24, hy: 21, sF: 40, eF: 90, sB: -30, eB: 60, hF: 100, kF: 0, hB: -10, kB: -10 },
    upper: { L: -8, hy: 22, sF: 170, eF: 15, sB: 20, eB: 100, hF: 20, kF: -20, hB: -20, kB: -15 },
    slash: { L: 26, hy: 18, sF: 100, eF: 10, sB: 60, eB: 40, hF: 50, kF: -60, hB: -40, kB: -20 },
    throw: { L: 18, hy: 20, sF: 95, eF: 5, sB: -40, eB: 50, hF: 35, kF: -40, hB: -30, kB: -20 },
    flykick: { L: -30, hy: 21, sF: 60, eF: 70, sB: -60, eB: 50, hF: 95, kF: 0, hB: 10, kB: -90 },
    taunt: { L: 0, hy: 21, sF: 160, eF: 30, sB: 20, eB: 120, hF: 15, kF: -10, hB: -15, kB: -10 }
  };
  function mix(a, b, t) { var o = {}; for (var k in a) o[k] = a[k] + (b[k] - a[k]) * t; return o; }
  function ease(t) { return t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t); }
  function rad(a) { return a * Math.PI / 180; }
  // attacks: time to the hit, how long it hits, total time, reach, damage, push, lift
  var ATK = {
    punch: { pose: 'punch', hit: 0.06, act: 0.08, end: 0.22, reach: 20, dmg: 8, kb: 160, up: 0 },
    kick: { pose: 'kick', hit: 0.09, act: 0.09, end: 0.3, reach: 26, dmg: 12, kb: 260, up: 160 },
    upper: { pose: 'upper', hit: 0.08, act: 0.1, end: 0.34, reach: 18, dmg: 14, kb: 120, up: 520 },
    round: { pose: 'kick', hit: 0.14, act: 0.12, end: 0.42, reach: 28, dmg: 16, kb: 360, up: 240, spin: 1 },
    slash: { pose: 'slash', hit: 0.07, act: 0.1, end: 0.3, reach: 34, dmg: 20, kb: 300, up: 220, blade: 1 },
    flykick: { pose: 'flykick', hit: 0.02, act: 0.4, end: 0.5, reach: 22, dmg: 16, kb: 380, up: 220, air: 1 },
    throw: { pose: 'throw', hit: 0.12, act: 0, end: 0.32, reach: 0, dmg: 10, kb: 140, up: 100, star: 1 }
  };

  window.ERP_STICK = function (o) {
    o = o || {};
    var cv = document.createElement('canvas'); cv.id = 'stickfx';
    cv.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;pointer-events:none;z-index:45';
    document.body.appendChild(cv);
    var ctx = cv.getContext('2d'), W = 0, H = 0, dpr = 1;
    var mode = o.mode || 'on', blood = o.blood !== false, on = false, raf = 0, last = 0, acc = 0;
    var plats = [], walls = [], men = [], fx = [], decals = [], stars = [], rags = [];
    var mx = -999, my = -999, mouseT = 0, scanT = 0, now = 0, spawnT = 0;

    function size() {
      dpr = window.devicePixelRatio || 1; W = window.innerWidth; H = window.innerHeight;
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    function dark() {
      var s = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim().replace('#', '');
      if (s.length === 3) s = s.replace(/./g, '$&$&'); var n = parseInt(s, 16);
      return isNaN(n) || ((n >> 16) * 0.3 + ((n >> 8) & 255) * 0.59 + (n & 255) * 0.11) < 140;
    }

    // ---- the floors and walls: read from the page, again on scroll / resize and every half second
    function scan() {
      var els = document.querySelectorAll(SEL), np = [], nw = [];
      for (var i = 0; i < els.length; i++) {
        var e = els[i]; if (!e.offsetParent && e.id !== 'pgame') continue;
        var r = e.getBoundingClientRect();
        if (r.width < 26 || r.height < 14 || r.bottom < 0 || r.top > H || r.top < 4) continue;
        np.push({ el: e, x0: r.left + 2, x1: r.right - 2, y: r.top });
        if (r.height > 60) { nw.push({ el: e, x: r.left, y0: r.top + 4, y1: Math.min(H, r.bottom), side: -1 }); nw.push({ el: e, x: r.right, y0: r.top + 4, y1: Math.min(H, r.bottom), side: 1 }); }
      }
      np.push({ el: null, x0: 0, x1: W, y: H - 2, ground: 1 });
      nw = nw.filter(function (w) {
        return !np.some(function (p) { if (!p.el || p.el === w.el) return false; var r = p.el.getBoundingClientRect(); var near = w.side === -1 ? (w.x - r.right >= -2 && w.x - r.right < 60) : (r.left - w.x >= -2 && r.left - w.x < 60); return near && r.bottom > w.y0 && r.top < w.y1; });
      });
      // fighters standing on a box ride along with it
      men.forEach(function (m) {
        if (!m.on) return;
        var q = m.on.el ? np.filter(function (p) { return p.el === m.on.el; })[0] : np[np.length - 1];
        if (q) { m.x = q.x0 + (m.x - m.on.x0); m.y = q.y; m.on = q; if (m.x < q.x0 - 2 || m.x > q.x1 + 2) m.on = null; }
        else m.on = null;
      });
      decals.forEach(function (d) { if (!d.on) return; var q = d.on.el ? np.filter(function (p) { return p.el === d.on.el; })[0] : np[np.length - 1]; if (q) { d.x = q.x0 + (d.x - d.on.x0); d.y = q.y; d.on = q; } else d.t = 0; });
      plats = np; walls = nw;
    }
    function platAt(x, y, tol) { for (var i = 0; i < plats.length; i++) { var p = plats[i]; if (x >= p.x0 && x <= p.x1 && Math.abs(p.y - y) <= (tol || 2)) return p; } return null; }
    // the mouse circle and the field being typed in: no fighting there
    function blocked(x, y) {
      if (Math.hypot(x - mx, y - 22 - my) < ZONE + 16 && now - mouseT < 6) return true;
      var a = document.activeElement;
      if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) { var r = a.getBoundingClientRect(); if (x > r.left - 40 && x < r.right + 40 && y > r.top - 10 && y < r.bottom + 70) return true; }
      return false;
    }

    // ---- fighters
    function make(team, p) {
      var x = p ? p.x0 + Math.random() * (p.x1 - p.x0) : Math.random() * W;
      return { team: team, x: x, y: p ? p.y : -40, vx: 0, vy: 0, dir: Math.random() < 0.5 ? 1 : -1, on: p || null, st: p ? 'idle' : 'air', t: 0, atk: null, done: 0,
        hp: team === 'hero' ? 160 : 40, max: team === 'hero' ? 160 : 40, cd: 0, think: 0, ph: Math.random() * 6, flash: 0, combo: 0, lastHit: -9, trail: [], flip: 0, spin: 0 };
    }
    function spawn(team) {
      // a ledge away from the mouse and from the others
      var ok = plats.filter(function (p) { return !p.ground && p.x1 - p.x0 > 40 && p.y > 40 && !blocked((p.x0 + p.x1) / 2, p.y); });
      var p = ok.length ? ok[Math.floor(Math.random() * ok.length)] : plats[plats.length - 1];
      var m = make(team, p);
      smoke(m.x, m.y - 20, team === 'hero' ? '#ef4444' : '#64748b');
      men.push(m); return m;
    }
    function smoke(x, y, c) { for (var i = 0; i < 10; i++) fx.push({ k: 'smoke', x: x, y: y, vx: (Math.random() - 0.5) * 80, vy: -Math.random() * 60, t: 0.6, T: 0.6, r: 4 + Math.random() * 5, c: c }); }
    function spark(x, y, n, c) { for (var i = 0; i < n; i++) fx.push({ k: 'spark', x: x, y: y, vx: (Math.random() - 0.5) * 360, vy: (Math.random() - 0.8) * 300, t: 0.3, T: 0.3, c: c || '#fff' }); }
    function bleed(x, y, dir, n) {
      if (!blood) { spark(x, y, n, '#fde68a'); return; }
      for (var i = 0; i < n; i++) fx.push({ k: 'blood', x: x, y: y, vx: dir * (60 + Math.random() * 260) + (Math.random() - 0.5) * 80, vy: -80 - Math.random() * 260, t: 1.4, T: 1.4, r: 1 + Math.random() * 1.8 });
    }
    function begin(m, st, atk) { m.st = st; m.t = 0; m.done = 0; m.atk = atk || null; m.trail = []; }
    function foes(m) { return men.filter(function (q) { return q !== m && q.team !== m.team && q.st !== 'dead'; }); }
    function hurt(a, b, A) {
      if (b.st === 'dead' || b.inv > 0) return;
      var dir = b.x >= a.x ? 1 : -1;
      if (b.st === 'block' && b.dir === -dir) { spark(b.x - dir * 6, b.y - 28, 6); b.vx = dir * A.kb * 0.4; return; }
      b.hp -= A.dmg; b.flash = 0.1; b.lastHit = now;
      bleed(b.x, b.y - 30, dir, A.blade ? 16 : 8);
      spark(b.x - dir * 4, b.y - 30, A.blade ? 4 : 8);
      fx.push({ k: 'ring', x: b.x - dir * 4, y: b.y - 30, t: 0.2, T: 0.2 });
      if (A.dmg >= 14) fx.push({ k: 'star', x: b.x - dir * 4, y: b.y - 30, t: 0.12, T: 0.12 });
      if (b.hp <= 0) { die(b, dir * (A.kb + 120), -(A.up + 260)); a.combo++; return; }
      b.vx = dir * A.kb; if (A.up) { b.vy = -A.up; b.on = null; }
      begin(b, A.up > 200 ? 'tumble' : 'hit');
    }
    // ---- a knocked-out fighter turns into a ragdoll: points joined by sticks, falling and bouncing on the ledges
    function die(m, vx, vy) {
      begin(m, 'dead');
      var J = joints(m, pose(m)), pts = {};
      ['head', 'neck', 'hip', 'eF', 'hF', 'eB', 'hB', 'kF', 'fF', 'kB', 'fB'].forEach(function (k) { var p = J[k]; pts[k] = { x: p.x, y: p.y, px: p.x - vx / 60 + (Math.random() - 0.5) * 2, py: p.y - vy / 60 + (Math.random() - 0.5) * 2 }; });
      var sticks = [['head', 'neck'], ['neck', 'hip'], ['neck', 'eF'], ['eF', 'hF'], ['neck', 'eB'], ['eB', 'hB'], ['hip', 'kF'], ['kF', 'fF'], ['hip', 'kB'], ['kB', 'fB'], ['head', 'hip']];
      sticks = sticks.map(function (s) { var a = pts[s[0]], b = pts[s[1]]; return [s[0], s[1], Math.hypot(a.x - b.x, a.y - b.y)]; });
      rags.push({ team: m.team, pts: pts, sticks: sticks, t: 0, bleedT: 0 });
      men.splice(men.indexOf(m), 1);
    }
    function stepRag(r, dt) {
      r.t += dt;
      var k;
      for (k in r.pts) {
        var p = r.pts[k], vx = (p.x - p.px) * 0.99, vy = (p.y - p.py) * 0.99;
        p.px = p.x; p.py = p.y; p.x += vx; p.y += vy + G * dt * dt;
        // the ledges catch it
        for (var i = 0; i < plats.length; i++) { var q = plats[i]; if (p.x >= q.x0 && p.x <= q.x1 && p.py <= q.y + 0.5 && p.y > q.y) { p.y = q.y; p.py = p.y + (p.y - p.py) * 0.3; p.px = p.x - vx * 0.6; break; } }
        if (p.x < 0) { p.x = 0; p.px = p.x + vx * 0.5; } if (p.x > W) { p.x = W; p.px = p.x + vx * 0.5; }
      }
      for (var it = 0; it < 3; it++) r.sticks.forEach(function (s) {
        var a = r.pts[s[0]], b = r.pts[s[1]], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 0.01, df = (d - s[2]) / d * 0.5;
        a.x += dx * df; a.y += dy * df; b.x -= dx * df; b.y -= dy * df;
      });
      if (blood && r.t < 1.2) { r.bleedT -= dt; if (r.bleedT <= 0) { r.bleedT = 0.08; var n = r.pts.neck; fx.push({ k: 'blood', x: n.x, y: n.y, vx: (Math.random() - 0.5) * 60, vy: -40, t: 1.2, T: 1.2, r: 1.2 }); } }
    }

    // ---- what each fighter does
    function reachable(m, p, tx) {   // can he jump there from here?
      var dx = tx - m.x, rise = m.y - p.y;
      return Math.abs(dx) < 300 && rise < 170 && rise > -420;
    }
    function jumpTo(m, x, y, flip) {
      var dx = x - m.x, rise = m.y - y, T = Math.max(0.36, Math.min(0.85, 0.3 + Math.abs(dx) / 700 + Math.max(0, rise) / 900));
      m.vx = dx / T; m.vy = -(rise + 0.5 * G * T * T) / T; m.on = null; m.dir = dx >= 0 ? 1 : -1;
      begin(m, 'air'); m.flip = flip ? 1 : 0; m.spin = 0; dust(m.x, m.y, 3);
    }
    function dust(x, y, n) { for (var i = 0; i < n; i++) fx.push({ k: 'dust', x: x + (Math.random() - 0.5) * 10, y: y - 1, vx: (Math.random() - 0.5) * 70, vy: -Math.random() * 30, t: 0.4, T: 0.4, r: 2 + Math.random() * 2 }); }
    function escape(m) {
      // the mouse came close: flip or run to a ledge outside the circle, away from it
      var away = m.x >= mx ? 1 : -1, best = null, bs = -1e9;
      plats.forEach(function (p) {
        if (p === m.on && !p.ground) return;
        var tx = Math.max(p.x0 + 6, Math.min(p.x1 - 6, m.x + away * 140));
        if (!reachable(m, p, tx) || blocked(tx, p.y)) return;
        var sc = (tx - m.x) * away - Math.abs(m.y - p.y) * 0.4 - Math.abs(tx - m.x) * 0.2;
        if (sc > bs) { bs = sc; best = [tx, p.y]; }
      });
      if (best) jumpTo(m, best[0], best[1], Math.random() < 0.7);
      else { m.st = 'run'; m.vx = away * 330; m.dir = away; }
    }
    function think(m, dt) {
      m.think -= dt; m.cd = Math.max(0, m.cd - dt);
      if (m.team === 'hero' && now - m.lastHit > 2 && m.hp < m.max) m.hp = Math.min(m.max, m.hp + 10 * dt);
      if (!m.on) return;
      if (m.st === 'atk' || m.st === 'hit' || m.st === 'land' || m.st === 'tumble') return;
      if (blocked(m.x, m.y)) { escape(m); return; }
      if (m.think > 0) { if (m.st === 'run' && (m.x <= m.on.x0 + 3 || m.x >= m.on.x1 - 3)) { m.vx = 0; m.st = 'idle'; } return; }
      m.think = (m.team === 'hero' ? 0.14 : 0.16) + Math.random() * 0.25 * (mode === 'calm' ? 3 : 1);
      var fs = foes(m); if (!fs.length) { m.st = 'idle'; m.vx = 0; return; }
      var tg = fs.sort(function (a, b) { return Math.hypot(a.x - m.x, a.y - m.y) - Math.hypot(b.x - m.x, b.y - m.y); })[0];
      var dx = tg.x - m.x, dy = tg.y - m.y, ad = Math.abs(dx);
      m.dir = dx >= 0 ? 1 : -1;
      if (!tg.on) { m.vx = 0; if (m.st === 'run') m.st = 'idle'; return; }
      // the black ones come to the ninja; the ninja fights whoever is on his ledge and waits a little before going after the rest
      if (m.team === 'hero') { var here = fs.filter(function (q) { return q.on === m.on; }); if (here.length) { tg = here.sort(function (a, b) { return Math.abs(a.x - m.x) - Math.abs(b.x - m.x); })[0]; dx = tg.x - m.x; dy = 0; ad = Math.abs(dx); m.dir = dx >= 0 ? 1 : -1; } else if (Math.random() < 0.8) { m.st = 'idle'; m.vx = 0; return; } }
      var speed = (m.team === 'hero' ? 240 : 170) * (mode === 'calm' ? 0.6 : 1);
      if (Math.abs(dy) < 8 && tg.on === m.on) {
        if (ad < 30) {
          if (blocked(tg.x, tg.y)) { m.vx = 0; m.st = 'idle'; return; }
          var r = Math.random();
          if (m.team === 'enemy' && r < 0.15) { begin(m, 'block'); m.vx = 0; return; }
          var a = m.team === 'hero' ? (r < 0.3 ? 'slash' : r < 0.5 ? 'round' : r < 0.65 ? 'upper' : r < 0.85 ? 'kick' : 'punch') : (r < 0.6 ? 'punch' : r < 0.85 ? 'kick' : 'upper');
          begin(m, 'atk', a); m.vx = 0; return;
        }
        if (m.team === 'hero' && ad > 110 && ad < 320 && m.cd <= 0 && Math.random() < 0.4) { begin(m, 'atk', 'throw'); m.cd = 2.5; m.vx = 0; return; }
        if (ad > 60 && ad < 160 && Math.random() < 0.18 && !blocked(tg.x, tg.y)) { jumpTo(m, tg.x - m.dir * 14, tg.y, false); m.flykick = 1; return; }
        m.st = 'run'; m.vx = m.dir * speed; return;
      }
      // he is on another ledge: jump there, or on to a ledge that gets closer
      var dest = tg.on;
      if (dest && reachable(m, dest, tg.x) && !blocked(tg.x, dest.y)) { jumpTo(m, Math.max(dest.x0 + 6, Math.min(dest.x1 - 6, tg.x - m.dir * 24)), dest.y, Math.random() < 0.35); return; }
      var best = null, bs = 1e9;
      plats.forEach(function (p) {
        if (p === m.on) return;
        var tx = Math.max(p.x0 + 6, Math.min(p.x1 - 6, tg.x));
        if (!reachable(m, p, tx) || blocked(tx, p.y)) return;
        var sc = Math.hypot(tx - tg.x, p.y - tg.y);
        if (sc < bs) { bs = sc; best = [tx, p.y]; }
      });
      if (best && bs < Math.hypot(dx, dy)) { jumpTo(m, best[0], best[1], Math.random() < 0.3); return; }
      // nothing near: walk to the edge and drop
      m.st = 'run'; m.vx = m.dir * speed;
      if (m.x <= m.on.x0 + 2 || m.x >= m.on.x1 - 2) { m.on = null; begin(m, 'air'); m.vx = m.dir * 120; }
      if (Math.random() < 0.05) { begin(m, 'taunt'); m.vx = 0; }
    }
    function step(m, dt) {
      m.t += dt; m.flash = Math.max(0, m.flash - dt); m.inv = Math.max(0, (m.inv || 0) - dt); m.ph += dt * (m.st === 'run' ? 14 : 3);
      think(m, dt);
      if (m.st === 'atk') {
        var A = ATK[m.atk];
        if (!A.air) m.vx = A.spin ? m.dir * 30 : 0;
        if (A.star && !m.done && m.t > A.hit) { m.done = 1; stars.push({ owner: m, x: m.x + m.dir * 14, y: m.y - 32, vx: m.dir * 520, t: 1.2, a: 0 }); }
        if (!A.star && !m.done && m.t >= A.hit && m.t <= A.hit + A.act) {
          foes(m).forEach(function (q) { if (m.done) return; var f = (q.x - m.x) * m.dir; if (f > -6 && f < A.reach + 8 && Math.abs(q.y - m.y) < 34) { m.done = 1; hurt(m, q, A); } });
        }
        if (m.atk === 'slash' && m.t > A.hit - 0.02 && m.t < A.hit + A.act + 0.05) m.trail.push(1);
        if (m.t > A.end && !A.air) begin(m, 'idle');
      } else if (m.st === 'hit' && m.t > 0.25) begin(m, 'idle');
      else if (m.st === 'land' && m.t > 0.12) begin(m, 'idle');
      else if (m.st === 'taunt' && m.t > 0.8) begin(m, 'idle');
      else if (m.st === 'block' && m.t > 0.35) begin(m, 'idle');
      else if (m.st === 'cling') { m.vy = 60; if (m.t > 0.22) { m.vx = -m.wall * 300; m.vy = -560; m.dir = -m.wall; begin(m, 'air'); m.flip = 1; m.spin = 0; } }
      // flying kick on the way down
      if (m.st === 'air' && m.flykick && m.vy > -100) { m.flykick = 0; begin(m, 'atk', 'flykick'); }
      var ox = m.x, oy = m.y;
      if (!m.on) {
        if (m.st !== 'cling') m.vy += G * dt;
        m.x += m.vx * dt; m.y += m.vy * dt;
        if (m.flip) m.spin += dt * 14;
        // landing on a ledge (only from above)
        if (m.vy >= 0) for (var i = 0; i < plats.length; i++) {
          var p = plats[i];
          if (m.x >= p.x0 - 3 && m.x <= p.x1 + 3 && oy <= p.y + 0.5 && m.y >= p.y) {
            m.y = p.y; m.on = p; m.vy = 0; m.vx *= 0.2; m.flip = 0; m.spin = 0; dust(m.x, p.y, 5);
            if (m.st === 'tumble' || m.st === 'hit') begin(m, 'land'); else if (m.st === 'air' || (m.st === 'atk' && ATK[m.atk].air)) begin(m, 'land');
            break;
          }
        }
        // the side of a tall box: cling and kick off it
        if (!m.on && m.st === 'air' && Math.abs(m.vx) > 160 && now - (m.clungAt || -9) > 1.2) for (var w = 0; w < walls.length; w++) {
          var wl = walls[w];
          if (m.y - 20 > wl.y0 && m.y - 20 < wl.y1 && ((ox <= wl.x && m.x > wl.x && wl.side === -1) || (ox >= wl.x && m.x < wl.x && wl.side === 1))) {
            m.x = wl.x - wl.side * -2 * (wl.side === -1 ? 1 : -1); m.x = wl.side === -1 ? wl.x - 1 : wl.x + 1; m.vx = 0; m.wall = wl.side === -1 ? 1 : -1; m.clungAt = now; begin(m, 'cling'); break;
          }
        }
        if (m.y > H + 80) { men.splice(men.indexOf(m), 1); return; }
      } else {
        m.x += m.vx * dt;
        if (m.x < m.on.x0 - 2 || m.x > m.on.x1 + 2) { m.on = null; if (m.st === 'run' || m.st === 'idle') begin(m, 'air'); }
        if (m.st !== 'run' && m.st !== 'atk') m.vx *= Math.pow(0.001, dt);
      }
      m.x = Math.max(4, Math.min(W - 4, m.x));
    }

    // ---- drawing
    function pose(m) {
      if (m.st === 'run') { var s = Math.sin(m.ph); return { L: 28, hy: 20 + Math.abs(s) * 1.5, sF: 40 - s * 50, eF: 90, sB: 40 + s * 50, eB: 90, hF: 20 + 45 * s, kF: -30 - 50 * Math.max(0, -s), hB: 20 - 45 * s, kB: -30 - 50 * Math.max(0, s) }; }
      if (m.st === 'atk') { var A = ATK[m.atk], k = m.t < A.hit ? ease(m.t / A.hit) * 0.6 : m.t < A.hit + A.act ? 1 : 1 - ease((m.t - A.hit - A.act) / (A.end - A.hit - A.act)); return mix(P.idle, P[A.pose], k); }
      if (m.st === 'air') return m.vy < 0 ? P.air : mix(P.air, P.fall, Math.min(1, m.vy / 900));
      if (m.st === 'tumble') return P.fall;
      if (m.st === 'block') return { L: 0, hy: 18, sF: 70, eF: 140, sB: 60, eB: 145, hF: 30, kF: -50, hB: -20, kB: -30 };
      return P[m.st] || mix(P.idle, P.idle, 0);
    }
    function joints(m, p) {
      var d = m.dir, hip = { x: m.x, y: m.y - p.hy }, L = rad(p.L);
      function pt(o, a, l) { return { x: o.x + Math.sin(rad(a)) * l * d, y: o.y + Math.cos(rad(a)) * l }; }
      var neck = { x: hip.x + Math.sin(L) * 15 * d, y: hip.y - Math.cos(L) * 15 };
      var head = { x: neck.x + Math.sin(L) * 6 * d, y: neck.y - Math.cos(L) * 6 };
      var sh = { x: hip.x + Math.sin(L) * 13 * d, y: hip.y - Math.cos(L) * 13 };
      var eF = pt(sh, p.sF, 8), hF = pt(eF, p.sF + p.eF, 8), eB = pt(sh, p.sB, 8), hB = pt(eB, p.sB + p.eB, 8);
      var kF = pt(hip, p.hF, 10), fF = pt(kF, p.hF + p.kF, 10), kB = pt(hip, p.hB, 10), fB = pt(kB, p.hB + p.kB, 10);
      return { hip: hip, neck: neck, head: head, eF: eF, hF: hF, eB: eB, hB: hB, kF: kF, fF: fF, kB: kB, fB: fB };
    }
    function drawMan(J, team, flash, rotC, ang, alpha) {
      var dk = dark(), body = team === 'hero' ? '#dc2626' : '#0b0b0f', edge = dk ? 'rgba(255,255,255,.55)' : 'rgba(255,255,255,.8)';
      if (flash) body = '#ffffff';
      ctx.save(); if (alpha) ctx.globalAlpha = alpha;
      if (ang) { ctx.translate(rotC.x, rotC.y); ctx.rotate(ang); ctx.translate(-rotC.x, -rotC.y); }
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      var lines = [['neck', 'hip'], ['neck', 'eB'], ['eB', 'hB'], ['hip', 'kB'], ['kB', 'fB'], ['hip', 'kF'], ['kF', 'fF'], ['neck', 'eF'], ['eF', 'hF']];
      [[edge, 5.2], [body, 3.2]].forEach(function (s) {
        ctx.strokeStyle = s[0]; ctx.lineWidth = s[1];
        lines.forEach(function (l) { ctx.beginPath(); ctx.moveTo(J[l[0]].x, J[l[0]].y); ctx.lineTo(J[l[1]].x, J[l[1]].y); ctx.stroke(); });
        ctx.fillStyle = s[0]; ctx.beginPath(); ctx.arc(J.head.x, J.head.y, s[1] === 3.2 ? 5.6 : 6.6, 0, 7); ctx.fill();
      });
      ctx.restore();
    }
    function drawFighter(m) {
      var p = pose(m), J = joints(m, p), ang = m.flip ? -m.spin * m.dir : 0;
      if (m.st === 'atk' && ATK[m.atk].spin) ang = (m.t / ATK[m.atk].end) * Math.PI * 2 * m.dir * 0.25;
      var c = { x: m.x, y: m.y - 22 };
      // speed lines when running, afterimages in the air
      if (m.st === 'run' && Math.abs(m.vx) > 200) { ctx.strokeStyle = 'rgba(148,163,184,.5)'; ctx.lineWidth = 1; for (var q = 0; q < 3; q++) { var ly = m.y - 10 - q * 12; ctx.beginPath(); ctx.moveTo(m.x - m.dir * 14, ly); ctx.lineTo(m.x - m.dir * (30 + q * 6), ly); ctx.stroke(); } }
      if (m.flip && m.team === 'hero') drawMan(joints({ x: m.x - m.vx * 0.03, y: m.y - m.vy * 0.03, dir: m.dir }, p), m.team, false, { x: c.x - m.vx * 0.03, y: c.y - m.vy * 0.03 }, ang + 0.6 * m.dir, 0.25);
      drawMan(J, m.team, m.flash > 0, c, ang);
      if (m.team === 'hero') {
        // the ninja's headband: two tails that flutter behind
        ctx.save(); if (ang) { ctx.translate(c.x, c.y); ctx.rotate(ang); ctx.translate(-c.x, -c.y); }
        var hx = J.head.x - m.dir * 5, hy = J.head.y - 1, wv = Math.sin(now * 18 + m.x * 0.05);
        ctx.strokeStyle = '#111827'; ctx.lineWidth = 2.4; ctx.beginPath(); ctx.moveTo(J.head.x - 5.6, J.head.y - 1.5); ctx.lineTo(J.head.x + 5.6, J.head.y - 1.5); ctx.stroke();
        ctx.lineWidth = 1.8; ctx.beginPath(); ctx.moveTo(hx, hy); ctx.quadraticCurveTo(hx - m.dir * 8, hy + wv * 3, hx - m.dir * 16, hy + 2 + wv * 5); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(hx, hy); ctx.quadraticCurveTo(hx - m.dir * 7, hy + 4 + wv * 2, hx - m.dir * 13, hy + 7 + wv * 4); ctx.stroke();
        // the sword: on the back, in the hand when slashing
        ctx.strokeStyle = '#e5e7eb'; ctx.lineWidth = 1.6;
        if (m.st === 'atk' && m.atk === 'slash') { var h = J.hF, a2 = rad(p.sF + p.eF) * m.dir; ctx.beginPath(); ctx.moveTo(h.x, h.y); ctx.lineTo(h.x + Math.sin(rad(p.sF + p.eF + 20)) * 22 * m.dir, h.y + Math.cos(rad(p.sF + p.eF + 20)) * 22); ctx.stroke(); }
        else { ctx.beginPath(); ctx.moveTo(J.neck.x - m.dir * 6, J.neck.y - 6); ctx.lineTo(J.hip.x + m.dir * 6, J.hip.y + 4); ctx.stroke(); }
        ctx.restore();
      }
      // the white crescent of a sword cut
      if (m.st === 'atk' && m.atk === 'slash' && m.t > 0.04 && m.t < 0.2) {
        ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 2.5; ctx.beginPath();
        var cx2 = m.x + m.dir * 14, cy2 = m.y - 28, st0 = m.dir > 0 ? -1.4 : Math.PI + 1.4, en0 = m.dir > 0 ? 1.0 : Math.PI - 1.0;
        ctx.arc(cx2, cy2, 22, Math.min(st0, en0), Math.max(st0, en0)); ctx.stroke();
        ctx.strokeStyle = 'rgba(239,68,68,.6)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(cx2, cy2, 19, Math.min(st0, en0), Math.max(st0, en0)); ctx.stroke();
      }
      if (m.st === 'cling') { ctx.fillStyle = 'rgba(148,163,184,.6)'; ctx.fillRect(m.x - 1, m.y - 6, 2, 6); }
      if (m.team === 'hero' && m.hp < m.max) { ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(m.x - 12, m.y - 52, 24, 3); ctx.fillStyle = '#22c55e'; ctx.fillRect(m.x - 12, m.y - 52, 24 * m.hp / m.max, 3); }
    }
    function drawRag(r) {
      var a = r.t > 3 ? Math.max(0, 1 - (r.t - 3) / 1) : 1, J = {}; for (var k in r.pts) J[k] = r.pts[k];
      drawMan(J, r.team, false, null, 0, a);
    }
    function draw() {
      ctx.clearRect(0, 0, W, H);
      decals.forEach(function (d) { ctx.globalAlpha = Math.min(1, d.t / 3) * 0.85; ctx.fillStyle = '#991b1b'; ctx.beginPath(); ctx.ellipse(d.x, d.y - 0.5, d.r * 1.8, d.r * 0.55, 0, 0, 7); ctx.fill(); }); ctx.globalAlpha = 1;
      rags.forEach(drawRag);
      men.forEach(drawFighter);
      stars.forEach(function (s) { ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(s.a); ctx.fillStyle = '#cbd5e1'; ctx.strokeStyle = '#111'; ctx.lineWidth = 0.8; ctx.beginPath(); for (var i = 0; i < 8; i++) { var r = i % 2 ? 2 : 6, an = i * Math.PI / 4; ctx.lineTo(Math.cos(an) * r, Math.sin(an) * r); } ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore(); });
      fx.forEach(function (p) {
        var a = p.t / p.T; ctx.globalAlpha = Math.max(0, Math.min(1, a));
        if (p.k === 'blood') { ctx.fillStyle = '#dc2626'; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill(); }
        else if (p.k === 'spark') { ctx.fillStyle = p.c; ctx.fillRect(p.x - 1, p.y - 1, 2.2, 2.2); }
        else if (p.k === 'smoke' || p.k === 'dust') { ctx.fillStyle = p.k === 'smoke' ? p.c : 'rgba(160,150,140,.7)'; ctx.globalAlpha *= 0.6; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (1.6 - a), 0, 7); ctx.fill(); }
        else if (p.k === 'ring') { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x, p.y, 4 + (1 - a) * 14, 0, 7); ctx.stroke(); }
        else if (p.k === 'star') { ctx.strokeStyle = '#fde047'; ctx.lineWidth = 2; for (var i = 0; i < 8; i++) { var an = i * Math.PI / 4; ctx.beginPath(); ctx.moveTo(p.x + Math.cos(an) * 3, p.y + Math.sin(an) * 3); ctx.lineTo(p.x + Math.cos(an) * (i % 2 ? 9 : 14), p.y + Math.sin(an) * (i % 2 ? 9 : 14)); ctx.stroke(); } }
      });
      ctx.globalAlpha = 1;
    }
    function tick(t) {
      if (!on) return;
      raf = requestAnimationFrame(tick);
      var dt = Math.min(0.05, (t - last) / 1000 || 0); last = t; acc += dt;
      if (acc < 1 / 45) return;          // about 45 frames a second is plenty
      dt = acc; acc = 0; now += dt;
      scanT -= dt; if (scanT <= 0) { scanT = 0.5; scan(); }
      // keep the cast: one ninja, a few black stickmen (one in calm)
      spawnT -= dt;
      var want = mode === 'calm' ? 1 : 4;
      if (!men.some(function (m) { return m.team === 'hero'; }) && !rags.some(function (r) { return r.team === 'hero' && r.t < 1.5; })) spawn('hero');
      if (spawnT <= 0 && men.filter(function (m) { return m.team === 'enemy'; }).length < want) { spawnT = 0.9; spawn('enemy'); }
      men.slice().forEach(function (m) { step(m, dt); });
      rags.forEach(function (r) { stepRag(r, dt); }); rags = rags.filter(function (r) { return r.t < 4; });
      stars = stars.filter(function (s) {
        s.x += s.vx * dt; s.a += dt * 20; s.t -= dt;
        var hitM = foes(s.owner).filter(function (q) { return Math.abs(q.x - s.x) < 8 && s.y > q.y - 46 && s.y < q.y; })[0];
        if (hitM) { hurt(s.owner, hitM, ATK.throw); return false; }
        return s.t > 0 && s.x > -10 && s.x < W + 10;
      });
      fx.forEach(function (p) {
        p.t -= dt; p.x += p.vx * dt; p.y += p.vy * dt;
        if (p.k === 'blood') {
          p.vy += G * 0.6 * dt;
          var q = platAt(p.x, p.y, 3);
          if (q && p.vy > 0) { p.t = 0; decals.push({ x: p.x, y: q.y, on: q, r: p.r * 1.4, t: 9 }); }
        }
        if (p.k === 'spark') p.vy += 900 * dt;
      });
      fx = fx.filter(function (p) { return p.t > 0; });
      decals.forEach(function (d) { d.t -= dt; }); decals = decals.filter(function (d) { return d.t > 0; }); if (decals.length > 160) decals.splice(0, decals.length - 160);
      draw();
    }
    function onMove(e) { mx = e.clientX; my = e.clientY; mouseT = now; }
    function onLeave() { mx = my = -999; }
    function onScroll() { if (on) scan(); }
    function onResize() { size(); if (on) scan(); }
    var api = {
      start: function () { if (on) return; on = true; cv.style.display = ''; size(); scan(); last = performance.now(); raf = requestAnimationFrame(tick); },
      stop: function () { on = false; cancelAnimationFrame(raf); ctx.clearRect(0, 0, W, H); cv.style.display = 'none'; men = []; rags = []; fx = []; decals = []; stars = []; },
      mode: function (m) { mode = m; },
      blood: function (b) { blood = !!b; if (!blood) decals = []; },
      running: function () { return on; },
      _s: function () { return { men: men, plats: plats, walls: walls, rags: rags, decals: decals }; }
    };
    document.addEventListener('mousemove', onMove, { passive: true });
    document.addEventListener('mouseleave', onLeave);
    window.addEventListener('scroll', onScroll, { passive: true, capture: true });
    window.addEventListener('resize', onResize);
    size();
    return api;
  };
})();
