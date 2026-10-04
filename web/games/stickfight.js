/*
 * Stick fight across the ERP (v2): one yellow ninja who can never be beaten against one blue fighter at a time.
 * The blue ones are just as skilled and find him anywhere on the page; when one is knocked out, the next leaps
 * in from the far side of the screen over the buttons. Hand to hand only: combos, kicks, grabs and throws that
 * send a body flying and bouncing off the sides of buttons and boxes. The top line of every box and button is a
 * floor; they never fly, only jump (long ninja leaps) from ledge to ledge. They keep clear of the mouse and of
 * the field being typed in. One see-through canvas over the page that never takes a click.
 * v7: when they meet on one ledge a written fight plays (film-style: every move has its moment and the other side's
 * answer lands on it), a bigger purple third man can drop in for two-on-one fights, slow motion on the big blows,
 * and a more natural run.
 */
(function () {
  'use strict';
  var G = 1900, ZONE = 95, REACH_X = 640, REACH_UP = 340, M = 96;   // M: about an inch kept clear at the left, right and bottom
  var SEL = '#nav button, header.topbar input, header.topbar button, header.topbar select, #view .tabs button, #view .seg button, #view input, #view select, #view .card, #view .kpi, #view .hero, #view .qa, #view .note, #view .grid > *, #view .chips > *, #view h2, #view canvas, #view tbody tr, #view .btn, #view button, #view .c3bar, #view .o_lv, #view .pill, #view .cchip, #o_cp .btn, #o_cp .cchip, #pgame';
  var HERO_D = '#c9a43a', HERO_L = '#f59e0b', FOE = '#2563eb', FOE_D = '#2c4387', THIRD = '#7c3aed', THIRD_D = '#6d4aa8';

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
    taunt: { L: 0, hy: 21, sF: 160, eF: 30, sB: 20, eB: 120, hF: 15, kF: -10, hB: -15, kB: -10 },
    guard: { L: 8, hy: 19, sF: 58, eF: 118, sB: 42, eB: 126, hF: 32, kF: -48, hB: -26, kB: -34 },
    pant: { L: 55, hy: 15, sF: 30, eF: 5, sB: 22, eB: 5, hF: 32, kF: -44, hB: -22, kB: -30 },
    wipe: { L: 10, hy: 20, sF: 150, eF: 145, sB: 20, eB: 30, hF: 18, kF: -12, hB: -16, kB: -10 },
    look: { L: 4, hy: 21, sF: 150, eF: 125, sB: 12, eB: 25, hF: 16, kF: -12, hB: -16, kB: -10 },
    aim: { L: 4, hy: 20, sF: 90, eF: 0, sB: 86, eB: 125, hF: 32, kF: -32, hB: -26, kB: -16 },
    vault: { L: 32, hy: 24, sF: 125, eF: 20, sB: -30, eB: 40, hF: 85, kF: -110, hB: 60, kB: -120 }
  };
  function mix(a, b, t) { var o = {}; for (var k in a) o[k] = a[k] + (b[k] - a[k]) * t; return o; }
  function ease(t) { return t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t); }
  function rad(a) { return a * Math.PI / 180; }
  P.hook = { L: 18, hy: 19, sF: 95, eF: 75, sB: 30, eB: 110, hF: 30, kF: -40, hB: -30, kB: -20 };
  P.knee = { L: 12, hy: 22, sF: 75, eF: 55, sB: 75, eB: 55, hF: 115, kF: -140, hB: -5, kB: -5 };
  P.elbow = { L: 26, hy: 19, sF: 100, eF: 150, sB: 20, eB: 110, hF: 35, kF: -40, hB: -30, kB: -20 };
  P.headbutt = { L: 42, hy: 19, sF: 65, eF: 60, sB: 65, eB: 60, hF: 25, kF: -30, hB: -25, kB: -20 };
  P.stomp = { L: -6, hy: 23, sF: 60, eF: 60, sB: -25, eB: 60, hF: 45, kF: -8, hB: -5, kB: -5 };
  P.axe = { L: -16, hy: 21, sF: 125, eF: 30, sB: -60, eB: 40, hF: 170, kF: 0, hB: -10, kB: -10 };
  P.duck = { L: 38, hy: 9, sF: 60, eF: 120, sB: 40, eB: 130, hF: 90, kF: -150, hB: -10, kB: -140 };
  P.gut = { L: 58, hy: 17, sF: 20, eF: 90, sB: 10, eB: 100, hF: 20, kF: -30, hB: -20, kB: -20 };
  P.hurt = { L: -36, hy: 20, sF: -40, eF: 20, sB: -60, eB: 20, hF: 15, kF: -15, hB: -25, kB: -15 };
  P.lean = { L: -26, hy: 19, sF: 40, eF: 120, sB: 20, eB: 130, hF: 35, kF: -60, hB: -30, kB: -30 };
  P.parry = { L: 5, hy: 19, sF: 125, eF: 60, sB: 50, eB: 140, hF: 32, kF: -48, hB: -26, kB: -34 };
  P.lie = { L: 0, hy: 21, sF: 165, eF: 15, sB: 150, eB: 25, hF: 8, kF: -6, hB: -8, kB: -14 };
  // moves in a written fight: pose, length, the moment it lands, the distance it lands from
  var MV = {
    jab: { p: 'jab', d: 0.24, hit: 0.08, r: 28 }, cross: { p: 'cross', d: 0.28, hit: 0.1, r: 28 }, hook: { p: 'hook', d: 0.32, hit: 0.13, r: 24 },
    upper: { p: 'upper', d: 0.38, hit: 0.13, r: 20 }, knee: { p: 'knee', d: 0.34, hit: 0.13, r: 18 }, elbow: { p: 'elbow', d: 0.3, hit: 0.11, r: 18 },
    headbutt: { p: 'headbutt', d: 0.32, hit: 0.13, r: 16 }, kick: { p: 'kick', d: 0.36, hit: 0.13, r: 32 }, spin: { p: 'kick', d: 0.48, hit: 0.24, r: 32, spin: 1 },
    round: { p: 'kick', d: 0.44, hit: 0.2, r: 33, spin: 0.6 }, sweep: { p: 'sweep', d: 0.42, hit: 0.15, r: 30 }, stomp: { p: 'stomp', d: 0.36, hit: 0.18, r: 12 },
    axe: { p: 'axe', d: 0.6, hit: 0.38, r: 22, hop: 34 }, flykick: { p: 'flykick', d: 0.55, hit: 0.3, r: 28, hop: 30 }, slam: { p: 'grab', d: 0.75, hit: 0.12, r: 18 },
    backflip: { p: 'air', d: 0.5, back: 52 }, taunt: { p: 'taunt', d: 0.7 }, step: { p: 'walk', d: 0.32 }
  };
  // the answer on the other side (early: it starts as the blow is seen coming)
  var REACT = {
    hit: { p: 'hurt', d: 0.32, kb: 14, dmg: 8, blood: 7 }, head: { p: 'hurt', d: 0.45, kb: 24, dmg: 13, blood: 13, heavy: 1 },
    gut: { p: 'gut', d: 0.45, kb: 8, dmg: 10, blood: 4 }, block: { p: 'block', d: 0.26, kb: 6 }, parry: { p: 'parry', d: 0.24, kb: 3 },
    duck: { p: 'duck', d: 0.42, early: 1 }, lean: { p: 'lean', d: 0.38, kb: 18, early: 1 },
    down: { p: 'lie', d: 1.25, kb: 22, dmg: 12, blood: 10, heavy: 1 }, onground: { p: 'hurt', d: 0.3, dmg: 8, blood: 10 },
    slam: { d: 0.55, dmg: 16 }, fling: { kb: 560, up: 380, dmg: 24, blood: 16, heavy: 1 }
  };
  // the written fights: [who, move, at whom, answer, {gap, with, off, pass, slow}]  a = the ninja, b = his man, c = the third
  var SC2 = [
    [['b', 'jab', 'a', 'parry'], ['b', 'cross', 'a', 'duck'], ['a', 'upper', 'b', 'head'], ['b', 'kick', 'a', 'block'], ['a', 'knee', 'b', 'gut'], ['a', 'elbow', 'b', 'hit'], ['a', 'spin', 'b', 'fling', { slow: 0.7 }]],
    [['b', 'hook', 'a', 'hit'], ['b', 'kick', 'a', 'lean'], ['a', 'taunt'], ['b', 'cross', 'a', 'parry'], ['a', 'sweep', 'b', 'down'], ['a', 'stomp', 'b', 'onground', { gap: 0.05 }], ['a', 'step', null, null, { gap: 0.6 }], ['a', 'headbutt', 'b', 'head'], ['a', 'round', 'b', 'fling', { slow: 0.6 }]],
    [['a', 'jab', 'b', 'block'], ['a', 'cross', 'b', 'block'], ['a', 'hook', 'b', 'hit'], ['a', 'knee', 'b', 'gut'], ['a', 'elbow', 'b', 'head'], ['a', 'upper', 'b', 'fling', { slow: 0.6 }]],
    [['b', 'flykick', 'a', 'duck', { pass: 1 }], ['a', 'spin', 'b', 'block', { gap: 0.1 }], ['b', 'hook', 'a', 'parry'], ['a', 'headbutt', 'b', 'head'], ['a', 'slam', 'b', 'slam', { slow: 0.45 }], ['a', 'stomp', 'b', 'onground', { gap: 0.1 }], ['a', 'step', null, null, { gap: 0.7 }], ['a', 'kick', 'b', 'fling']],
    [['a', 'jab', 'b', 'hit'], ['b', 'cross', 'a', 'hit'], ['a', 'jab', 'b', 'block'], ['b', 'jab', 'a', 'block'], ['a', 'backflip'], ['b', 'step'], ['a', 'flykick', 'b', 'head'], ['a', 'axe', 'b', 'down', { slow: 0.6 }], ['a', 'taunt', null, null, { gap: 0.5 }]],
    [['b', 'kick', 'a', 'block'], ['b', 'round', 'a', 'duck'], ['a', 'upper', 'b', 'head'], ['a', 'knee', 'b', 'gut'], ['a', 'knee', 'b', 'gut'], ['a', 'elbow', 'b', 'down', { slow: 0.5 }], ['a', 'stomp', 'b', 'onground', { gap: 0.15 }], ['a', 'taunt', null, null, { gap: 0.4 }]],
    [['b', 'jab', 'a', 'hit'], ['b', 'cross', 'a', 'hit'], ['b', 'knee', 'a', 'gut'], ['b', 'upper', 'a', 'lean'], ['a', 'sweep', 'b', 'down'], ['a', 'backflip'], ['a', 'step', null, null, { gap: 0.6 }], ['a', 'flykick', 'b', 'fling', { slow: 0.6 }]]
  ];
  var SC3 = [
    [['a', 'taunt'], ['b', 'kick', 'a', 'block'], ['c', 'hook', 'a', 'duck'], ['b', 'cross', 'c', 'head', { with: 1, off: 0.08 }], ['a', 'sweep', 'b', 'down'], ['c', 'kick', 'a', 'parry'], ['a', 'knee', 'c', 'gut'], ['a', 'elbow', 'c', 'head'], ['a', 'spin', 'c', 'fling', { slow: 0.6 }], ['a', 'stomp', 'b', 'onground'], ['a', 'step', null, null, { gap: 0.4 }], ['a', 'upper', 'b', 'fling']],
    [['c', 'hook', 'a', 'hit'], ['b', 'kick', 'a', 'gut'], ['c', 'knee', 'a', 'gut'], ['a', 'backflip'], ['b', 'step'], ['a', 'flykick', 'c', 'down'], ['b', 'cross', 'a', 'parry'], ['a', 'headbutt', 'b', 'head'], ['a', 'slam', 'b', 'slam', { slow: 0.45 }], ['a', 'round', 'c', 'fling', { gap: 0.2, slow: 0.6 }]],
    [['b', 'jab', 'a', 'block'], ['c', 'jab', 'a', 'block', { with: 1, off: 0.05 }], ['b', 'kick', 'a', 'duck'], ['c', 'kick', 'b', 'hit', { with: 1, off: 0.04 }], ['a', 'upper', 'c', 'head'], ['a', 'spin', 'b', 'fling', { slow: 0.5 }], ['c', 'hook', 'a', 'parry'], ['a', 'knee', 'c', 'gut'], ['a', 'axe', 'c', 'down', { slow: 0.5 }], ['a', 'stomp', 'c', 'onground']]
  ];
  var ATK = {
    jab: { hit: 0.06, act: 0.08, end: 0.2, reach: 20, dmg: 9, kb: 170, up: 0, next: 'cross' },
    cross: { hit: 0.07, act: 0.08, end: 0.22, reach: 22, dmg: 10, kb: 200, up: 0, next: 'upper' },
    upper: { hit: 0.08, act: 0.1, end: 0.34, reach: 18, dmg: 16, kb: 200, up: 720, heavy: 1 },
    kick: { hit: 0.09, act: 0.09, end: 0.3, reach: 26, dmg: 14, kb: 640, up: 300, heavy: 1 },
    round: { pose: 'kick', hit: 0.14, act: 0.12, end: 0.42, reach: 28, dmg: 18, kb: 860, up: 380, heavy: 1, spin: 1 },
    sweep: { hit: 0.1, act: 0.12, end: 0.38, reach: 28, dmg: 10, kb: 120, up: 380, low: 1 },
    flykick: { hit: 0.02, act: 0.45, end: 0.5, reach: 22, dmg: 18, kb: 680, up: 300, air: 1, heavy: 1 },
    grab: { hit: 0.08, act: 0.12, end: 0.45, reach: 30, dmg: 0, grab: 1 }
  };

  window.ERP_STICK = function (o) {
    o = o || {};
    var cv = document.createElement('canvas'); cv.id = 'stickfx';
    cv.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;pointer-events:none;z-index:45';
    document.body.appendChild(cv);
    var ctx = cv.getContext('2d'), W = 0, H = 0, dpr = 1;
    var mode = o.mode || 'on', blood = o.blood !== false, on = false, raf = 0, last = 0, acc = 0;
    var plats = [], boxes = [], links = [], hero = null, foe = null, third = null, fx = [], decals = [], rags = [];
    var mx = -999, my = -999, mouseT = -99, scanT = 0, now = 0, nextFoeT = 1, kills = 0;
    var cho = null, choCd = 3, slowT = 0, thirdT = -1, lastCho = '';

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
        if (r.width < 26 || r.height < 14 || r.bottom < 0 || r.top > H - M || r.top < 4) continue;
        var x0 = Math.max(M, r.left + 2), x1 = Math.min(W - M, r.right - 2);
        if (x1 - x0 >= 24) np.push({ el: e, x0: x0, x1: x1, y: r.top });
        if (r.height < 60 && r.width < 500 && e.matches('button, .btn, .pill, .cchip, input, select')) nb.push({ el: e, x0: r.left, x1: r.right, y0: r.top, y1: r.bottom });
      }
      np.push({ el: null, x0: M, x1: W - M, y: H - M, ground: 1 });   // a last-resort floor an inch above the bottom
      [hero, foe, third].forEach(function (m) {
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
        hp: team === 'hero' ? 100 : 70, sta: 100, cd: 0, think: 0.3, ph: 0, flash: 0, spin: 0, flip: 0, plan: null, hideT: 0, roamT: 2, ambush: 0, lastLand: 0 };
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
    function enemyOf(m) {
      if (m !== hero) return hero;
      var a = foe && !foe.dying ? foe : null, b = third && !third.dying ? third : null;
      if (!a || !b) return a || b;
      return Math.hypot(a.x - hero.x, a.y - hero.y) <= Math.hypot(b.x - hero.x, b.y - hero.y) ? a : b;
    }
    function hurt(a, b, A) {
      if (!b || b.cho || b.st === 'dead' || b.st === 'flung' || b.st === 'held') return;
      var dir = b.x >= a.x ? 1 : -1;
      // the ninja reads almost everything: he blocks or slips away and hits back
      if (b === hero && Math.random() < 0.55) {
        if (Math.random() < 0.5 && hero.on) { spark(b.x - dir * 6, b.y - 28, 6); begin(hero, 'block'); hero.counter = 1; }
        else { jumpTo(hero, a.x - dir * 40, a.on ? a.on.y : hero.y, true, a.on); hero.ambush = 1; }
        return;
      }
      if (b.st === 'block' && b.dir === -dir) { spark(b.x - dir * 6, b.y - 28, 6); b.vx = dir * A.kb * 0.3; return; }
      if (b !== hero) b.hp -= A.dmg; else b.sta -= A.dmg * 1.4;
      b.flash = 0.1;
      bleed(b.x, b.y - 30, dir, A.heavy ? 14 : 7); spark(b.x - dir * 4, b.y - 30, 8);
      fx.push({ k: 'ring', x: b.x - dir * 4, y: b.y - 30, t: 0.2, T: 0.2 });
      if (A.heavy) { fx.push({ k: 'star', x: b.x - dir * 4, y: b.y - 30, t: 0.14, T: 0.14 }); fx.push({ k: 'shock', x: b.x - dir * 4, y: b.y - 30, t: 0.25, T: 0.25 }); freeze(0.07); shake(3); }
      else freeze(0.03);
      if (b.hp <= 0) { freeze(0.12); shake(5); fling(b, dir * (A.kb + 250), -(A.up + 340)); setTimeout(function () { b.dying = 1; }, 60); return; }
      if (A.up >= 250) fling(b, dir * A.kb, -A.up);
      else { b.vx = dir * A.kb; begin(b, 'hit'); }
    }
    // a body sent flying: it spins, bounces off the sides and bottoms of buttons and boxes, and lands on a top
    function fling(m, vx, vy) { m.aim = null; m.on = null; m.vx = vx; m.vy = vy; begin(m, 'flung'); m.spin = 0; m.rag = makeRag(m, vx, vy, m.team); }
    function makeRag(m, vx, vy, team, owner) {
      var J = joints(m, pose(m)), pts = {};
      ['head', 'neck', 'hip', 'eF', 'hF', 'eB', 'hB', 'kF', 'fF', 'kB', 'fB'].forEach(function (k) { var p = J[k], sp = k === 'head' || k === 'neck' ? 1.15 : k === 'fF' || k === 'fB' ? 0.85 : 1; pts[k] = { x: p.x, y: p.y, px: p.x - vx * sp / 50 + (Math.random() - 0.5) * 3, py: p.y - vy * sp / 50 + (Math.random() - 0.5) * 3 }; });
      var sticks = [['head', 'neck'], ['neck', 'hip'], ['neck', 'eF'], ['eF', 'hF'], ['neck', 'eB'], ['eB', 'hB'], ['hip', 'kF'], ['kF', 'fF'], ['hip', 'kB'], ['kB', 'fB'], ['head', 'hip'], ['eF', 'eB']];
      sticks = sticks.map(function (s2) { var a = pts[s2[0]], b = pts[s2[1]]; return [s2[0], s2[1], Math.hypot(a.x - b.x, a.y - b.y)]; });
      return { team: team, pts: pts, sticks: sticks, t: 0, bleedT: 0, live: 1, owner: m };
    }
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
      gone(m);
      if (hero) { hero.plan = null; hero.roamT = 0.8; }
    }
    function stepRag(r, dt) {
      r.t += dt;
      for (var k in r.pts) {
        var p = r.pts[k], vx = (p.x - p.px) * 0.99, vy = (p.y - p.py) * 0.99, ox = p.x, oy = p.y;
        p.px = p.x; p.py = p.y; p.x += vx; p.y += vy + G * dt * dt;
        for (var i = 0; i < plats.length; i++) { var q = plats[i]; if (p.x >= q.x0 && p.x <= q.x1 && oy <= q.y + 0.5 && p.y > q.y) { if (k === 'hip' && vy > 8 && r.t - (r.lastDust || -9) > 0.2) { r.lastDust = r.t; dust(p.x, q.y, 6); } p.y = q.y; p.py = p.y + (p.y - oy) * 0.3; p.px = p.x - vx * 0.6; break; } }
        for (var j = 0; j < boxes.length; j++) { var b = boxes[j]; if (p.x > b.x0 && p.x < b.x1 && p.y > b.y0 && p.y < b.y1 && !(ox > b.x0 && ox < b.x1 && oy > b.y0 && oy < b.y1) && oy > b.y0) {
          var hard = Math.hypot(vx, vy) > 9;
          if (ox <= b.x0) { p.x = b.x0; p.px = p.x + vx * 0.5; } else if (ox >= b.x1) { p.x = b.x1; p.px = p.x + vx * 0.5; } else { p.y = b.y1; p.py = p.y + vy * 0.4; }
          if (hard && (k === 'head' || k === 'hip') && r.t - (r.lastBump || -9) > 0.15) { r.lastBump = r.t; spark(p.x, p.y, 8); fx.push({ k: 'ring', x: p.x, y: p.y, t: 0.2, T: 0.2 }); fx.push({ k: 'dent', x: p.x, y: p.y, t: 0.5, T: 0.5 }); shake(2); if (r.owner && r.owner !== hero && r.owner.hp > 0) { r.owner.hp -= 5; if (r.owner.hp <= 0) r.owner.dying = 1; } }
        } }
        if (p.x < M) { p.x = M; p.px = M + vx * 0.5; } if (p.x > W - M) { p.x = W - M; p.px = W - M + vx * 0.5; } if (p.y > H - M) { p.y = H - M; p.py = p.y + vy * 0.3; }
      }
      for (var it = 0; it < 3; it++) r.sticks.forEach(function (s) { var a = r.pts[s[0]], b = r.pts[s[1]], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 0.01, df = (d - s[2]) / d * 0.5; a.x += dx * df; a.y += dy * df; b.x -= dx * df; b.y -= dy * df; });
      if (blood && r.t < 0.6) { r.bleedT -= dt; if (r.bleedT <= 0) { r.bleedT = 0.18; var n = r.pts.neck; fx.push({ k: 'blood', x: n.x, y: n.y, vx: (Math.random() - 0.5) * 70, vy: -50, t: 1.2, T: 1.2, r: 1.3 }); } }
    }

    // ---- moving
    function clearArc(m, x, y, T, plat) {
      var vx = (x - m.x) / T, vy = -((m.y - y) + 0.5 * G * T * T) / T;
      for (var k = 1; k < 12; k++) {
        var t = T * k / 12, px = m.x + vx * t, py = m.y + vy * t + 0.5 * G * t * t;
        if (py < 0) continue;
        for (var i = 0; i < boxes.length; i++) {
          var b = boxes[i];
          if (m.on && b.el === m.on.el) continue;
          if (plat && b.el === plat.el && k > 8) continue;
          if (px + 5 > b.x0 && px - 5 < b.x1 && py > b.y0 + 2 && py - 40 < b.y1) return false;
        }
      }
      return true;
    }
    function planT(m, x, y, plat) {   // a flight time whose arc is clear, or 0
      var dx = x - m.x, rise = m.y - y, T = Math.max(0.36, Math.min(0.95, 0.3 + Math.abs(dx) / 900 + Math.max(0, rise) / 1000));
      var tries = [T, Math.min(1.05, T * 1.2), Math.min(1.1, T * 1.4), T * 0.8];
      for (var i = 0; i < tries.length; i++) if (clearArc(m, x, y, tries[i], plat)) return tries[i];
      return 0;
    }
    function jumpTo(m, x, y, flip, plat, T0) {
      var dx = x - m.x, rise = m.y - y, T = T0 || Math.max(0.38, Math.min(1.15, 0.32 + Math.abs(dx) / 820 + Math.max(0, rise) / 900));
      m.vx = dx / T; m.vy = -(rise + 0.5 * G * T * T) / T; m.on = null; m.dir = dx >= 0 ? 1 : -1;
      begin(m, 'air'); m.flip = flip || Math.abs(dx) > 260 ? 1 : 0; m.spin = 0; m.aim = plat || null; dust(m.x, m.y, 4);
    }
    function leapToward(m, p, tx) { jumpTo(m, spot(m.on, p, tx), p.y, Math.random() < 0.5, p); }
    function escape(m) {
      var away = m.x >= mx ? 1 : -1, best = null, bs = -1e9;
      plats.forEach(function (p) {
        if (p === m.on || !m.on || !canJump(m.on, p)) return;
        var tx = spot(m.on, p, m.x + away * 220); if (nearBlock(tx, p.y)) return;
        var tg2 = enemyOf(m), sc = (tx - m.x) * away - Math.abs(m.y - p.y) * 0.3 - (tg2 ? Math.hypot(tx - tg2.x, p.y - tg2.y) * 0.3 : 0);
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

    // ---- minds: a "director" picks the scene so the fight is never the same loop
    //   duel (guard, step in, exchange, step back), stand-off (circle and taunt), ambush (the ninja hides, the other searches),
    //   breather (both pant), chase (a beaten enemy runs, the ninja follows; 1 in 3 chases he takes out the bow),
    //   retreat (the ninja is worn out - hidden stamina - runs off and catches his breath, the enemy hunts him)
    var scene = { name: 'standoff', t: 3, last: '', n: 0, bow: false, arrows: 0 };
    function setScene(name, t) { scene.last = scene.name; scene.name = name; scene.t = t; scene.n++; if (hero) { hero.guardT = 0; hero.goHide = 0; if (hero.st === 'hide' && name !== 'ambush') hero.st = 'guard'; } if (foe) foe.guardT = 0; }
    function pickScene() {
      var opts = ['duel', 'duel', 'duel', 'duel', 'duel', 'standoff', 'ambush'].filter(function (n) { return n !== scene.name; });
      var n = opts[Math.floor(Math.random() * opts.length)];
      setScene(n, n === 'duel' ? 6 + Math.random() * 5 : n === 'standoff' ? 1.8 + Math.random() * 1.2 : n === 'ambush' ? 7 : 2 + Math.random());
    }
    function direct(dt) {
      if (!hero || !foe || foe.dying) return;
      scene.t -= dt;
      if (foe.hp < 24 && !foe.fled && foe.on && scene.name !== 'chase') { foe.fled = 1; setScene('chase', 9); scene.bow = Math.random() < 1 / 3; scene.arrows = 0; return; }

      if (scene.name === 'retreat' && hero.sta > 88 && hero.st !== 'pant') { setScene('duel', 7); return; }
      if (scene.t <= 0) { if (scene.name === 'chase') setScene('duel', 8); else if (scene.name !== 'retreat') pickScene(); }
    }
    function attackChoice(m) {
      var r = Math.random();
      if (m === hero) return r < 0.3 ? 'grab' : r < 0.48 ? 'jab' : r < 0.62 ? 'round' : r < 0.78 ? 'kick' : r < 0.9 ? 'upper' : 'sweep';
      return r < 0.15 ? 'grab' : r < 0.47 ? 'jab' : r < 0.67 ? 'kick' : r < 0.78 ? 'round' : r < 0.9 ? 'sweep' : 'upper';
    }
    // parkour: walk off an edge to drop down, a quick vault to a ledge just above, a flip only over a long gap
    function moveTo(m, p, tx) {
      if (!m.on || p === m.on) return false;
      var x = spot(m.on, p, tx), dx = x - m.x, rise = m.y - p.y, overlap = p.x1 > m.on.x0 - 20 && p.x0 < m.on.x1 + 20;
      if (rise < -8 && overlap && !p.ground) {               // below: run off the edge on his side and drop
        var edge = x < m.x ? m.on.x0 - 4 : m.on.x1 + 4;
        if (x > m.on.x0 && x < m.on.x1) edge = Math.abs(x - m.on.x0) < Math.abs(x - m.on.x1) ? m.on.x0 - 4 : m.on.x1 + 4;
        m.dropTo = p; m.st = 'run'; m.dir = edge > m.x ? 1 : -1; m.vx = m.dir * 190; return true;
      }
      var xs = [x, (p.x0 + p.x1) / 2, p.x0 + 10, p.x1 - 10], T = 0;
      for (var i = 0; i < xs.length && !T; i++) { T = planT(m, xs[i], p.y, p); if (T) x = xs[i]; }
      if (!T) return false;
      if (rise > 0 && rise < 90 && Math.abs(dx) < 160) { jumpTo(m, x, p.y, false, p, T); m.vault = 1; return true; }
      jumpTo(m, x, p.y, Math.abs(dx) > 230 && Math.random() < 0.7, p, T);
      return true;
    }
    function farFrom(m, from) {   // a ledge far from "from" that m can reach
      var best = null, bs = -1;
      (links[idx(m.on)] || []).forEach(function (j) { var p = plats[j]; if (p.ground || nearBlock((p.x0 + p.x1) / 2, p.y)) return; var d = Math.hypot((p.x0 + p.x1) / 2 - from.x, p.y - from.y) + Math.random() * 120; if (d > bs) { bs = d; best = p; } });
      return best;
    }
    function goToward(m, tg) {   // the next ledge on the way to him: the shortest chain first, else any ledge that brings him closer
      var nxt = route(m.on, tg.on);
      if (nxt && nxt !== m.on && !nearBlock(spot(m.on, nxt, tg.x), nxt.y) && moveTo(m, nxt, nxt === tg.on ? tg.x - (tg.x > m.x ? 30 : -30) : tg.x)) return true;
      var here = Math.hypot(tg.x - m.x, tg.y - m.y);
      var cand = (links[idx(m.on)] || []).map(function (j) { return plats[j]; }).filter(function (p) { return !p.ground; })
        .map(function (p) { var x = spot(m.on, p, tg.x); return { p: p, x: x, d: Math.hypot(tg.x - x, tg.y - p.y) }; })
        .filter(function (c) { return c.d < here - 20 && !nearBlock(c.x, c.p.y); }).sort(function (a, b) { return a.d - b.d; });
      for (var i = 0; i < Math.min(5, cand.length); i++) if (moveTo(m, cand[i].p, cand[i].x)) return true;
      return false;
    }
    function think(m, dt) {
      m.think -= dt; m.cd = Math.max(0, m.cd - dt);
      if (m === hero) m.sta = Math.min(100, m.sta + (m.st === 'pant' ? 22 : 3) * dt);
      if (!m.on || ['atk', 'hit', 'land', 'flung', 'held', 'dead', 'rise', 'roll', 'aim', 'cho'].indexOf(m.st) >= 0) return;
      if (m.dropTo) { if (m.st !== 'run') m.dropTo = null; else return; }   // (a planned drop runs on past the edge)
      if (nearBlock(m.x, m.y)) { escape(m); return; }
      var tg = enemyOf(m);
      if (m.st === 'block' && m.t < 0.25) return;
      if (m.st === 'block') { begin(m, 'guard'); if (m.counter && tg && Math.abs(tg.x - m.x) < 40) { m.counter = 0; begin(m, 'atk', 'upper'); return; } }
      if ((m.st === 'run' || m.st === 'walk') && ((m.x <= m.on.x0 + 3 && m.vx < 0) || (m.x >= m.on.x1 - 3 && m.vx > 0))) { m.vx = 0; m.st = 'guard'; }   // never walk off an edge by accident
      if (m.think > 0) return;
      m.think = 0.1 + Math.random() * 0.15 * (mode === 'calm' ? 3 : 1);
      // no one to fight: wander about the whole page
      if (!tg || tg.st === 'dead' || tg.dying) { m.roamT -= 0.25; if (m.roamT <= 0) { m.roamT = 1.5 + Math.random() * 2.5; roam(m); } else if (Math.random() < 0.08) begin(m, Math.random() < 0.5 ? 'taunt' : 'look'); return; }
      if (tg.cho && m !== hero && Math.abs(tg.x - m.x) < 80) { m.dir = tg.x >= m.x ? 1 : -1; m.vx = 0; if (m.st !== 'guard' && m.st !== 'taunt') begin(m, Math.random() < 0.3 ? 'taunt' : 'guard'); return; }   // someone else's fight: wait his turn
      var dx = tg.x - m.x, ad = Math.abs(dx), same = tg.on && m.on && (tg.on === m.on || (Math.abs(tg.y - m.y) < 14 && ad < 90)), sc = scene.name;   // next-door tiles at the same height are one fighting ground
      m.dir = dx >= 0 ? 1 : -1;
      var flee = (sc === 'chase' && m === foe) || (sc === 'retreat' && m === hero);
      if (flee) {
        if (m === hero && m.st === 'pant') { if (m.sta > 88) begin(m, 'guard'); return; }
        if (ad > 330 || (m === hero && ad > 220 && Math.random() < 0.4)) { begin(m, 'pant'); m.vx = 0; return; }        // far enough: catch his breath
        if (m === foe && ad < 50 && Math.random() < 0.25) { setScene('duel', 6); begin(m, 'atk', 'jab'); m.vx = 0; return; } // cornered: turns and fights back
        var away = farFrom(m, tg); if (away) { moveTo(m, away, (away.x0 + away.x1) / 2); return; }
        m.st = 'run'; m.dir = -m.dir; m.vx = m.dir * 220; return;
      }
      if (sc === 'chase' && m === hero) {
        // the bow: 1 chase in 3, when he is far away
        if (scene.bow && scene.arrows < 3 && ad > 180 && ad < 620 && Math.abs(tg.y - m.y) < 220 && m.cd <= 0 && tg.st !== 'flung') { begin(m, 'aim'); m.vx = 0; m.cd = 1.1; return; }
        if (same) { if (ad < 30) { begin(m, 'atk', attackChoice(m)); m.vx = 0; return; } m.st = 'run'; m.vx = m.dir * 230; return; }
        if (!tg.on) { m.st = 'idle'; m.vx = 0; return; }
        if (!goToward(m, tg)) { m.st = 'run'; m.vx = m.dir * 200; }
        return;
      }
      if (sc === 'retreat' && m === foe) {
        // hunting the worn-out ninja; if he is far and resting, look around for him
        if (ad > 260 && Math.random() < 0.3) { begin(m, 'look'); m.vx = 0; return; }
      }
      if (sc === 'breather') { if (m.st !== 'pant') { begin(m, 'pant'); m.vx = 0; } else if (Math.random() < 0.15) begin(m, 'wipe'); return; }
      if (m.st === 'pant' || m.st === 'wipe') begin(m, 'guard');
      // the ambush: the ninja hides at the end of a ledge, the other searches for him
      if (sc === 'ambush') {
        if (m === hero) {
          if (m.st === 'hide') {
            if ((ad < 150 && tg.on) || scene.t < 0.6) { if (tg.on && !nearBlock(tg.x, tg.y)) { jumpTo(m, tg.x - m.dir * 16, tg.on.y, true, tg.on); m.ambush = 1; } else begin(m, 'guard'); setScene('duel', 7); }
            return;
          }
          if (!m.goHide) {
            var edgeX = dx > 0 ? m.on.x1 - 6 : m.on.x0 + 6;
            m.st = 'run'; m.dir = edgeX > m.x ? 1 : -1; m.vx = m.dir * 160; m.hideAt = edgeX; m.goHide = 1; return;
          }
          if (Math.abs(m.x - m.hideAt) < 6 || m.st !== 'run') { m.goHide = 0; m.vx = 0; m.dir = dx >= 0 ? 1 : -1; begin(m, 'hide'); }
          return;
        }
        // the searcher: slow steps, stops, looks around, turns
        if (hero.st === 'hide') {
          var r = Math.random();
          if (r < 0.35) { begin(m, 'look'); m.vx = 0; return; }
          if (r < 0.5) { m.dir = -m.dir; m.st = 'walk'; m.vx = m.dir * 60; return; }
          if (r < 0.62 && ad > 200) { goToward(m, hero); return; }
          m.st = 'walk'; m.vx = m.dir * 60; return;
        }
      }
      if (!tg.on) { if (m.st === 'run' || m.st === 'walk') { m.st = 'guard'; m.vx = 0; } return; }   // he is in the air: wait for him to land
      if (same) m.waitT = 0;
      if (!same && m === hero && Math.hypot(dx, tg.y - m.y) < 260 && (sc === 'duel' || sc === 'standoff') && (m.waitT = (m.waitT || 0) + 0.25) < 1.6) { if (m.st !== 'guard') { begin(m, 'guard'); m.vx = 0; } return; }   // he lets the other come to him
      if (!same) { if (!goToward(m, tg)) { m.st = 'run'; m.vx = m.dir * 200; if (m.x <= m.on.x0 + 2 || m.x >= m.on.x1 - 2) { m.on = null; begin(m, 'air'); m.vx = m.dir * 140; } } return; }
      // same ledge (or the tile next door: hop over the gap)
      if (tg.on !== m.on && (ad > 34 || Math.abs(tg.y - m.y) > 2)) { if (moveTo(m, tg.on, tg.x - m.dir * 26)) return; }
      if (sc === 'standoff') {
        // circle: keep 70-110 apart, step in and out slowly, taunt
        var want = 90;
        if (Math.random() < 0.18) { begin(m, Math.random() < 0.5 ? 'taunt' : 'guard'); m.vx = 0; return; }
        m.st = 'walk'; m.vx = (ad > want + 20 ? m.dir : ad < want - 20 ? -m.dir : (Math.random() < 0.5 ? 1 : -1)) * 55; return;
      }
      // the duel: guard at arm's length, then an exchange, then a step back
      if (ad < 34) {
        if (nearBlock(tg.x, tg.y)) { m.vx = 0; m.st = 'guard'; return; }
        if (m.st !== 'guard') { begin(m, 'guard'); m.vx = 0; m.guardT = 0.05 + Math.random() * 0.2; return; }
        m.guardT = (m.guardT || 0) - 0.2;
        if (m.guardT > 0) { m.vx = (Math.random() - 0.5) * 30; return; }
        if (m === foe && Math.random() < 0.07) { begin(m, 'block'); m.vx = 0; return; }
        begin(m, 'atk', attackChoice(m)); m.vx = 0; m.guardT = 0.08 + Math.random() * 0.25; return;
      }
      if (ad > 90 && ad < 150 && Math.random() < 0.06 && !nearBlock(tg.x, tg.y)) { jumpTo(m, tg.x - m.dir * 14, tg.y, false, tg.on); m.flykick = 1; return; }
      m.st = ad < 60 ? 'walk' : 'run'; m.vx = m.dir * (ad < 60 ? 150 : 210) * (mode === 'calm' ? 0.6 : 1);
    }
    var arrows = [], frozen = 0, shk = 0;
    function freeze(t) { frozen = Math.max(frozen, t); }
    function shake(a) { shk = Math.max(shk, a); }
    function shoot(m, tg) {
      var sx0 = m.x + m.dir * 14, sy0 = m.y - 34, ty = tg.y - 26 + (Math.random() - 0.5) * 14, tx = tg.x + (tg.vx || 0) * 0.25 + (Math.random() - 0.5) * 18;
      var T = Math.max(0.35, Math.min(0.95, Math.abs(tx - sx0) / 650)), ga = 900;
      arrows.push({ owner: m, x: sx0, y: sy0, vx: (tx - sx0) / T, vy: (ty - sy0 - 0.5 * ga * T * T) / T, t: 0, stuck: 0 });
    }
    function stepArrows(dt) {
      arrows = arrows.filter(function (a) {
        if (a.stuck) { a.stuck -= dt; return a.stuck > 0; }
        var ox = a.x, oy = a.y; a.t += dt; a.vy += 900 * dt; a.x += a.vx * dt; a.y += a.vy * dt;
        var tg = enemyOf(a.owner);
        if (tg && tg.st !== 'dead' && Math.abs(a.x - tg.x) < 7 && a.y > tg.y - 48 && a.y < tg.y) { hurt(a.owner, tg, { dmg: 14, kb: 240, up: 280, heavy: 1 }); return false; }
        for (var i = 0; i < plats.length; i++) { var q = plats[i]; if (a.x >= q.x0 && a.x <= q.x1 && oy <= q.y && a.y >= q.y && a.vy > 0) { a.y = q.y; a.stuck = 3; dust(a.x, q.y, 2); return true; } }
        for (var j = 0; j < boxes.length; j++) { var b = boxes[j]; if (a.y > b.y0 && a.y < b.y1 && ((ox <= b.x0 && a.x > b.x0) || (ox >= b.x1 && a.x < b.x1))) { a.x = ox <= b.x0 ? b.x0 : b.x1; a.stuck = 3; spark(a.x, a.y, 3); return true; } }
        return a.t < 3 && a.x > -20 && a.x < W + 20 && a.y < H + 20;
      });
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
    function free2(m) { return ['idle', 'run', 'taunt', 'land', 'guard', 'walk', 'pant', 'look'].indexOf(m.st) >= 0; }
    function watchStuck(m, dt) {
      if (m.st === 'cho') return;
      var tg = enemyOf(m);
      if (m.on && m.on.ground && tg && tg.on && !tg.on.ground) {
        m.groundT = (m.groundT || 0) + dt;
        if (m.groundT > 0.35 && free2(m)) {   // down at the bottom of the screen: one big leap back up, or vanish and reappear
          m.groundT = 0;
          var up = plats.filter(function (p) { return !p.ground && p.x1 - p.x0 > 30 && m.y - p.y < 620 && Math.abs((p.x0 + p.x1) / 2 - m.x) < 500 && !nearBlock((p.x0 + p.x1) / 2, p.y); });
          up.sort(function (a, b) { return (tg ? Math.hypot((a.x0 + a.x1) / 2 - tg.x, a.y - tg.y) - Math.hypot((b.x0 + b.x1) / 2 - tg.x, b.y - tg.y) : 0); });
          for (var u = 0; u < Math.min(6, up.length); u++) { var p = up[u], ux = Math.max(p.x0 + 8, Math.min(p.x1 - 8, tg ? tg.x : m.x)), T = planT(m, ux, p.y, p); if (T) { jumpTo(m, ux, p.y, true, p, T); break; } }
        }
      } else m.groundT = 0;
      if (!tg || !tg.on || !m.on || tg.on === m.on || m.st === 'hide' || m.goHide) { m.stuckT = 0; m.bestD = 1e9; return; }
      var d = Math.hypot(tg.x - m.x, tg.y - m.y);
      if (d < (m.bestD || 1e9) - 25) { m.bestD = d; m.stuckT = 0; } else m.stuckT = (m.stuckT || 0) + dt;
      if (m.stuckT > 3.5) { m.bestD = 1e9; m.stuckT = 0; if (m.on && !goToward(m, tg)) { begin(m, 'look'); m.vx = 0; } }
    }
    function step(m, dt) {
      if (!m) return;
      if (m.st === 'cho') { m.t += dt; m.flash = Math.max(0, m.flash - dt); stepCho(m, dt); return; }
      watchStuck(m, dt);
      m.t += dt; m.flash = Math.max(0, m.flash - dt); m.ph += dt * (m.st === 'run' ? Math.max(9, Math.abs(m.vx) / 16) : m.st === 'walk' ? Math.max(4, Math.abs(m.vx) / 9) : 3);
      think(m, dt);
      var tg = enemyOf(m);
      if (m.st === 'atk' && m.atk === 'toss') {
        m.vx = 0;
        if (m.holding) {
          var h = m.holding, lift = Math.min(1, m.t / 0.3); h.x = m.x + m.dir * (10 - lift * 12); h.y = m.y - 6 - lift * 34; h.dir = -m.dir;
          if (m.t > 0.45) {
            var away = Math.random() < 0.3 ? -m.dir : m.dir;
            h.x = m.x + away * 10; h.heldBy = null; fling(h, away * (520 + Math.random() * 320), -(330 + Math.random() * 280));
            if (h !== hero) { h.hp -= 12; bleed(h.x, h.y - 20, away, 6); if (h.hp <= 0) h.dying = 1; }
            spark(m.x + m.dir * 10, m.y - 34, 6); m.holding = null;
          }
        }
        if (m.t > 0.65) begin(m, 'guard');
      } else if (m.st === 'atk') {
        var A = ATK[m.atk];
        if (!A.air) m.vx = A.spin ? m.dir * 40 : 0;
        if (!m.done && m.t >= A.hit && m.t <= A.hit + A.act && tg && tg.st !== 'dead' && !tg.cho) {
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
          if (m.done && A.next && Math.random() < (m === hero ? 0.95 : 0.75)) begin(m, 'atk', A.next);
          else { begin(m, 'guard'); if (m.on && Math.random() < 0.35) { m.vx = -m.dir * 90; } }
        }
      } else if (m.st === 'aim') {
        m.vx = 0; if (tg) m.dir = tg.x >= m.x ? 1 : -1;
        if (m.t > 0.55 && !m.done && tg) { m.done = 1; shoot(m, tg); scene.arrows++; }
        if (m.t > 0.85) begin(m, 'guard');
      } else if (m.st === 'roll') { if (tg) m.dir = tg.x >= m.x ? 1 : -1; m.vx = m.dir * 60; if (m.t > 0.3) begin(m, 'guard'); }
      else if (m.st === 'look') { m.vx = 0; if (m.t > 0.5 && !m.done) { m.done = 1; m.dir = -m.dir; } if (m.t > 1.1) begin(m, 'guard'); }
      else if (m.st === 'wipe' && m.t > 0.7) begin(m, 'pant');
      else if (m.st === 'hit' && m.t > 0.22) begin(m, 'guard');
      else if (m.st === 'land' && m.t > 0.14) { begin(m, m.down ? 'rise' : 'guard'); }
      else if (m.st === 'rise' && m.t > 0.35) { m.down = 0; begin(m, 'guard'); }
      else if (m.st === 'taunt' && m.t > 0.8) begin(m, 'idle');
      if (m.st === 'air' && m.flykick && m.vy > -160) { m.flykick = 0; begin(m, 'atk', 'flykick'); }
      if (m.st === 'air' && m.ambush && m.vy > -160 && tg && Math.abs(tg.x - m.x) < 60) { m.ambush = 0; begin(m, 'atk', 'flykick'); }
      if (m.st === 'held') { if (!m.heldBy || m.heldBy.holding !== m || m.heldBy.st !== 'atk') { m.heldBy = null; fling(m, 0, -120); } else return; }
      if (m.st === 'flung' && m.rag) {
        var r = m.rag; stepRag(r, dt);
        var hp2 = r.pts.hip, sp2 = Math.hypot(hp2.x - hp2.px, hp2.y - hp2.py) / Math.max(dt, 0.001);
        m.x = hp2.x; m.y = Math.max(r.pts.fF.y, r.pts.fB.y, hp2.y + 4); m.vx = (hp2.x - hp2.px) / Math.max(dt, 0.001); m.vy = (hp2.y - hp2.py) / Math.max(dt, 0.001);
        if (r.impact) { r.impact = 0; }
        if (m.dying) { m.dying = 0; rags.push(r); r.live = 0; m.rag = null; gone(m); if (hero) { hero.plan = null; hero.roamT = 0.8; } return; }
        if (r.t > 0.7 && sp2 < 60) {
          var under = null; for (var u = 0; u < plats.length; u++) { var q2 = plats[u]; if (hp2.x >= q2.x0 && hp2.x <= q2.x1 && q2.y >= hp2.y - 6 && q2.y - hp2.y < 30) { under = q2; break; } }
          if (under) { m.rag = null; m.x = hp2.x; m.y = under.y; m.on = under; m.vx = m.vy = 0; m.down = 1; begin(m, 'land'); dust(m.x, m.y, 5); }
          else if (r.t > 2.5) { m.rag = null; m.on = null; begin(m, 'air'); }
        }
        return;
      }
      var ox = m.x, oy = m.y;
      if (!m.on) {
        m.vy += G * dt; m.x += m.vx * dt; m.y += m.vy * dt;
        if (m.flip || m.st === 'flung') m.spin += dt * (m.st === 'flung' ? 16 : 13);
        if (m.st === 'flung' && !m.rag) bounce(m, ox, oy);
        if (m.vy >= 0) for (var i = 0; i < plats.length; i++) {
          var p = plats[i];
          if (m.aim && m.st !== 'flung' && p !== m.aim && !p.ground) continue;   // a planned jump lands where it was aimed
          if (m.x >= p.x0 - 3 && m.x <= p.x1 + 3 && oy <= p.y + 0.5 && m.y >= p.y) {
            if (m.st === 'flung' && m.vy > 500 && !p.ground) { m.y = p.y; m.vy = -m.vy * 0.32; m.vx *= 0.7; dust(m.x, p.y, 6); spark(m.x, p.y - 4, 4); if (m !== hero) m.hp -= 4; break; }   // bounces on the top
            var fast = m.vy > 820;
            m.aim = null; m.vault = 0; m.y = p.y; m.on = p; m.x = Math.max(p.x0, Math.min(p.x1, m.x)); m.vy = 0; m.vx *= 0.08; m.flip = 0; m.spin = 0; m.lastLand = now; dust(m.x, p.y, 6);
            if (m.big) { m.big = 0; shake(6); dust(m.x, p.y, 16); fx.push({ k: 'shock', x: m.x, y: p.y - 4, t: 0.3, T: 0.3 }); }
            if (m.st === 'flung') { m.down = 1; begin(m, 'land'); } else if (fast && p.x1 - p.x0 > 60) begin(m, 'roll'); else begin(m, 'land');
            break;
          }
        }
        if (m.x < M || m.x > W - M) { m.vx = -m.vx * 0.5; m.x = Math.max(M, Math.min(W - M, m.x)); }
        if (m.y > H - M + 4) { m.y = H - M; m.on = plats[plats.length - 1]; m.vy = 0; begin(m, 'land'); }
      } else {
        m.x += m.vx * dt;
        if (m.x < m.on.x0 - 2 || m.x > m.on.x1 + 2) {
          m.on = null; if (['run', 'idle', 'hit', 'walk', 'guard', 'roll'].indexOf(m.st) >= 0) begin(m, 'air');
          if (m.dropTo) { m.aim = m.dropTo; m.dropTo = null; m.vx = m.dir * 110; }
        }
        if (m.st !== 'run' && m.st !== 'atk' && m.st !== 'walk' && m.st !== 'roll') m.vx *= Math.pow(0.002, dt);
      }
      if (m.dying && m.st !== 'held') { m.dying = 0; die(m); }
    }

    // ---- drawing (no outline: the ninja yellow, the others blue)
    function pose(m) {
      if (m.st === 'cho') return choPose(m);
      if (m.st === 'run') { var s = Math.sin(m.ph), cc = Math.abs(Math.cos(m.ph)); return { L: 22 + cc * 4, hy: 19 + cc * 2, sF: 28 - s * 62, eF: 95 + s * 15, sB: 28 + s * 62, eB: 95 - s * 15, hF: 14 + 52 * s, kF: -22 - 85 * Math.max(0, -s), hB: 14 - 52 * s, kB: -22 - 85 * Math.max(0, s) }; }   // leaning in, bent arms pumping against the legs, the trailing knee folding high
      if (m.st === 'atk') {
        if (m.atk === 'toss') return m.t < 0.3 ? mix(P.grab, P.toss, ease(m.t / 0.3) * 0.8) : m.t < 0.45 ? P.toss : mix(P.toss, P.jab, ease((m.t - 0.45) / 0.12));
        var A = ATK[m.atk], tp = P[A.pose || m.atk], k = m.t < A.hit ? ease(m.t / A.hit) * 0.6 : m.t < A.hit + A.act ? 1 : 1 - ease((m.t - A.hit - A.act) / (A.end - A.hit - A.act));
        return mix(P.idle, tp, k);
      }
      if (m.st === 'walk') { var w = Math.sin(m.ph * 0.6); return { L: 10, hy: 19, sF: 55 - w * 15, eF: 110, sB: 40 + w * 15, eB: 120, hF: 15 + 25 * w, kF: -25 - 20 * Math.max(0, -w), hB: 10 - 25 * w, kB: -25 - 20 * Math.max(0, w) }; }
      if (m.st === 'guard') { var b2 = Math.sin(now * 5 + m.x) * 1.2; return { L: 8, hy: 19 + b2, sF: 58, eF: 118, sB: 42, eB: 126, hF: 32, kF: -48 - b2 * 3, hB: -26, kB: -34 - b2 * 3 }; }
      if (m.st === 'pant') { var b3 = Math.sin(now * 9) * 1.5; var q = {}; for (var k2 in P.pant) q[k2] = P.pant[k2]; q.L += b3 * 2; q.hy += b3 * 0.4; return q; }
      if (m.st === 'aim') return m.t < 0.4 ? mix(P.guard, P.aim, ease(m.t / 0.3)) : P.aim;
      if (m.st === 'roll') return P.land;
      if (m.st === 'air' && m.vault) return P.vault;
      if (m.st === 'air') return m.vy < 0 ? P.air : mix(P.air, P.fall, Math.min(1, m.vy / 900));
      if (m.st === 'flung') return P.fall;
      if (m.st === 'rise') return mix(P.land, P.idle, ease(m.t / 0.35));
      return P[m.st] || P.idle;
    }
    function joints(m, p) {
      var d = m.dir, z = m.sz || 1, hip = { x: m.x, y: m.y - p.hy * z + (m.yo || 0) }, L = rad(p.L);
      function pt(o, a, l) { return { x: o.x + Math.sin(rad(a)) * l * z * d, y: o.y + Math.cos(rad(a)) * l * z }; }
      var neck = { x: hip.x + Math.sin(L) * 15 * z * d, y: hip.y - Math.cos(L) * 15 * z };
      var head = { x: neck.x + Math.sin(L) * 6 * z * d, y: neck.y - Math.cos(L) * 6 * z };
      var sh = { x: hip.x + Math.sin(L) * 13 * z * d, y: hip.y - Math.cos(L) * 13 * z };
      var eF = pt(sh, p.sF, 8), hF = pt(eF, p.sF + p.eF, 8), eB = pt(sh, p.sB, 8), hB = pt(eB, p.sB + p.eB, 8);
      var kF = pt(hip, p.hF, 10), fF = pt(kF, p.hF + p.kF, 10), kB = pt(hip, p.hB, 10), fB = pt(kB, p.hB + p.kB, 10);
      return { hip: hip, neck: neck, head: head, eF: eF, hF: hF, eB: eB, hB: hB, kF: kF, fF: fF, kB: kB, fB: fB, z: z };
    }
    function colorOf(team) { return team === 'hero' ? (dark() ? HERO_D : HERO_L) : team === 'red' ? (dark() ? THIRD_D : THIRD) : (dark() ? FOE_D : FOE); }
    function drawMan(J, team, flash, c, ang, alpha) {
      ctx.save(); if (alpha !== undefined) ctx.globalAlpha = alpha;
      if (ang) { ctx.translate(c.x, c.y); ctx.rotate(ang); ctx.translate(-c.x, -c.y); }
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      var col = flash ? '#ffffff' : colorOf(team);
      ctx.strokeStyle = col; ctx.lineWidth = 3.4 * (J.z || 1);
      [['neck', 'hip'], ['neck', 'eB'], ['eB', 'hB'], ['hip', 'kB'], ['kB', 'fB'], ['hip', 'kF'], ['kF', 'fF'], ['neck', 'eF'], ['eF', 'hF']].forEach(function (l) { ctx.beginPath(); ctx.moveTo(J[l[0]].x, J[l[0]].y); ctx.lineTo(J[l[1]].x, J[l[1]].y); ctx.stroke(); });
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(J.head.x, J.head.y, 5.8 * (J.z || 1), 0, 7); ctx.fill();
      ctx.restore();
    }
    function drawFighter(m) {
      if (m.st === 'flung' && m.rag) { var JR = {}; for (var kk in m.rag.pts) JR[kk] = m.rag.pts[kk]; drawMan(JR, m.team, m.flash > 0, null, 0); return; }
      var p = pose(m), J = joints(m, p), ang = (m.flip || m.st === 'flung') ? -m.spin * m.dir : 0;
      if (m.st === 'roll') { ang = -(m.t / 0.35) * Math.PI * 2 * m.dir; J = joints(m, P.land); }
      if (m.st === 'atk' && ATK[m.atk] && ATK[m.atk].spin) ang = (m.t / ATK[m.atk].end) * Math.PI * 2 * m.dir * 0.25;
      var c = { x: m.x, y: m.y - 22 + (m.yo || 0) }, alpha = m.st === 'hide' ? 0.45 : 1;
      if (m.st === 'cho') { var CA = choAng(m); ang = CA.a; if (CA.c) c = CA.c; }
      if (m.st === 'run' && Math.abs(m.vx) > 220) { ctx.strokeStyle = 'rgba(148,163,184,.5)'; ctx.lineWidth = 1; for (var q = 0; q < 3; q++) { var ly = m.y - 10 - q * 12; ctx.beginPath(); ctx.moveTo(m.x - m.dir * 14, ly); ctx.lineTo(m.x - m.dir * (32 + q * 6), ly); ctx.stroke(); } }
      // afterimages on long leaps and when thrown
      if ((m.flip && Math.abs(m.vx) > 400) || m.st === 'flung' || (m.st === 'cho' && Math.abs(m.vx) > 260)) [0.035, 0.07].forEach(function (k, i) { drawMan(joints({ x: m.x - m.vx * k, y: m.y - m.vy * k, dir: m.dir }, p), m.team, false, { x: c.x - m.vx * k, y: c.y - m.vy * k }, ang + (i + 1) * 0.5 * m.dir, 0.22 - i * 0.08); });
      if ((m.st === 'atk' && (m.atk === 'kick' || m.atk === 'round' || m.atk === 'flykick') && m.t > 0.04 && m.t < 0.3) ||
          (m.st === 'cho' && m.mv && /kick|spin|round|axe|sweep/.test(m.mv.mv) && m.mv.t > 0.04 && m.mv.t < MV[m.mv.mv].d * 0.75)) {
        m.ktrail = (m.ktrail || []).concat([{ x: J.fF.x, y: J.fF.y }]).slice(-6);
        ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 2.2; ctx.beginPath(); m.ktrail.forEach(function (q, i) { if (i) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y); }); ctx.stroke();
      } else m.ktrail = null;
      drawMan(J, m.team, m.flash > 0, c, ang, alpha);
      // looking for him: "?" over the head
      if (m.st === 'look') { ctx.font = '700 12px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(203,213,225,.9)'; ctx.fillText('?', J.head.x + m.dir * 6, J.head.y - 10); }
      // the bow
      if (m.st === 'aim') {
        var h1 = J.hF, h2 = J.hB, pull = Math.min(1, m.t / 0.45);
        ctx.strokeStyle = '#8b6a3e'; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.arc(h1.x - m.dir * 4, h1.y, 11, m.dir > 0 ? -1.2 : Math.PI - 1.2 + 0, m.dir > 0 ? 1.2 : Math.PI + 1.2); ctx.stroke();
        var tx1 = h1.x - m.dir * 4 + Math.cos(1.2) * 11 * m.dir, ty1 = h1.y - Math.sin(1.2) * 11, ty2 = h1.y + Math.sin(1.2) * 11;
        ctx.strokeStyle = 'rgba(229,231,235,.8)'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(tx1, ty1); ctx.lineTo(h1.x - m.dir * (4 + 10 * pull), h1.y); ctx.lineTo(tx1, ty2); ctx.stroke();
        if (!m.done) { ctx.strokeStyle = '#e5e7eb'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(h1.x - m.dir * (4 + 10 * pull), h1.y); ctx.lineTo(h1.x + m.dir * 10, h1.y); ctx.stroke(); }
      }
      if (m.team === 'hero') {
        ctx.save(); ctx.globalAlpha = alpha; if (ang) { ctx.translate(c.x, c.y); ctx.rotate(ang); ctx.translate(-c.x, -c.y); }
        var hx = J.head.x - m.dir * 5, hy = J.head.y - 1, wv = Math.sin(now * 18 + m.x * 0.05), band = dark() ? '#8f2a2a' : '#dc2626';
        ctx.strokeStyle = band; ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(J.head.x - 5.8, J.head.y - 1.5); ctx.lineTo(J.head.x + 5.8, J.head.y - 1.5); ctx.stroke();
        ctx.lineWidth = 1.8; ctx.beginPath(); ctx.moveTo(hx, hy); ctx.quadraticCurveTo(hx - m.dir * 9, hy + wv * 3, hx - m.dir * 18, hy + 2 + wv * 5); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(hx, hy); ctx.quadraticCurveTo(hx - m.dir * 8, hy + 4 + wv * 2, hx - m.dir * 14, hy + 7 + wv * 4); ctx.stroke();
        ctx.restore();
      }
    }
    function drawRag(r) { var a = r.t > 3 ? Math.max(0, 1 - (r.t - 3)) : 1, J = {}; for (var k in r.pts) J[k] = r.pts[k]; drawMan(J, r.team, false, null, 0, a); }
    function draw() {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
      if (shk > 0) ctx.translate((Math.random() - 0.5) * shk * 2, (Math.random() - 0.5) * shk * 2);
      decals.forEach(function (d) { ctx.globalAlpha = Math.min(1, d.t / 3) * 0.85; ctx.fillStyle = '#991b1b'; ctx.beginPath(); ctx.ellipse(d.x, d.y - 0.5, d.r * 1.8, d.r * 0.55, 0, 0, 7); ctx.fill(); }); ctx.globalAlpha = 1;
      rags.forEach(drawRag);
      if (third) drawFighter(third); if (foe) drawFighter(foe); if (hero) drawFighter(hero);
      arrows.forEach(function (a) {
        var ang2 = Math.atan2(a.vy, a.vx), len = 14; ctx.globalAlpha = a.stuck ? Math.min(1, a.stuck) : 1;
        ctx.strokeStyle = '#d6d3d1'; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(a.x - Math.cos(ang2) * len, a.y - Math.sin(ang2) * len); ctx.stroke();
        ctx.fillStyle = '#a8a29e'; ctx.beginPath(); ctx.moveTo(a.x + Math.cos(ang2) * 3, a.y + Math.sin(ang2) * 3); ctx.lineTo(a.x - Math.sin(ang2) * 2, a.y + Math.cos(ang2) * 2); ctx.lineTo(a.x + Math.sin(ang2) * 2, a.y - Math.cos(ang2) * 2); ctx.fill();
        ctx.strokeStyle = '#8f2a2a'; ctx.beginPath(); ctx.moveTo(a.x - Math.cos(ang2) * (len - 2), a.y - Math.sin(ang2) * (len - 2)); ctx.lineTo(a.x - Math.cos(ang2) * len - Math.sin(ang2) * 2, a.y - Math.sin(ang2) * len + Math.cos(ang2) * 2); ctx.stroke();
        ctx.globalAlpha = 1;
      });
      fx.forEach(function (p) {
        var a = p.t / p.T; ctx.globalAlpha = Math.max(0, Math.min(1, a));
        if (p.k === 'blood') { ctx.fillStyle = '#b91c1c'; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill(); }
        else if (p.k === 'sweat') { ctx.fillStyle = '#bfdbfe'; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill(); }
        else if (p.k === 'spark') { ctx.fillStyle = p.c; ctx.fillRect(p.x - 1, p.y - 1, 2.2, 2.2); }
        else if (p.k === 'smoke' || p.k === 'dust') { ctx.fillStyle = p.k === 'smoke' ? p.c : 'rgba(160,150,140,.7)'; ctx.globalAlpha *= 0.6; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (1.6 - a), 0, 7); ctx.fill(); }
        else if (p.k === 'shock') { ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = 1.4; for (var sI = 0; sI < 10; sI++) { var aS = sI * 0.628 + p.x; ctx.beginPath(); ctx.moveTo(p.x + Math.cos(aS) * (8 + (1 - a) * 10), p.y + Math.sin(aS) * (8 + (1 - a) * 10)); ctx.lineTo(p.x + Math.cos(aS) * (16 + (1 - a) * 22), p.y + Math.sin(aS) * (16 + (1 - a) * 22)); ctx.stroke(); } }
        else if (p.k === 'ring') { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x, p.y, 4 + (1 - a) * 15, 0, 7); ctx.stroke(); }
        else if (p.k === 'dent') { ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.lineWidth = 1; for (var i = 0; i < 6; i++) { var an = i * 1.05 + 0.3; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + Math.cos(an) * (6 + (1 - a) * 8), p.y + Math.sin(an) * (6 + (1 - a) * 8)); ctx.stroke(); } }
        else if (p.k === 'whoosh') { ctx.strokeStyle = 'rgba(226,232,240,.7)'; ctx.lineWidth = 1.2; for (var wI = 0; wI < 3; wI++) { ctx.beginPath(); ctx.arc(p.x, p.y + wI * 6, 10 + wI * 3 + (1 - a) * 6, p.dir > 0 ? -0.9 : Math.PI - 0.9, p.dir > 0 ? 0.9 : Math.PI + 0.9); ctx.stroke(); } }
        else if (p.k === 'star') { ctx.strokeStyle = '#fde047'; ctx.lineWidth = 2; for (var j = 0; j < 8; j++) { var an2 = j * Math.PI / 4; ctx.beginPath(); ctx.moveTo(p.x + Math.cos(an2) * 3, p.y + Math.sin(an2) * 3); ctx.lineTo(p.x + Math.cos(an2) * (j % 2 ? 9 : 14), p.y + Math.sin(an2) * (j % 2 ? 9 : 14)); ctx.stroke(); } }
      });
      ctx.globalAlpha = 1;
    }
    // ---- v7: written fights. Two (or three) on one ledge: the fight plays from a script. Every blow lands at its
    //   moment and the other side's answer (block, parry, duck, take it, go down, fly) is timed to it, like a film.
    function gone(m) {
      if (m === foe) { foe = third; third = null; kills++; if (!foe) nextFoeT = 1.6 + Math.random(); }
      else if (m === third) { third = null; kills++; }
      m.cho = 0;
    }
    function free3(m) { return m && !m.dying && m.hp > 0 && m.on && !m.cho && ['idle', 'run', 'walk', 'guard', 'taunt', 'land', 'look', 'block', 'hit'].indexOf(m.st) >= 0; }
    function tryCho() {
      if (cho || choCd > 0 || !free3(hero) || ['chase', 'ambush', 'breather', 'retreat'].indexOf(scene.name) >= 0) return;
      var pl = hero.on, w = pl.x1 - pl.x0; if (w < 90 || nearBlock(hero.x, hero.y)) return;
      var near = function (m, d) { return free3(m) && m.on === pl && Math.abs(m.x - hero.x) < d; };
      var b = near(foe, 110) ? foe : near(third, 110) ? third : null; if (!b) return;
      startCho(b, b === foe && w >= 150 && near(third, 220) ? third : null);
    }
    function startCho(b, c) {
      var pl = hero.on, list = c ? SC3 : SC2, n, key;
      do { n = Math.floor(Math.random() * list.length); key = (c ? 'c' : 'b') + n; } while (list.length > 1 && key === lastCho);
      lastCho = key;
      var side = b.x >= hero.x ? 1 : -1, ax, bx, cx = 0;
      if (c) { ax = Math.max(pl.x0 + 44, Math.min(pl.x1 - 44, hero.x)); bx = ax + side * 38; cx = ax - side * 38; }
      else {
        var mid = (hero.x + b.x) / 2; ax = mid - side * 19; bx = mid + side * 19;
        var sh = Math.max(0, pl.x0 + 8 - Math.min(ax, bx)) - Math.max(0, Math.max(ax, bx) - (pl.x1 - 8)); ax += sh; bx += sh;
      }
      cho = { a: hero, b: b, c: c, pl: pl, beats: list[n], t: 0, setup: 0.9, i: 0, tempo: mode === 'calm' ? 1.35 : 1 };
      [[hero, ax], [b, bx], [c, cx]].forEach(function (q) { var m = q[0]; if (!m) return; m.cho = 1; begin(m, 'cho'); m.mv = null; m.re = null; m.yo = 0; m.vx = 0; m.vy = 0; m.cgo = q[1]; m.flip = 0; m.spin = 0; });
      schedule();
    }
    function schedule() {
      var T = 0.35 + (Math.random() < 0.35 ? 0.4 : 0), prev = null;   // a moment of staring each other down first
      cho.q = [];
      cho.beats.forEach(function (bt) {
        var o = bt[4] || {}, M = MV[bt[1]], R = REACT[bt[3]] || {};
        var st = o.with && prev ? prev.st + (o.off || 0) * cho.tempo : T + (o.gap || 0) * cho.tempo;
        var q = { st: st, by: bt[0], mv: bt[1], to: bt[2], re: bt[3], o: o }; cho.q.push(q);
        var end = st + M.d * 0.8 * cho.tempo;
        if (bt[2] && M.hit) end = Math.max(end, st + (M.hit + (R.d || 0.25) * 0.6) * cho.tempo);
        if (bt[3] === 'slam') end = st + (M.hit + 0.85) * cho.tempo;
        if (bt[3] === 'down') end = st + (M.hit + 0.5) * cho.tempo;
        T = Math.max(T, end); prev = q;
      });
      cho.end = T + 0.5;
    }
    function inCho() { return cho ? [cho.a, cho.b, cho.c].filter(function (m) { return m && m.cho; }) : []; }
    function nearestIn(m) {
      var best = null, bd = 1e9;
      inCho().forEach(function (o) { if (o === m || (m !== hero && o !== hero)) return; var d = Math.abs(o.x - m.x); if (d < bd) { bd = d; best = o; } });
      return best;
    }
    function endCho() {
      if (!cho) return;
      inCho().forEach(function (m) {
        m.cho = 0; m.mv = null; m.yo = 0; m.walking = 0; m.vx = 0;
        if (m.re && m.re.name === 'down') { m.down = 1; begin(m, 'land'); } else begin(m, 'guard');
        m.re = null; m.think = 0.3;
      });
      cho = null; choCd = 2.5 + Math.random() * 3;
    }
    function tickCho(dt) {
      if (!cho) return;
      var ms = inCho();
      if (ms.length < 2 && !ms.some(function (m) { return m.mv || (m.re && m.re.name !== 'down'); })) { endCho(); return; }
      if (ms.some(function (m) { return nearBlock(m.x, m.y); })) { endCho(); return; }
      if (cho.setup > 0) {   // walk into place
        cho.setup -= dt; var all = true;
        ms.forEach(function (m) { var d = m.cgo - m.x; if (Math.abs(d) > 2) { all = false; m.x += (d > 0 ? 1 : -1) * Math.min(Math.abs(d), 240 * dt); m.walking = 1; } else m.walking = 0; });
        if (!all && cho.setup > 0) return;
        ms.forEach(function (m) { m.walking = 0; }); cho.setup = 0;
      }
      cho.t += dt;
      while (cho.i < cho.q.length && cho.q[cho.i].st <= cho.t) fire(cho.q[cho.i++]);
      if (cho.i >= cho.q.length && cho.t > cho.end && !ms.some(function (m) { return m.mv || (m.re && m.re.name !== 'down'); })) endCho();
    }
    function fire(q) {
      var m = cho[q.by], tg = q.to ? cho[q.to] : null, M = MV[q.mv];
      if (!m || !m.cho || (q.to && (!tg || !tg.cho))) return;
      if (m.re && m.re.name === 'down') return;              // still on the floor: his line is skipped
      m.re = null;
      var side = m.dir || 1, lunge = 0;
      if (tg) {
        side = tg.x >= m.x ? 1 : -1; var dist = Math.abs(tg.x - m.x);
        lunge = side * (q.o.pass ? dist + 26 : dist - (M.r || 20));
        if (tg.re && tg.re.name === 'down') lunge = side * (dist - 10);
      } else if (M.back) lunge = -side * M.back;
      else { var o2 = nearestIn(m); if (o2) { side = o2.x >= m.x ? 1 : -1; if (q.mv === 'step') lunge = side * Math.max(0, Math.abs(o2.x - m.x) - 36); } }
      m.dir = side;
      m.mv = { mv: q.mv, t: 0, x0: m.x, lunge: lunge, to: tg, re: q.re, o: q.o, dir: side, done: 0, early: 0 };
    }
    function hpLoss(m, d) { if (m === hero) m.sta = Math.max(0, m.sta - d * 1.2); else m.hp = Math.max(1, m.hp - d); }   // only the last blow of a fight can kill
    function whoosh(m) { fx.push({ k: 'whoosh', x: m.x + m.dir * 16, y: m.y - 32 + (m.yo || 0), dir: m.dir, t: 0.18, T: 0.18 }); }
    function react(m, tg, re, o) {
      var R = REACT[re] || REACT.hit, side = tg.x >= m.x ? 1 : -1; o = o || {};
      if (!tg.cho) return;
      if (tg.re && tg.re.name === 'down' && re !== 'fling' && re !== 'slam') {   // hit while down: he stays down a little longer
        tg.re.t = Math.max(0, tg.re.t - 0.35); hpLoss(tg, 8); bleed(tg.x - tg.dir * 14, tg.y - 5, side, 10); dust(tg.x, tg.y, 6); freeze(0.06); shake(3);
        fx.push({ k: 'ring', x: tg.x - tg.dir * 10, y: tg.y - 5, t: 0.2, T: 0.2 }); if (o.slow) slowT = o.slow; return;
      }
      if (o.slow) slowT = o.slow;
      var hx = tg.x - side * 5, hy = tg.y - (re === 'gut' ? 22 : re === 'down' ? 26 : 38);
      if (re === 'fling') {
        tg.cho = 0; tg.mv = null; tg.re = null; tg.yo = 0;
        if (tg !== hero) tg.hp -= o.dmg || R.dmg; else tg.sta -= R.dmg;
        bleed(hx, hy, side, R.blood); spark(hx, hy, 12);
        fx.push({ k: 'star', x: hx, y: hy, t: 0.16, T: 0.16 }); fx.push({ k: 'shock', x: hx, y: hy, t: 0.3, T: 0.3 }); fx.push({ k: 'ring', x: hx, y: hy, t: 0.25, T: 0.25 });
        freeze(0.12); shake(6);
        fling(tg, side * (R.kb + Math.random() * 220), -(R.up + Math.random() * 160));
        if (tg !== hero && tg.hp <= 0) setTimeout(function () { tg.dying = 1; }, 60);
        return;
      }
      if (re === 'slam') { tg.mv = null; tg.re = { name: 'slam', t: 0, d: R.d, by: m, side: side, o: o }; spark(hx, hy, 4); return; }
      tg.mv = null; tg.yo = 0;
      tg.re = { name: re, t: 0, d: R.d, kbv: side * (R.kb || 0) / 0.15, from: m };
      if (re === 'down') { tg.dir = -side; dust(tg.x, tg.y, 10); shake(4); }
      if (R.dmg) {
        hpLoss(tg, o.dmg || R.dmg); tg.flash = 0.08;
        bleed(hx, hy, side, R.blood || 6); spark(hx, hy, R.heavy ? 10 : 6); fx.push({ k: 'ring', x: hx, y: hy, t: 0.2, T: 0.2 });
        if (R.heavy) { fx.push({ k: 'star', x: hx, y: hy, t: 0.14, T: 0.14 }); fx.push({ k: 'shock', x: hx, y: hy, t: 0.25, T: 0.25 }); freeze(0.08); shake(4); } else freeze(0.04);
      } else if (re === 'block' || re === 'parry') {
        spark(tg.x - side * 8, tg.y - 32, re === 'parry' ? 12 : 7, re === 'parry' ? '#fde68a' : '#fff'); freeze(re === 'parry' ? 0.05 : 0.025);
        if (re === 'parry') fx.push({ k: 'ring', x: tg.x - side * 8, y: tg.y - 32, t: 0.18, T: 0.18 });
      }
    }
    function slamDown(m, r) {
      m.re = { name: 'down', t: 0, d: REACT.down.d, kbv: 0, from: r.by }; m.dir = r.by.x >= m.x ? 1 : -1;
      hpLoss(m, REACT.slam.dmg); shake(7); freeze(0.1); dust(m.x, m.y, 16);
      fx.push({ k: 'ring', x: m.x, y: m.y - 4, t: 0.3, T: 0.3 }); fx.push({ k: 'shock', x: m.x, y: m.y - 6, t: 0.3, T: 0.3 });
      bleed(m.x - m.dir * 20, m.y - 6, -m.dir, 14);
      if (r.o && r.o.slow) slowT = r.o.slow;
    }
    function stepCho(m, dt) {
      if (!cho) { m.cho = 0; begin(m, 'guard'); return; }
      var ox = m.x, pl = cho.pl;
      if (m.walking) m.ph += dt * 9;
      if (m.mv) {
        var mv = m.mv, M = MV[mv.mv], R = REACT[mv.re] || {};
        mv.t += dt; m.dir = mv.dir;
        m.x = mv.x0 + mv.lunge * ease(Math.min(1, mv.t / (M.hit || M.d)));
        var arc = M.hop || (M.back ? 30 : 0); m.yo = arc ? -Math.sin(Math.PI * Math.min(1, mv.t / M.d)) * arc : 0;
        if (mv.to && R.early && !mv.early && mv.t >= (M.hit || 0) * 0.3) { mv.early = 1; react(m, mv.to, mv.re, mv.o); }
        if (mv.to && M.hit && !mv.done && mv.t >= M.hit) { mv.done = 1; if (!R.early) react(m, mv.to, mv.re, mv.o); else whoosh(m); }
        if (mv.t >= M.d) { m.mv = null; m.yo = 0; }
      }
      if (m.re) {
        var r = m.re; r.t += dt;
        if (r.name === 'slam') {   // lifted over his head and smashed down on the other side
          var k = Math.min(1, r.t / r.d);
          m.x = r.by.x + r.side * Math.cos(Math.PI * k) * 22; m.yo = -Math.sin(Math.PI * k) * 44;
          if (r.t >= r.d) { m.x = r.by.x - r.side * 24; m.yo = 0; slamDown(m, r); }
        } else {
          if (r.t < 0.15 && r.kbv) m.x += r.kbv * dt;
          if (r.from && r.name !== 'down') m.dir = r.from.x >= m.x ? 1 : -1;
          if (r.t >= r.d) m.re = null;
        }
      }
      m.x = Math.max(pl.x0 + 3, Math.min(pl.x1 - 3, m.x));
      if (!m.mv && !m.re && !m.walking) { var o = nearestIn(m); if (o) m.dir = o.x >= m.x ? 1 : -1; }
      if (m.walking && m.cgo !== undefined) m.dir = m.cgo >= m.x ? 1 : -1;
      m.vx = (m.x - ox) / Math.max(dt, 0.001); m.vy = 0;
    }
    function walkPose(w) { return { L: 12, hy: 19, sF: 55 - w * 15, eF: 110, sB: 40 + w * 15, eB: 120, hF: 18 + 28 * w, kF: -25 - 25 * Math.max(0, -w), hB: 12 - 28 * w, kB: -25 - 25 * Math.max(0, w) }; }
    function choPose(m) {
      var r = m.re;
      if (r) {
        if (r.name === 'slam') return P.fall;
        if (r.name === 'down') { var left = r.d - r.t; return left < 0.4 ? mix(P.land, P.lie, ease(left / 0.4)) : P.lie; }
        var R = REACT[r.name], tp = P[R.p] || P.hurt, k = r.t < 0.06 ? r.t / 0.06 : r.t > r.d * 0.6 ? 1 - ease((r.t - r.d * 0.6) / (r.d * 0.4)) : 1;
        return mix(P.guard, tp, k);
      }
      if (m.mv) {
        var mv = m.mv, M = MV[mv.mv], t = mv.t;
        if (mv.mv === 'step') return walkPose(Math.sin(t * 22));
        if (M.back) return t < 0.1 ? mix(P.guard, P.land, t / 0.1) : t < M.d - 0.1 ? P.air : mix(P.air, P.land, Math.min(1, (t - M.d + 0.1) / 0.1));
        if (mv.mv === 'slam') return t < M.hit ? mix(P.guard, P.grab, ease(t / M.hit)) : t < 0.5 ? mix(P.grab, P.toss, ease((t - M.hit) / 0.3)) : mix(P.toss, P.guard, ease((t - 0.5) / 0.25));
        if (mv.mv === 'axe') return t < M.hit ? mix(P.guard, P.axe, ease(t / M.hit)) : mix(P.stomp, P.guard, ease((t - M.hit) / (M.d - M.hit)));
        var k2 = !M.hit ? Math.sin(Math.PI * Math.min(1, t / M.d)) : t < M.hit ? ease(t / M.hit) * 0.6 : t < M.hit + 0.08 ? 1 : 1 - ease((t - M.hit - 0.08) / Math.max(0.05, M.d - M.hit - 0.08));
        return mix(P.guard, P[M.p], k2);
      }
      if (m.walking) return walkPose(Math.sin(m.ph));
      var b = Math.sin(now * 6 + m.x) * 1.2; return { L: 8, hy: 19 + b, sF: 58, eF: 118, sB: 42, eB: 126, hF: 32, kF: -48 - b * 3, hB: -26, kB: -34 - b * 3 };
    }
    function choAng(m) {
      var r = m.re;
      if (r && r.name === 'down') { var left = r.d - r.t; return { a: -Math.PI / 2 * m.dir * (left < 0.4 ? ease(left / 0.4) : 1), c: { x: m.x, y: m.y - 3 } }; }
      if (r && r.name === 'slam') return { a: -r.side * Math.PI * Math.min(1, r.t / r.d), c: null };
      if (m.mv) {
        var M = MV[m.mv.mv], k = Math.min(1, m.mv.t / M.d);
        if (M.back) return { a: -m.dir * Math.PI * 2 * ease(k), c: null };
        if (M.spin) return { a: m.dir * Math.PI * 0.5 * M.spin * Math.sin(Math.PI * k), c: null };
      }
      return { a: 0, c: null };
    }
    // the third man: bigger, purple, drops in from the top near the ninja
    function bringThird() {
      if (!hero || !hero.on) return;
      var x = Math.max(M, Math.min(W - M, hero.x + (Math.random() < 0.5 ? -1 : 1) * (120 + Math.random() * 120)));
      var m = make('red', x, -50, null); m.sz = 1.12; m.hp = 85; m.big = 1;
      var cand = plats.filter(function (p) { return !p.ground && p.x1 - p.x0 > 60 && Math.abs(p.y - hero.y) < 160 && !nearBlock((p.x0 + p.x1) / 2, p.y); });
      cand.sort(function (a, b) { return Math.abs((a.x0 + a.x1) / 2 - hero.x) - Math.abs((b.x0 + b.x1) / 2 - hero.x); });
      var p = cand[0] || hero.on;
      jumpTo(m, spot(null, p, hero.x + (x > hero.x ? 50 : -50)), p.y, false, p, 0.75);
      third = m;
    }
    function bringFoe() {
      // the next one leaps in from the far side of the screen
      var r = Math.random(), fromLeft = r < 0.4, fromTop = r >= 0.8;
      var m = make('foe', fromTop ? M + (W - 2 * M) * Math.random() : fromLeft ? -30 : W + 30, fromTop ? -40 : 80 + Math.random() * Math.max(40, H * 0.45), null);
      m.dir = fromLeft ? 1 : -1;
      var land = plats.filter(function (p) { return !p.ground && (fromTop ? Math.abs((p.x0 + p.x1) / 2 - m.x) < 300 : fromLeft ? p.x0 < W * 0.35 : p.x1 > W * 0.65) && !nearBlock((p.x0 + p.x1) / 2, p.y); });
      var p = land.length ? land[Math.floor(Math.random() * land.length)] : plats[plats.length - 1];
      jumpTo(m, spot(null, p, fromLeft ? p.x0 + 30 : p.x1 - 30), p.y, true, p);
      foe = m; thirdT = Math.random() < 0.6 ? 4 + Math.random() * 6 : -1; setScene(Math.random() < 0.6 ? 'standoff' : 'duel', 3 + Math.random() * 2);
    }
    function tick(t) {
      if (!on) return;
      raf = requestAnimationFrame(tick);
      var dt = Math.min(0.05, (t - last) / 1000 || 0); last = t; acc += dt;
      if (acc < 1 / 45) return;
      dt = Math.min(0.05, acc) * 0.7; acc = 0; now += dt;
      if (slowT > 0) { slowT -= dt; dt *= 0.3; }   // slow motion on the big blows
      scanT -= dt; if (scanT <= 0) { scanT = 0.5; scan(); }
      if (!hero) { var ok = plats.filter(function (p) { return !p.ground && p.x1 - p.x0 > 40 && !nearBlock((p.x0 + p.x1) / 2, p.y); }); var p = ok.length ? ok[Math.floor(Math.random() * ok.length)] : plats[plats.length - 1]; hero = make('hero', (p.x0 + p.x1) / 2, p.y, p); smoke(hero.x, hero.y - 20, '#fde047'); }
      if (!foe) { nextFoeT -= dt; if (nextFoeT <= 0) bringFoe(); }
      if (foe && !third && thirdT > 0) { thirdT -= dt; if (thirdT <= 0) bringThird(); }
      shk = Math.max(0, shk - dt * 20);
      if (frozen > 0) { frozen -= dt; draw(); return; }      // the hit-stop: a heartbeat of stillness on a hard hit
      direct(dt); choCd -= dt; tryCho(); tickCho(dt);
      step(hero, dt); step(foe, dt); step(third, dt); stepArrows(dt);
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
      stop: function () { arrows = []; on = false; cancelAnimationFrame(raf); ctx.clearRect(0, 0, W, H); cv.style.display = 'none'; hero = null; foe = null; third = null; cho = null; slowT = 0; rags = []; fx = []; decals = []; nextFoeT = 1; },
      mode: function (m) { mode = m; },
      blood: function (b) { blood = !!b; if (!blood) decals = []; },
      running: function () { return on; },
      _s: function () { return { scene: scene, cho: cho, third: third, arrows: arrows, hero: hero, foe: foe, plats: plats, rags: rags, decals: decals, kills: kills, links: links }; }
    };
    document.addEventListener('mousemove', onMove, { passive: true });
    document.addEventListener('mouseleave', onLeave);
    window.addEventListener('scroll', onScroll, { passive: true, capture: true });
    window.addEventListener('resize', onResize);
    size();
    return api;
  };
})();
