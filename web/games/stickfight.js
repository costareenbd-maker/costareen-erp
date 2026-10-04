/*
 * Stick fight across the ERP (v2): one yellow ninja who can never be beaten against one blue fighter at a time.
 * The blue ones are just as skilled and find him anywhere on the page; when one is knocked out, the next leaps
 * in from the far side of the screen over the buttons. Hand to hand only: combos, kicks, grabs and throws that
 * send a body flying and bouncing off the sides of buttons and boxes. The top line of every box and button is a
 * floor; they never fly, only jump (long ninja leaps) from ledge to ledge. They keep clear of the mouse and of
 * the field being typed in. One see-through canvas over the page that never takes a click.
 */
(function () {
  'use strict';
  var G = 1900, ZONE = 95, REACH_X = 640, REACH_UP = 300;
  var SEL = '#view .card, #view tbody tr, #view .btn, #view button, #view .c3bar, #view .o_lv, #view .pill, #view .cchip, #o_cp .btn, #o_cp .cchip, #pgame';
  var HERO_D = '#c9a43a', HERO_L = '#9a7b1c', FOE = '#24346b', FOE_D = '#2c4387';

  var P = {
    idle: { L: 14, hy: 20, sF: 50, eF: 100, sB: 30, eB: 110, hF: 30, kF: -45, hB: -22, kB: -30 },
    air: { L: 10, hy: 21, sF: 70, eF: 80, sB: -40, eB: 60, hF: 70, kF: -110, hB: 30, kB: -100 },
    fall: { L: -6, hy: 21, sF: 130, eF: 20, sB: -120, eB: -20, hF: 30, kF: -40, hB: -20, kB: -30 },
    land: { L: 30, hy: 13, sF: 60, eF: 60, sB: 10, eB: 70, hF: 70, kF: -120, hB: -30, kB: -80 },
    hit: { L: -30, hy: 20, sF: -30, eF: 30, sB: -50, eB: 30, hF: 10, kF: -10, hB: -25, kB: -10 },
    hide: { L: 40, hy: 9, sF: 40, eF: 110, sB: 20, eB: 120, hF: 80, kF: -150, hB: -10, kB: -150 },
    block: { L: 0, hy: 18, sF: 70, eF: 140, sB: 60, eB: 145, hF: 30, kF: -50, hB: -20, kB: -30 },
    jab: { L: 22, hy: 20, sF: 90, eF: 0, sB: 10, eB: 120, hF: 38, kF: -40, hB: -30, kB: -20 },
    cross: { L: 28, hy: 19, sF: 20, eF: 120, sB: 92, eB: 0, hF: 42, kF: -40, hB: -36, kB: -20 },
    upper: { L: -8, hy: 22, sF: 170, eF: 15, sB: 20, eB: 100, hF: 20, kF: -20, hB: -20, kB: -15 },
    kick: { L: -24, hy: 21, sF: 40, eF: 90, sB: -30, eB: 60, hF: 100, kF: 0, hB: -10, kB: -10 },
    sweep: { L: 34, hy: 8, sF: 70, eF: 60, sB: 10, eB: 80, hF: 92, kF: 0, hB: -40, kB: 130 },
    grab: { L: 20, hy: 19, sF: 80, eF: 30, sB: 70, eB: 40, hF: 36, kF: -40, hB: -30, kB: -20 },
    toss: { L: -20, hy: 22, sF: 160, eF: 10, sB: 150, eB: 10, hF: 20, kF: -20, hB: -30, kB: -10 },
    flykick: { L: -30, hy: 21, sF: 60, eF: 70, sB: -60, eB: 50, hF: 95, kF: 0, hB: 10, kB: -90 },
    held: { L: -10, hy: 24, sF: 140, eF: 20, sB: -150, eB: 30, hF: 30, kF: -40, hB: -40, kB: -30 },
    taunt: { L: 0, hy: 21, sF: 160, eF: 30, sB: 20, eB: 120, hF: 15, kF: -10, hB: -15, kB: -10 }
  };
  function mix(a, b, t) { var o = {}; for (var k in a) o[k] = a[k] + (b[k] - a[k]) * t; return o; }
  function ease(t) { return t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t); }
  function rad(a) { return a * Math.PI / 180; }
  var ATK = {
    jab: { hit: 0.06, act: 0.08, end: 0.2, reach: 20, dmg: 9, kb: 170, up: 0, next: 'cross' },
    cross: { hit: 0.07, act: 0.08, end: 0.22, reach: 22, dmg: 10, kb: 200, up: 0, next: 'upper' },
    upper: { hit: 0.08, act: 0.1, end: 0.34, reach: 18, dmg: 16, kb: 160, up: 640, heavy: 1 },
    kick: { hit: 0.09, act: 0.09, end: 0.3, reach: 26, dmg: 14, kb: 520, up: 260, heavy: 1 },
    round: { pose: 'kick', hit: 0.14, act: 0.12, end: 0.42, reach: 28, dmg: 18, kb: 720, up: 340, heavy: 1, spin: 1 },
    sweep: { hit: 0.1, act: 0.12, end: 0.38, reach: 28, dmg: 10, kb: 120, up: 380, low: 1 },
    flykick: { hit: 0.02, act: 0.45, end: 0.5, reach: 22, dmg: 18, kb: 680, up: 300, air: 1, heavy: 1 },
    grab: { hit: 0.08, act: 0.08, end: 0.45, reach: 18, dmg: 0, grab: 1 }
  };

  window.ERP_STICK = function (o) {
    o = o || {};
    var cv = document.createElement('canvas'); cv.id = 'stickfx';
    cv.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;pointer-events:none;z-index:45';
    document.body.appendChild(cv);
    var ctx = cv.getContext('2d'), W = 0, H = 0, dpr = 1;
    var mode = o.mode || 'on', blood = o.blood !== false, on = false, raf = 0, last = 0, acc = 0;
    var plats = [], boxes = [], links = [], hero = null, foe = null, fx = [], decals = [], rags = [];
    var mx = -999, my = -999, mouseT = -99, scanT = 0, now = 0, nextFoeT = 1, kills = 0;

    function size() { dpr = window.devicePixelRatio || 1; W = window.innerWidth; H = window.innerHeight; cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
    function dark() {
      var s = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim().replace('#', '');
      if (s.length === 3) s = s.replace(/./g, '$&$&'); var n = parseInt(s, 16);
      return isNaN(n) || ((n >> 16) * 0.3 + ((n >> 8) & 255) * 0.59 + (n & 255) * 0.11) < 140;
    }

    // ---- floors (top lines) and boxes (for bodies that are thrown): read from the page
    function scan() {
      var els = document.querySelectorAll(SEL), np = [], nb = [];
      for (var i = 0; i < els.length; i++) {
        var e = els[i]; if (!e.offsetParent && e.id !== 'pgame') continue;
        var r = e.getBoundingClientRect();
        if (r.width < 26 || r.height < 14 || r.bottom < 0 || r.top > H || r.top < 4) continue;
        np.push({ el: e, x0: r.left + 2, x1: r.right - 2, y: r.top });
        nb.push({ x0: r.left, x1: r.right, y0: r.top, y1: r.bottom });
      }
      np.push({ el: null, x0: 0, x1: W, y: H - 2, ground: 1 });
      [hero, foe].forEach(function (m) {
        if (m && m.aim) { m.aim = m.aim.el ? np.filter(function (p) { return p.el === m.aim.el; })[0] || null : null; }
        if (!m || !m.on) return;
        var q = m.on.el ? np.filter(function (p) { return p.el === m.on.el; })[0] : np[np.length - 1];
        if (q) { m.x = q.x0 + (m.x - m.on.x0); m.y = q.y; m.on = q; if (m.x < q.x0 - 2 || m.x > q.x1 + 2) m.on = null; } else m.on = null;
      });
      decals.forEach(function (d) { if (!d.on) return; var q = d.on.el ? np.filter(function (p) { return p.el === d.on.el; })[0] : np[np.length - 1]; if (q) { d.x = q.x0 + (d.x - d.on.x0); d.y = q.y; d.on = q; } else d.t = 0; });
      plats = np; boxes = nb;
      // which ledge can be reached from which (one long jump)
      links = plats.map(function (a) { return plats.map(function (b, j) { return b !== a && canJump(a, b) ? j : -1; }).filter(function (j) { return j >= 0; }); });
    }
    function spot(a, b, fromX) { return Math.max(b.x0 + 8, Math.min(b.x1 - 8, fromX)); }
    function canJump(a, b) {
      var gap = b.x0 > a.x1 ? b.x0 - a.x1 : a.x0 > b.x1 ? a.x0 - b.x1 : 0, rise = a.y - b.y;
      return gap < REACH_X && rise < REACH_UP && b.x1 - b.x0 > 20;
    }
    function idx(p) { return plats.indexOf(p); }
    function route(from, to) {   // the next ledge on the shortest chain of jumps
      var a = idx(from), b = idx(to); if (a < 0 || b < 0) return null; if (a === b) return to;
      var prev = {}, q = [a]; prev[a] = -1;
      while (q.length) { var c = q.shift(); if (c === b) break; (links[c] || []).forEach(function (n) { if (prev[n] === undefined) { prev[n] = c; q.push(n); } }); }
      if (prev[b] === undefined) return null;
      var n = b; while (prev[n] !== a && prev[n] !== -1) n = prev[n];
      return plats[n];
    }
    function nearBlock(x, y) {
      if (now - mouseT < 6 && Math.hypot(x - mx, y - 22 - my) < ZONE + 16) return true;
      var a = document.activeElement;
      if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) { var r = a.getBoundingClientRect(); if (x > r.left - 40 && x < r.right + 40 && y > r.top - 10 && y < r.bottom + 70) return true; }
      return false;
    }

    // ---- people
    function make(team, x, y, p) {
      return { team: team, x: x, y: y, vx: 0, vy: 0, dir: 1, on: p || null, st: p ? 'idle' : 'air', t: 0, atk: null, done: 0, queue: null,
        hp: team === 'hero' ? 100 : 70, cd: 0, think: 0.3, ph: 0, flash: 0, spin: 0, flip: 0, plan: null, hideT: 0, roamT: 2, ambush: 0, lastLand: 0 };
    }
    function smoke(x, y, c) { for (var i = 0; i < 12; i++) fx.push({ k: 'smoke', x: x, y: y, vx: (Math.random() - 0.5) * 90, vy: -Math.random() * 70, t: 0.6, T: 0.6, r: 4 + Math.random() * 5, c: c }); }
    function spark(x, y, n, c) { for (var i = 0; i < n; i++) fx.push({ k: 'spark', x: x, y: y, vx: (Math.random() - 0.5) * 380, vy: (Math.random() - 0.8) * 320, t: 0.3, T: 0.3, c: c || '#fff' }); }
    function dust(x, y, n) { for (var i = 0; i < n; i++) fx.push({ k: 'dust', x: x + (Math.random() - 0.5) * 10, y: y - 1, vx: (Math.random() - 0.5) * 80, vy: -Math.random() * 30, t: 0.45, T: 0.45, r: 2 + Math.random() * 2.5 }); }
    function bleed(x, y, dir, n) {
      if (Math.random() < 0.5) sweat(x, y, dir, 1 + Math.floor(Math.random() * 2));
      if (!blood) { spark(x, y, n, '#fde68a'); return; }
      n = Math.max(1, Math.round(n / 3));
      for (var i = 0; i < n; i++) fx.push({ k: 'blood', x: x, y: y, vx: dir * (60 + Math.random() * 280) + (Math.random() - 0.5) * 90, vy: -80 - Math.random() * 280, t: 1.4, T: 1.4, r: 1 + Math.random() * 1.9 });
    }
    function sweat(x, y, dir, n) { for (var i = 0; i < n; i++) fx.push({ k: 'sweat', x: x + (Math.random() - 0.5) * 6, y: y - 6, vx: dir * (30 + Math.random() * 90), vy: -60 - Math.random() * 120, t: 0.7, T: 0.7, r: 0.9 }); }
    function begin(m, st, atk) { m.st = st; m.t = 0; m.done = 0; m.atk = atk || null; m.queue = null; }
    function enemyOf(m) { return m === hero ? foe : hero; }
    function hurt(a, b, A) {
      if (!b || b.st === 'dead' || b.st === 'flung' || b.st === 'held') return;
      var dir = b.x >= a.x ? 1 : -1;
      // the ninja reads almost everything: he blocks or slips away and hits back
      if (b === hero && Math.random() < 0.9) {
        if (Math.random() < 0.5 && hero.on) { spark(b.x - dir * 6, b.y - 28, 6); begin(hero, 'block'); hero.counter = 1; }
        else { jumpTo(hero, a.x - dir * 40, a.on ? a.on.y : hero.y, true, a.on); hero.ambush = 1; }
        return;
      }
      if (b.st === 'block' && b.dir === -dir) { spark(b.x - dir * 6, b.y - 28, 6); b.vx = dir * A.kb * 0.3; return; }
      if (b !== hero) b.hp -= A.dmg;
      b.flash = 0.1;
      bleed(b.x, b.y - 30, dir, A.heavy ? 14 : 7); spark(b.x - dir * 4, b.y - 30, 8);
      fx.push({ k: 'ring', x: b.x - dir * 4, y: b.y - 30, t: 0.2, T: 0.2 });
      if (A.heavy) fx.push({ k: 'star', x: b.x - dir * 4, y: b.y - 30, t: 0.12, T: 0.12 });
      if (b.hp <= 0) { fling(b, dir * (A.kb + 200), -(A.up + 300)); b.dying = 1; return; }
      if (A.up >= 250) fling(b, dir * A.kb, -A.up);
      else { b.vx = dir * A.kb; begin(b, 'hit'); }
    }
    // a body sent flying: it spins, bounces off the sides and bottoms of buttons and boxes, and lands on a top
    function fling(m, vx, vy) { m.aim = null; m.on = null; m.vx = vx; m.vy = vy; begin(m, 'flung'); m.spin = 0; }
    function bounce(m, ox, oy) {
      for (var i = 0; i < boxes.length; i++) {
        var b = boxes[i];
        var inNow = m.x > b.x0 && m.x < b.x1 && m.y - 20 > b.y0 && m.y - 20 < b.y1, inBefore = ox > b.x0 && ox < b.x1 && oy - 20 > b.y0 && oy - 20 < b.y1;
        if (!inNow || inBefore) continue;
        var spd = Math.hypot(m.vx, m.vy);
        if (oy - 20 <= b.y0) continue;                         // came from above: the landing check deals with it
        if (ox <= b.x0) { m.x = b.x0 - 1; m.vx = -Math.abs(m.vx) * 0.55; }
        else if (ox >= b.x1) { m.x = b.x1 + 1; m.vx = Math.abs(m.vx) * 0.55; }
        else { m.y = b.y1 + 21; m.vy = Math.abs(m.vy) * 0.5; }
        if (spd > 300) {
          spark(m.x, m.y - 20, 10); fx.push({ k: 'ring', x: m.x, y: m.y - 20, t: 0.2, T: 0.2 }); fx.push({ k: 'dent', x: m.x, y: m.y - 20, t: 0.5, T: 0.5 });
          if (m !== hero && m.st !== 'dead') { m.hp -= 6; bleed(m.x, m.y - 20, m.vx > 0 ? 1 : -1, 5); if (m.hp <= 0) m.dying = 1; }
        }
        return;
      }
    }
    function die(m) {
      var J = joints(m, P.fall), pts = {}, vx = m.vx, vy = m.vy;
      ['head', 'neck', 'hip', 'eF', 'hF', 'eB', 'hB', 'kF', 'fF', 'kB', 'fB'].forEach(function (k) { var p = J[k]; pts[k] = { x: p.x, y: p.y, px: p.x - vx / 50 + (Math.random() - 0.5) * 3, py: p.y - vy / 50 + (Math.random() - 0.5) * 3 }; });
      var sticks = [['head', 'neck'], ['neck', 'hip'], ['neck', 'eF'], ['eF', 'hF'], ['neck', 'eB'], ['eB', 'hB'], ['hip', 'kF'], ['kF', 'fF'], ['hip', 'kB'], ['kB', 'fB'], ['head', 'hip']];
      sticks = sticks.map(function (s) { var a = pts[s[0]], b = pts[s[1]]; return [s[0], s[1], Math.hypot(a.x - b.x, a.y - b.y)]; });
      rags.push({ team: m.team, pts: pts, sticks: sticks, t: 0, bleedT: 0 });
      if (m === foe) { foe = null; kills++; nextFoeT = 1.6 + Math.random(); }
      if (hero) { hero.plan = null; hero.roamT = 0.8; }
    }
    function stepRag(r, dt) {
      r.t += dt;
      for (var k in r.pts) {
        var p = r.pts[k], vx = (p.x - p.px) * 0.99, vy = (p.y - p.py) * 0.99, ox = p.x, oy = p.y;
        p.px = p.x; p.py = p.y; p.x += vx; p.y += vy + G * dt * dt;
        for (var i = 0; i < plats.length; i++) { var q = plats[i]; if (p.x >= q.x0 && p.x <= q.x1 && oy <= q.y + 0.5 && p.y > q.y) { p.y = q.y; p.py = p.y + (p.y - oy) * 0.3; p.px = p.x - vx * 0.6; break; } }
        for (var j = 0; j < boxes.length; j++) { var b = boxes[j]; if (p.x > b.x0 && p.x < b.x1 && p.y > b.y0 && p.y < b.y1 && !(ox > b.x0 && ox < b.x1 && oy > b.y0 && oy < b.y1) && oy > b.y0) { if (ox <= b.x0) { p.x = b.x0; p.px = p.x + vx * 0.5; } else if (ox >= b.x1) { p.x = b.x1; p.px = p.x + vx * 0.5; } else { p.y = b.y1; p.py = p.y + vy * 0.4; } } }
        if (p.x < 0) { p.x = 0; p.px = vx * 0.5; } if (p.x > W) { p.x = W; p.px = W + vx * 0.5; } if (p.y > H - 2) { p.y = H - 2; p.py = p.y + vy * 0.3; }
      }
      for (var it = 0; it < 3; it++) r.sticks.forEach(function (s) { var a = r.pts[s[0]], b = r.pts[s[1]], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 0.01, df = (d - s[2]) / d * 0.5; a.x += dx * df; a.y += dy * df; b.x -= dx * df; b.y -= dy * df; });
      if (blood && r.t < 0.6) { r.bleedT -= dt; if (r.bleedT <= 0) { r.bleedT = 0.18; var n = r.pts.neck; fx.push({ k: 'blood', x: n.x, y: n.y, vx: (Math.random() - 0.5) * 70, vy: -50, t: 1.2, T: 1.2, r: 1.3 }); } }
    }

    // ---- moving
    function jumpTo(m, x, y, flip, plat) {
      var dx = x - m.x, rise = m.y - y, T = Math.max(0.38, Math.min(1.15, 0.32 + Math.abs(dx) / 820 + Math.max(0, rise) / 900));
      m.vx = dx / T; m.vy = -(rise + 0.5 * G * T * T) / T; m.on = null; m.dir = dx >= 0 ? 1 : -1;
      begin(m, 'air'); m.flip = flip || Math.abs(dx) > 260 ? 1 : 0; m.spin = 0; m.aim = plat || null; dust(m.x, m.y, 4);
    }
    function leapToward(m, p, tx) { jumpTo(m, spot(m.on, p, tx), p.y, Math.random() < 0.5, p); }
    function escape(m) {
      var away = m.x >= mx ? 1 : -1, best = null, bs = -1e9;
      plats.forEach(function (p) {
        if (p === m.on || !m.on || !canJump(m.on, p)) return;
        var tx = spot(m.on, p, m.x + away * 220); if (nearBlock(tx, p.y)) return;
        var sc = (tx - m.x) * away - Math.abs(m.y - p.y) * 0.3;
        if (sc > bs) { bs = sc; best = p; }
      });
      if (best) leapToward(m, best, m.x + away * 220); else { m.st = 'run'; m.vx = away * 340; m.dir = away; }
    }
    function roam(m) {   // go somewhere else on the screen, often far
      if (!m.on) return;
      var cand = (links[idx(m.on)] || []).map(function (j) { return plats[j]; }).filter(function (p) { return !p.ground || Math.random() < 0.15; });
      if (!cand.length) return;
      cand.sort(function (a, b) { return Math.abs((b.x0 + b.x1) / 2 - m.x) - Math.abs((a.x0 + a.x1) / 2 - m.x); });
      var p = cand[Math.floor(Math.random() * Math.min(5, cand.length))];
      if (nearBlock((p.x0 + p.x1) / 2, p.y)) return;
      leapToward(m, p, p.x0 + Math.random() * (p.x1 - p.x0));
    }

    // ---- minds
    function attackChoice(m) {
      var r = Math.random();
      if (m === hero) return r < 0.22 ? 'grab' : r < 0.42 ? 'jab' : r < 0.6 ? 'round' : r < 0.78 ? 'kick' : r < 0.9 ? 'upper' : 'sweep';
      return r < 0.12 ? 'grab' : r < 0.45 ? 'jab' : r < 0.65 ? 'kick' : r < 0.78 ? 'round' : r < 0.9 ? 'sweep' : 'upper';
    }
    function think(m, dt) {
      m.think -= dt; m.cd = Math.max(0, m.cd - dt);
      if (!m.on || ['atk', 'hit', 'land', 'flung', 'held', 'dead', 'rise'].indexOf(m.st) >= 0) return;
      if (nearBlock(m.x, m.y)) { escape(m); return; }
      var tg = enemyOf(m);
      if (m.st === 'block' && m.t < 0.25) return;
      if (m.st === 'block') { begin(m, 'idle'); if (m.counter && tg && Math.abs(tg.x - m.x) < 40) { m.counter = 0; begin(m, 'atk', 'upper'); return; } }
      if (m.st === 'run' && (m.x <= m.on.x0 + 3 || m.x >= m.on.x1 - 3) && !m.plan) { m.vx = 0; m.st = 'idle'; }
      if (m.think > 0) return;
      m.think = (m === hero ? 0.1 : 0.14) + Math.random() * 0.2 * (mode === 'calm' ? 3 : 1);
      // no one to fight: wander about the whole page
      if (!tg || tg.st === 'dead' || tg.dying) { m.roamT -= 0.2; if (m.roamT <= 0) { m.roamT = 1.2 + Math.random() * 2; roam(m); } else if (Math.random() < 0.08) begin(m, 'taunt'); return; }
      var dx = tg.x - m.x, ad = Math.abs(dx), same = tg.on === m.on && Math.abs(tg.y - m.y) < 6;
      m.dir = dx >= 0 ? 1 : -1;
      // the ninja: sometimes hides at the end of a ledge and springs out at him
      if (m === hero) {
        if (m.st === 'hide') {
          m.hideT -= 0.2;
          if ((ad < 170 && tg.on) || m.hideT <= 0) { if (tg.on && !nearBlock(tg.x, tg.y)) { jumpTo(m, tg.x - m.dir * 16, tg.on.y, true, tg.on); m.ambush = 1; } else begin(m, 'idle'); }
          return;
        }
        if (!same && ad > 260 && Math.random() < 0.3 && m.on && !m.on.ground) {
          var edgeX = dx > 0 ? m.on.x1 - 6 : m.on.x0 + 6;
          m.st = 'run'; m.vx = (edgeX - m.x) * 3; m.hideAt = edgeX; m.hideT = 3 + Math.random() * 2; m.goHide = 1; return;
        }
        if (m.goHide && Math.abs(m.x - m.hideAt) < 4) { m.goHide = 0; m.vx = 0; begin(m, 'hide'); return; }
        if (m.goHide) return;
      }
      if (!tg.on) { if (m.st === 'run') { m.st = 'idle'; m.vx = 0; } return; }   // he is in the air: wait for him to land
      if (same) {
        if (ad < 28) {
          if (nearBlock(tg.x, tg.y)) { m.vx = 0; m.st = 'idle'; return; }
          if (m !== hero && Math.random() < 0.15) { begin(m, 'block'); m.vx = 0; return; }
          begin(m, 'atk', attackChoice(m)); m.vx = 0; return;
        }
        if (ad > 70 && ad < 200 && Math.random() < 0.25 && !nearBlock(tg.x, tg.y)) { jumpTo(m, tg.x - m.dir * 14, tg.y, Math.random() < 0.5, tg.on); m.flykick = 1; return; }
        m.st = 'run'; m.vx = m.dir * (m === hero ? 270 : 250) * (mode === 'calm' ? 0.6 : 1); return;
      }
      // he is somewhere else: the shortest chain of long jumps to his ledge
      var nxt = route(m.on, tg.on);
      if (nxt && nxt !== m.on && !nearBlock(spot(m.on, nxt, tg.x), nxt.y)) { leapToward(m, nxt, nxt === tg.on ? tg.x - m.dir * 26 : tg.x); if (nxt === tg.on && Math.random() < 0.4) m.flykick = 1; return; }
      // no way found: drop down towards him
      m.st = 'run'; m.vx = m.dir * 250;
      if (m.x <= m.on.x0 + 2 || m.x >= m.on.x1 - 2) { m.on = null; begin(m, 'air'); m.vx = m.dir * 160; }
    }
    function poof(m, near) {
      var c = plats.filter(function (p) { return !p.ground && p.x1 - p.x0 > 30 && !nearBlock((p.x0 + p.x1) / 2, p.y) && (!near || Math.hypot((p.x0 + p.x1) / 2 - near.x, p.y - near.y) < 260) && (!near || p !== near.on || Math.abs(near.x - p.x0) > 60 || Math.abs(near.x - p.x1) > 60); });
      if (!c.length) c = plats.filter(function (p) { return !p.ground && p.x1 - p.x0 > 30; });
      if (!c.length) return;
      var p = c[Math.floor(Math.random() * c.length)];
      smoke(m.x, m.y - 20, m === hero ? '#c9a43a' : '#2c4387');
      m.x = near && p === near.on ? (near.x - p.x0 > p.x1 - near.x ? p.x0 + 10 : p.x1 - 10) : p.x0 + Math.random() * (p.x1 - p.x0);
      m.y = p.y; m.on = p; m.vx = m.vy = 0; m.flip = 0; m.spin = 0; begin(m, 'land');
      smoke(m.x, m.y - 20, m === hero ? '#c9a43a' : '#2c4387');
      m.stuckT = 0; m.groundT = 0;
    }
    function free2(m) { return m.st === 'idle' || m.st === 'run' || m.st === 'taunt' || m.st === 'land'; }
    function watchStuck(m, dt) {
      var tg = enemyOf(m);
      if (m.on && m.on.ground && (!tg || !tg.on || !tg.on.ground)) {
        m.groundT = (m.groundT || 0) + dt;
        if (m.groundT > 0.7 && free2(m)) {   // down at the bottom of the screen: one big leap back up, or vanish and reappear
          m.groundT = 0;
          var up = plats.filter(function (p) { return !p.ground && p.x1 - p.x0 > 60 && m.y - p.y < 520 && Math.abs((p.x0 + p.x1) / 2 - m.x) < 500 && !nearBlock((p.x0 + p.x1) / 2, p.y); });
          if (up.length) { var p = up[Math.floor(Math.random() * up.length)]; jumpTo(m, p.x0 + Math.random() * (p.x1 - p.x0), p.y, true, p); } else poof(m, tg);
        }
      } else m.groundT = 0;
      if (!tg || !tg.on || !m.on || tg.on === m.on || m.st === 'hide' || m.goHide) { m.stuckT = 0; m.bestD = 1e9; return; }
      var d = Math.hypot(tg.x - m.x, tg.y - m.y);
      if (d < (m.bestD || 1e9) - 25) { m.bestD = d; m.stuckT = 0; } else m.stuckT = (m.stuckT || 0) + dt;
      if (m.stuckT > 3.5) { m.bestD = 1e9; poof(m, tg); }
    }
    function step(m, dt) {
      if (!m) return;
      watchStuck(m, dt);
      m.t += dt; m.flash = Math.max(0, m.flash - dt); m.ph += dt * (m.st === 'run' ? 15 : 3);
      think(m, dt);
      var tg = enemyOf(m);
      if (m.st === 'atk' && m.atk === 'toss') {
        m.vx = 0;
        if (m.holding) {
          var h = m.holding; h.x = m.x + m.dir * (8 - m.t * 40); h.y = m.y - 6 - Math.min(26, m.t * 140); h.dir = -m.dir;
          if (m.t > 0.28) {
            var away = Math.random() < 0.3 ? -m.dir : m.dir;
            h.x = m.x + away * 10; h.heldBy = null; fling(h, away * (700 + Math.random() * 400), -(380 + Math.random() * 360));
            if (h !== hero) { h.hp -= 12; bleed(h.x, h.y - 20, away, 6); if (h.hp <= 0) h.dying = 1; }
            spark(m.x + m.dir * 10, m.y - 34, 6); m.holding = null;
          }
        }
        if (m.t > 0.45) { begin(m, 'idle'); if (m === hero && Math.random() < 0.4) roam(m); }
      } else if (m.st === 'atk') {
        var A = ATK[m.atk];
        if (!A.air) m.vx = A.spin ? m.dir * 40 : 0;
        if (!m.done && m.t >= A.hit && m.t <= A.hit + A.act && tg && tg.st !== 'dead') {
          var f = (tg.x - m.x) * m.dir;
          if (f > -6 && f < A.reach + 8 && Math.abs(tg.y - m.y) < (A.low ? 12 : 36)) {
            m.done = 1;
            if (A.grab) {
              if (tg === hero && Math.random() < 0.95) { jumpTo(hero, m.x - hero.dir * 50, m.on ? m.on.y : hero.y, true, m.on); hero.ambush = 1; }
              else { begin(m, 'atk', 'toss'); begin(tg, 'held'); m.holding = tg; tg.heldBy = m; tg.on = null; }
            } else hurt(m, tg, A);
          }
        }
        if (m.t > A.end && !A.air) {
          if (m.done && A.next && Math.random() < (m === hero ? 0.85 : 0.6)) begin(m, 'atk', A.next);
          else { begin(m, 'idle'); if (m === hero && m.on && Math.random() < 0.3) roam(m); }
        }
      } else if (m.st === 'hit' && m.t > 0.22) begin(m, 'idle');
      else if (m.st === 'land' && m.t > 0.14) { begin(m, m.down ? 'rise' : 'idle'); }
      else if (m.st === 'rise' && m.t > 0.35) { m.down = 0; begin(m, 'idle'); }
      else if (m.st === 'taunt' && m.t > 0.8) begin(m, 'idle');
      if (m.st === 'air' && m.flykick && m.vy > -160) { m.flykick = 0; begin(m, 'atk', 'flykick'); }
      if (m.st === 'air' && m.ambush && m.vy > -160 && tg && Math.abs(tg.x - m.x) < 60) { m.ambush = 0; begin(m, 'atk', 'flykick'); }
      if (m.st === 'held') { if (!m.heldBy || m.heldBy.holding !== m || m.heldBy.st !== 'atk') { m.heldBy = null; fling(m, 0, -120); } else return; }
      var ox = m.x, oy = m.y;
      if (!m.on) {
        m.vy += G * dt; m.x += m.vx * dt; m.y += m.vy * dt;
        if (m.flip || m.st === 'flung') m.spin += dt * (m.st === 'flung' ? 16 : 13);
        if (m.st === 'flung') bounce(m, ox, oy);
        if (m.vy >= 0) for (var i = 0; i < plats.length; i++) {
          var p = plats[i];
          if (m.aim && m.st !== 'flung' && p !== m.aim && !p.ground) continue;   // a planned jump lands where it was aimed
          if (m.x >= p.x0 - 3 && m.x <= p.x1 + 3 && oy <= p.y + 0.5 && m.y >= p.y) {
            if (m.st === 'flung' && m.vy > 500 && !p.ground) { m.y = p.y; m.vy = -m.vy * 0.32; m.vx *= 0.7; dust(m.x, p.y, 6); spark(m.x, p.y - 4, 4); if (m !== hero) m.hp -= 4; break; }   // bounces on the top
            m.aim = null; m.y = p.y; m.on = p; m.x = Math.max(p.x0, Math.min(p.x1, m.x)); m.vy = 0; m.vx *= 0.2; m.flip = 0; m.spin = 0; m.lastLand = now; dust(m.x, p.y, 6);
            if (m.st === 'flung') { m.down = 1; begin(m, 'land'); } else begin(m, 'land');
            break;
          }
        }
        if (m.x < 4 || m.x > W - 4) { m.vx = -m.vx * 0.5; m.x = Math.max(4, Math.min(W - 4, m.x)); }
        if (m.y > H + 60) { m.y = H - 2; m.on = plats[plats.length - 1]; m.vy = 0; begin(m, 'land'); }
      } else {
        m.x += m.vx * dt;
        if (m.x < m.on.x0 - 2 || m.x > m.on.x1 + 2) { m.on = null; if (m.st === 'run' || m.st === 'idle' || m.st === 'hit') begin(m, 'air'); }
        if (m.st !== 'run' && m.st !== 'atk') m.vx *= Math.pow(0.002, dt);
      }
      if (m.dying && m.st !== 'held') { m.dying = 0; die(m); }
    }

    // ---- drawing (no outline: the ninja yellow, the others blue)
    function pose(m) {
      if (m.st === 'run') { var s = Math.sin(m.ph); return { L: 28, hy: 20 + Math.abs(s) * 1.5, sF: 40 - s * 50, eF: 90, sB: 40 + s * 50, eB: 90, hF: 20 + 45 * s, kF: -30 - 50 * Math.max(0, -s), hB: 20 - 45 * s, kB: -30 - 50 * Math.max(0, s) }; }
      if (m.st === 'atk') {
        if (m.atk === 'toss') return m.t < 0.2 ? P.grab : mix(P.grab, P.toss, ease((m.t - 0.2) / 0.1));
        var A = ATK[m.atk], tp = P[A.pose || m.atk], k = m.t < A.hit ? ease(m.t / A.hit) * 0.6 : m.t < A.hit + A.act ? 1 : 1 - ease((m.t - A.hit - A.act) / (A.end - A.hit - A.act));
        return mix(P.idle, tp, k);
      }
      if (m.st === 'air') return m.vy < 0 ? P.air : mix(P.air, P.fall, Math.min(1, m.vy / 900));
      if (m.st === 'flung') return P.fall;
      if (m.st === 'rise') return mix(P.land, P.idle, ease(m.t / 0.35));
      return P[m.st] || P.idle;
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
    function colorOf(team) { return team === 'hero' ? (dark() ? HERO_D : HERO_L) : (dark() ? FOE_D : FOE); }
    function drawMan(J, team, flash, c, ang, alpha) {
      ctx.save(); if (alpha !== undefined) ctx.globalAlpha = alpha;
      if (ang) { ctx.translate(c.x, c.y); ctx.rotate(ang); ctx.translate(-c.x, -c.y); }
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      var col = flash ? '#ffffff' : colorOf(team);
      ctx.strokeStyle = col; ctx.lineWidth = 3.4;
      [['neck', 'hip'], ['neck', 'eB'], ['eB', 'hB'], ['hip', 'kB'], ['kB', 'fB'], ['hip', 'kF'], ['kF', 'fF'], ['neck', 'eF'], ['eF', 'hF']].forEach(function (l) { ctx.beginPath(); ctx.moveTo(J[l[0]].x, J[l[0]].y); ctx.lineTo(J[l[1]].x, J[l[1]].y); ctx.stroke(); });
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(J.head.x, J.head.y, 5.8, 0, 7); ctx.fill();
      ctx.restore();
    }
    function drawFighter(m) {
      var p = pose(m), J = joints(m, p), ang = (m.flip || m.st === 'flung') ? -m.spin * m.dir : 0;
      if (m.st === 'atk' && ATK[m.atk] && ATK[m.atk].spin) ang = (m.t / ATK[m.atk].end) * Math.PI * 2 * m.dir * 0.25;
      var c = { x: m.x, y: m.y - 22 }, alpha = m.st === 'hide' ? 0.45 : 1;
      if (m.st === 'run' && Math.abs(m.vx) > 220) { ctx.strokeStyle = 'rgba(148,163,184,.5)'; ctx.lineWidth = 1; for (var q = 0; q < 3; q++) { var ly = m.y - 10 - q * 12; ctx.beginPath(); ctx.moveTo(m.x - m.dir * 14, ly); ctx.lineTo(m.x - m.dir * (32 + q * 6), ly); ctx.stroke(); } }
      // afterimages on long leaps and when thrown
      if ((m.flip && Math.abs(m.vx) > 400) || m.st === 'flung') [0.035, 0.07].forEach(function (k, i) { drawMan(joints({ x: m.x - m.vx * k, y: m.y - m.vy * k, dir: m.dir }, p), m.team, false, { x: c.x - m.vx * k, y: c.y - m.vy * k }, ang + (i + 1) * 0.5 * m.dir, 0.22 - i * 0.08); });
      drawMan(J, m.team, m.flash > 0, c, ang, alpha);
      if (m.team === 'hero') {
        ctx.save(); ctx.globalAlpha = alpha; if (ang) { ctx.translate(c.x, c.y); ctx.rotate(ang); ctx.translate(-c.x, -c.y); }
        var hx = J.head.x - m.dir * 5, hy = J.head.y - 1, wv = Math.sin(now * 18 + m.x * 0.05), band = '#8f2a2a';
        ctx.strokeStyle = band; ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(J.head.x - 5.8, J.head.y - 1.5); ctx.lineTo(J.head.x + 5.8, J.head.y - 1.5); ctx.stroke();
        ctx.lineWidth = 1.8; ctx.beginPath(); ctx.moveTo(hx, hy); ctx.quadraticCurveTo(hx - m.dir * 9, hy + wv * 3, hx - m.dir * 18, hy + 2 + wv * 5); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(hx, hy); ctx.quadraticCurveTo(hx - m.dir * 8, hy + 4 + wv * 2, hx - m.dir * 14, hy + 7 + wv * 4); ctx.stroke();
        ctx.restore();
      }
    }
    function drawRag(r) { var a = r.t > 3 ? Math.max(0, 1 - (r.t - 3)) : 1, J = {}; for (var k in r.pts) J[k] = r.pts[k]; drawMan(J, r.team, false, null, 0, a); }
    function draw() {
      ctx.clearRect(0, 0, W, H);
      decals.forEach(function (d) { ctx.globalAlpha = Math.min(1, d.t / 3) * 0.85; ctx.fillStyle = '#991b1b'; ctx.beginPath(); ctx.ellipse(d.x, d.y - 0.5, d.r * 1.8, d.r * 0.55, 0, 0, 7); ctx.fill(); }); ctx.globalAlpha = 1;
      rags.forEach(drawRag);
      if (foe) drawFighter(foe); if (hero) drawFighter(hero);
      fx.forEach(function (p) {
        var a = p.t / p.T; ctx.globalAlpha = Math.max(0, Math.min(1, a));
        if (p.k === 'blood') { ctx.fillStyle = '#b91c1c'; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill(); }
        else if (p.k === 'sweat') { ctx.fillStyle = '#bfdbfe'; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill(); }
        else if (p.k === 'spark') { ctx.fillStyle = p.c; ctx.fillRect(p.x - 1, p.y - 1, 2.2, 2.2); }
        else if (p.k === 'smoke' || p.k === 'dust') { ctx.fillStyle = p.k === 'smoke' ? p.c : 'rgba(160,150,140,.7)'; ctx.globalAlpha *= 0.6; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (1.6 - a), 0, 7); ctx.fill(); }
        else if (p.k === 'ring') { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x, p.y, 4 + (1 - a) * 15, 0, 7); ctx.stroke(); }
        else if (p.k === 'dent') { ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.lineWidth = 1; for (var i = 0; i < 6; i++) { var an = i * 1.05 + 0.3; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + Math.cos(an) * (6 + (1 - a) * 8), p.y + Math.sin(an) * (6 + (1 - a) * 8)); ctx.stroke(); } }
        else if (p.k === 'star') { ctx.strokeStyle = '#fde047'; ctx.lineWidth = 2; for (var j = 0; j < 8; j++) { var an2 = j * Math.PI / 4; ctx.beginPath(); ctx.moveTo(p.x + Math.cos(an2) * 3, p.y + Math.sin(an2) * 3); ctx.lineTo(p.x + Math.cos(an2) * (j % 2 ? 9 : 14), p.y + Math.sin(an2) * (j % 2 ? 9 : 14)); ctx.stroke(); } }
      });
      ctx.globalAlpha = 1;
    }
    function bringFoe() {
      // the next one leaps in from the far side of the screen
      var r = Math.random(), fromLeft = r < 0.4, fromTop = r >= 0.8;
      var m = make('foe', fromTop ? W * (0.15 + Math.random() * 0.7) : fromLeft ? -30 : W + 30, fromTop ? -40 : 80 + Math.random() * Math.max(40, H * 0.45), null);
      m.dir = fromLeft ? 1 : -1;
      var land = plats.filter(function (p) { return !p.ground && (fromTop ? Math.abs((p.x0 + p.x1) / 2 - m.x) < 300 : fromLeft ? p.x0 < W * 0.35 : p.x1 > W * 0.65) && !nearBlock((p.x0 + p.x1) / 2, p.y); });
      var p = land.length ? land[Math.floor(Math.random() * land.length)] : plats[plats.length - 1];
      jumpTo(m, spot(null, p, fromLeft ? p.x0 + 30 : p.x1 - 30), p.y, true, p);
      foe = m;
    }
    function tick(t) {
      if (!on) return;
      raf = requestAnimationFrame(tick);
      var dt = Math.min(0.05, (t - last) / 1000 || 0); last = t; acc += dt;
      if (acc < 1 / 45) return;
      dt = Math.min(0.05, acc) * 0.7; acc = 0; now += dt;
      scanT -= dt; if (scanT <= 0) { scanT = 0.5; scan(); }
      if (!hero) { var ok = plats.filter(function (p) { return !p.ground && p.x1 - p.x0 > 40 && !nearBlock((p.x0 + p.x1) / 2, p.y); }); var p = ok.length ? ok[Math.floor(Math.random() * ok.length)] : plats[plats.length - 1]; hero = make('hero', (p.x0 + p.x1) / 2, p.y, p); smoke(hero.x, hero.y - 20, '#fde047'); }
      if (!foe) { nextFoeT -= dt; if (nextFoeT <= 0) bringFoe(); }
      step(hero, dt); step(foe, dt);
      rags.forEach(function (r) { stepRag(r, dt); }); rags = rags.filter(function (r) { return r.t < 4; });
      fx.forEach(function (p) {
        p.t -= dt; p.x += p.vx * dt || 0; p.y += p.vy * dt || 0;
        if (p.k === 'blood') { p.vy += G * 0.6 * dt; for (var i = 0; i < plats.length; i++) { var q = plats[i]; if (p.x >= q.x0 && p.x <= q.x1 && p.y >= q.y && p.y - p.vy * dt <= q.y + 1 && p.vy > 0) { p.t = 0; decals.push({ x: p.x, y: q.y, on: q, r: p.r * 1.1, t: 5 }); break; } } }
        if (p.k === 'spark' || p.k === 'sweat') p.vy += 900 * dt;
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
      stop: function () { on = false; cancelAnimationFrame(raf); ctx.clearRect(0, 0, W, H); cv.style.display = 'none'; hero = null; foe = null; rags = []; fx = []; decals = []; nextFoeT = 1; },
      mode: function (m) { mode = m; },
      blood: function (b) { blood = !!b; if (!blood) decals = []; },
      running: function () { return on; },
      _s: function () { return { hero: hero, foe: foe, plats: plats, rags: rags, decals: decals, kills: kills, links: links }; }
    };
    document.addEventListener('mousemove', onMove, { passive: true });
    document.addEventListener('mouseleave', onLeave);
    window.addEventListener('scroll', onScroll, { passive: true, capture: true });
    window.addEventListener('resize', onResize);
    size();
    return api;
  };
})();
