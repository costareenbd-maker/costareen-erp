/*
 * Costareen Brawl v2 - a small fighting game for the strip under New invoice.
 * One player against the computer; each win brings a harder opponent, the last one is the Spaghetti Monster.
 * Loaded only when its tab is opened. The fighters' faces are not in this file: they come from the
 * business's own data (erpFighters), so nobody's photo sits in a public file.
 *
 * Units: the arena is 128 units high, the floor at 120 from the top; x grows to the right, y grows UP from the floor.
 * Bodies are skeletons (torso, two arms, two legs) posed by joint angles and tweened between key poses.
 */
(function () {
  'use strict';
  var MOVES = {
    whip: ['Filament Whip', 'a long lash of hot filament: hits from far away'],
    spool: ['Spool Throw', 'a spool rolls along the floor at the enemy'],
    dash: ['Hot Nozzle Dash', 'a burning dash punch across the floor: knocks down'],
    resin: ['Resin Splash', 'a sticky blob: the puddle slows the enemy'],
    wall: ['Layer Wall', 'prints a wall in front of you that stops attacks'],
    pillars: ['Support Pillars', 'support pillars print up under the enemy and throw him up'],
    laser: ['Laser Engraver', 'a laser beam across the whole floor'],
    slam: ['Heated Bed Slam', 'jump and slam the floor: a shockwave both ways'],
    flurry: ['Speed Print 300', 'a storm of very fast punches']
  };
  var OUT = '#141016', PANTS = '#2b3044', BOOT = '#16131a';
  var FIL = ['#ef4444', '#3b82f6', '#22c55e', '#eab308', '#f97316', '#a855f7', '#f1f5f9'];
  var WORDS_HIT = ['POW!', 'BAM!', 'WHAM!', 'THUD!', 'KRAK!', 'BOOM!'];

  function headCanvas(hd) {
    var c = document.createElement('canvas'); c.width = hd.w; c.height = hd.h;
    var x = c.getContext('2d');
    for (var i = 0; i < hd.px.length; i++) {
      var ch = hd.px.charAt(i); if (ch === '.') continue;
      x.fillStyle = hd.pal[parseInt(ch, 16)]; x.fillRect(i % hd.w, Math.floor(i / hd.w), 1, 1);
    }
    return c;
  }
  function skinOf(hd) {
    var i = Math.floor(hd.h * 0.62) * hd.w + Math.floor(hd.w * 0.3), ch = hd.px.charAt(i);
    return ch === '.' ? '#b07a5a' : hd.pal[parseInt(ch, 16)];
  }
  function plainHead(skin, hair) {
    var w = 28, h = 34, px = '';
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var e = Math.pow((x - 13.5) / 13, 2) + Math.pow((y - 17) / 16.5, 2), c = '.';
      if (e < 1) c = y < 10 || (y < 15 && (x < 5 || x > 22)) ? '2' : '1';
      if (e < 1 && e > 0.86) c = '0';
      if ((y === 15 || y === 16) && (x === 9 || x === 18)) c = '0';
      if (y === 25 && x > 10 && x < 17) c = '0';
      px += c;
    }
    return { w: w, h: h, pal: [OUT, skin, hair], px: px };
  }
  var PLAIN = [
    { name: 'Karim', move: 'whip', color: '#3b82f6', head: plainHead('#c68b63', '#2a1d18') },
    { name: 'Hasan', move: 'spool', color: '#f97316', head: plainHead('#a86f4c', '#1b1412') },
    { name: 'Rumi', move: 'laser', color: '#22c55e', head: plainHead('#d09a74', '#3a2a20') }
  ];
  var BOSS = { name: 'Spaghetti Monster', move: 'whip', color: '#f59e0b', boss: true };

  // ---- poses: angles in degrees from straight down, positive = towards the enemy
  var P = {
    idle: { L: 6, hy: 29, sF: 38, eF: 108, sB: 18, eB: 118, hF: 22, kF: -30, hB: -14, kB: -18 },
    block: { L: 0, hy: 26, sF: 58, eF: 140, sB: 48, eB: 145, hF: 26, kF: -38, hB: -16, kB: -26 },
    air: { L: 4, hy: 30, sF: 62, eF: 92, sB: 40, eB: 100, hF: 62, kF: -95, hB: 18, kB: -85 },
    hit: { L: -24, hy: 28, sF: -22, eF: 30, sB: -38, eB: 22, hF: 8, kF: -8, hB: -22, kB: -10 },
    charge: { L: 0, hy: 25, sF: 28, eF: -12, sB: 30, eB: -12, hF: 36, kF: -36, hB: -36, kB: -24 },
    win: { L: 0, hy: 30, sF: 172, eF: 12, sB: 20, eB: 110, hF: 12, kF: -6, hB: -10, kB: -4 }
  };
  function mix(a, b, t) { var o = {}; for (var k in a) o[k] = a[k] + (b[k] - a[k]) * t; return o; }
  function over(base, ch) { var o = {}; for (var k in base) o[k] = base[k]; for (var j in ch) o[j] = ch[j]; return o; }
  function ease(t) { return t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t); }
  function keys(t, fr) {    // fr: [[time, pose], ...]
    if (t <= fr[0][0]) return fr[0][1];
    for (var i = 1; i < fr.length; i++) if (t <= fr[i][0]) return mix(fr[i - 1][1], fr[i][1], ease((t - fr[i - 1][0]) / (fr[i][0] - fr[i - 1][0])));
    return fr[fr.length - 1][1];
  }
  var I = P.idle;
  // attacks: timing (start of the hit, its end, the end of the move), reach, damage, push; and their key poses
  var ATK = {
    jab: { start: 0.06, act: 0.1, end: 0.24, reach: 30, dmg: 5, kb: 70, hy: 50, next: 'cross',
      fr: [[0, over(I, { sF: 22, eF: 128, L: 4 })], [0.07, over(I, { sF: 88, eF: 2, L: 16, sB: 10 })], [0.15, over(I, { sF: 88, eF: 4, L: 16, sB: 10 })], [0.24, I]] },
    cross: { start: 0.07, act: 0.11, end: 0.26, reach: 33, dmg: 6, kb: 80, hy: 52, next: 'upper',
      fr: [[0, over(I, { sB: 12, eB: 130, L: 2 })], [0.08, over(I, { sB: 92, eB: 0, L: 24, sF: 26, eF: 125, hF: 32, hB: -24 })], [0.16, over(I, { sB: 92, eB: 0, L: 24, sF: 26, eF: 125, hF: 32, hB: -24 })], [0.26, I]] },
    upper: { start: 0.1, act: 0.12, end: 0.38, reach: 28, dmg: 9, kb: 90, hy: 58, lift: 330, knock: 1, heavy: 1,
      fr: [[0, over(I, { sF: 8, eF: 60, hy: 24, L: 14, hF: 34, kF: -50 })], [0.12, over(I, { sF: 168, eF: 18, hy: 32, L: -6 })], [0.24, over(I, { sF: 170, eF: 14, hy: 32, L: -6 })], [0.38, I]] },
    kick: { start: 0.1, act: 0.11, end: 0.34, reach: 44, dmg: 8, kb: 120, hy: 38, heavy: 1,
      fr: [[0, I], [0.08, over(I, { hF: 86, kF: -112, L: -8, hB: -6, kB: -8 })], [0.14, over(I, { hF: 96, kF: 0, L: -20, hB: -8, kB: -6 })], [0.22, over(I, { hF: 96, kF: 0, L: -20, hB: -8, kB: -6 })], [0.34, I]] },
    sweep: { start: 0.1, act: 0.12, end: 0.42, reach: 46, dmg: 7, kb: 60, hy: 5, low: 1, knock: 1,
      fr: [[0, over(I, { hy: 18, L: 26 })], [0.12, { L: 34, hy: 12, sF: 70, eF: 60, sB: 10, eB: 80, hF: 92, kF: 0, hB: -40, kB: 120 }], [0.28, { L: 34, hy: 12, sF: 70, eF: 60, sB: 10, eB: 80, hF: 92, kF: 0, hB: -40, kB: 120 }], [0.42, I]] },
    airkick: { start: 0.04, act: 0.3, end: 0.4, reach: 38, dmg: 8, kb: 130, hy: 22, heavy: 1, air: 1,
      fr: [[0, P.air], [0.06, { L: -12, hy: 30, sF: 40, eF: 90, sB: 70, eB: 60, hF: 74, kF: 0, hB: -12, kB: -70 }], [0.4, { L: -12, hy: 30, sF: 40, eF: 90, sB: 70, eB: 60, hF: 74, kF: 0, hB: -12, kB: -70 }]] },
    whip: { start: 0.16, act: 0.12, end: 0.46, reach: 100, dmg: 10, kb: 140, hy: 48, heavy: 1, knock: 1,
      fr: [[0, over(I, { sF: -40, eF: 110, L: -6 })], [0.16, over(I, { sF: 100, eF: 0, L: 18 })], [0.32, over(I, { sF: 100, eF: 0, L: 18 })], [0.46, I]] },
    flurry: { start: 0.06, act: 0.5, end: 0.75, reach: 34, dmg: 3, kb: 25, hy: 50, multi: 7 },
    dash: { start: 0.06, act: 0.3, end: 0.5, reach: 26, dmg: 12, kb: 170, hy: 48, heavy: 1, knock: 1,
      fr: [[0, over(I, { L: 20, sF: 10, eF: 120 })], [0.08, over(I, { L: 30, sF: 92, eF: 0, sB: -30, eB: 30, hF: 60, kF: -40, hB: -50, kB: -30 })], [0.4, over(I, { L: 30, sF: 92, eF: 0, sB: -30, eB: 30, hF: 60, kF: -40, hB: -50, kB: -30 })], [0.5, I]] }
  };
  var CAST = [[0, over(I, { sF: -42, eF: 110, sB: -32, eB: 110, L: -6 })], [0.2, over(I, { sF: -46, eF: 116, sB: -36, eB: 116, L: -8 })],
              [0.32, { L: 12, hy: 27, sF: 90, eF: 0, sB: 86, eB: 0, hF: 42, kF: -32, hB: -32, kB: -10 }], [0.9, { L: 12, hy: 27, sF: 90, eF: 0, sB: 86, eB: 0, hF: 42, kF: -32, hB: -32, kB: -10 }]];
  var SLAM = [[0, over(P.air, { sF: 172, eF: 0, sB: 166, eB: 0 })], [0.6, over(P.air, { sF: 172, eF: 0, sB: 166, eB: 0 })]];
  var LAND = { L: 34, hy: 18, sF: 120, eF: 0, sB: 110, eB: 0, hF: 50, kF: -80, hB: -40, kB: -60 };

  window.ERP_FIGHT = function (cv, opts) {
    opts = opts || {};
    var gw = opts.words || function (t) { return t; };
    var roster = (opts.roster && opts.roster.length >= 2 ? opts.roster : PLAIN).map(function (d) {
      return { name: d.name, move: d.move, color: d.color, head: d.head, img: headCanvas(d.head), white: headCanvas({ w: d.head.w, h: d.head.h, pal: ['#ffffff'], px: d.head.px.replace(/[^.]/g, '0') }), skin: skinOf(d.head) };
    });
    var ctx = cv.getContext('2d');
    var g = { mode: 'select', W: 0, H: 0, s: 1, pick: 0, level: 1, opps: [], p: null, c: null, t: 0, paused: false,
      freeze: 0, shake: 0, slow: 1, flash: 0, tut: -1, tutT: 0 };
    var raf = 0, last = 0, dead = false, held = {}, hit = {}, lastTap = {}, fx = [], shots = [], walls = [], puddles = [], pend = [], beams = [], waves = [], pops = [];
    var best = opts.bestGet ? opts.bestGet() : 0, bg = null, now = 0;
    var tutDone = false; try { tutDone = localStorage.getItem('erp_fight_tut') === '1'; } catch (e) {}
    function css(n, f) { var v = getComputedStyle(document.documentElement).getPropertyValue(n).trim(); return v || f; }
    function light() { var s = css('--surface', '#222').replace('#', ''); if (s.length === 3) s = s.replace(/./g, '$&$&'); var n = parseInt(s, 16); return !isNaN(n) && ((n >> 16) * 0.3 + ((n >> 8) & 255) * 0.59 + (n & 255) * 0.11) > 150; }

    g.size = function (w, h) {
      if (w === g.W && h === g.H) return;
      var r = window.devicePixelRatio || 1;
      g.W = w; g.H = h; g.s = h / 128;
      cv.width = Math.round(w * r); cv.height = Math.round(h * r); cv.style.height = h + 'px';
      ctx.setTransform(r, 0, 0, r, 0, 0); ctx.imageSmoothingEnabled = false;
      bg = null;
      if (!loopOn()) draw();
    };
    function AW() { return Math.min(g.W / g.s - 20, 600); }
    function left() { return (g.W / g.s - AW()) / 2; }
    function sx(x) { return (left() + x) * g.s; }
    function sy(y) { return (120 - y) * g.s; }

    // ---- fighters
    function make(def, x, dir, L) {
      var boss = !!def.boss;
      return { def: def, x: x, y: 0, vx: 0, vy: 0, dir: dir, hp: boss ? 170 : 100, max: boss ? 170 : 100, ghost: boss ? 170 : 100, pw: 0,
        st: 'idle', t: 0, atk: null, cd: 0, done: 0, kx: 0, flash: 0, ai: null, mul: 1, L: L || 0, blockT: 0, chargeT: 0,
        queue: null, walkPh: 0, inv: 0, trail: [], downT: 0, ko: false };
    }
    function opp(f) { return f === g.p ? g.c : g.p; }
    function free(f) { return f.st === 'idle' || f.st === 'walk' || f.st === 'block' || f.st === 'charge'; }
    function begin(f, st, atk) { f.st = st; f.t = 0; f.done = 0; f.atk = atk || null; f.queue = null; f.queue2 = null; f.trail = []; }
    function attack(f, name) { begin(f, 'atk', name); if (name === 'dash') dust(f.x, 6); if (f === g.p && name === 'upper') tutMark('combo'); }
    function special(f) {
      if (f.cd > 0) return false;
      f.cd = 2.6;
      var k = f.def.move;
      if (k === 'whip' || k === 'flurry' || k === 'dash') { attack(f, k); return true; }
      begin(f, 'special');
      if (k === 'slam') { f.vy = 360; }
      return true;
    }
    // where the fist / foot of a move lands (for sparks and trails)
    function tip(f) {
      var a = f.atk && ATK[f.atk];
      var y = a ? a.hy : 48, r = a ? Math.min(a.reach, 40) : 24;
      return { x: f.x + f.dir * (10 + r), y: f.y + y };
    }
    function hurt(att, tgt, dmg, kb, o) {
      o = o || {};
      if (tgt.st === 'down' || tgt.st === 'rise' || tgt.inv > 0 || g.mode !== 'fight') return false;
      var blocked = !o.unblockable && tgt.st === 'block';
      if (o.low && tgt.y > 6) return false;            // jumped over a sweep
      var d = Math.round(dmg * att.mul * (blocked ? 0.2 : 1) * 10) / 10;
      tgt.hp = Math.max(g.tut >= 0 && tgt === g.c ? 25 : 0, tgt.hp - d);   // nobody is knocked out during the lesson
      att.pw = Math.min(100, att.pw + (blocked ? 3 : 7 + dmg * 0.5)); tgt.pw = Math.min(100, tgt.pw + 4);
      var at = o.at || { x: (att.x + tgt.x) / 2 + tgt.dir * -4, y: tgt.y + 48 };
      burst(at.x, at.y, blocked ? '#cbd5e1' : att.def.color, o.heavy && !blocked ? 1.5 : 1, blocked);
      pops.push({ x: at.x, y: at.y + 14, t: 0.8, s: blocked ? gw('BLOCK') : '-' + Math.round(d), c: blocked ? '#cbd5e1' : '#fde047', size: 7 });
      if (o.heavy && !blocked) pops.push({ x: at.x + (Math.random() - 0.5) * 20, y: at.y + 30, t: 0.7, s: WORDS_HIT[Math.floor(Math.random() * WORDS_HIT.length)], c: att.def.color, size: 12, word: 1 });
      g.freeze = blocked ? 0.04 : o.heavy ? 0.13 : 0.07;
      g.shake = Math.max(g.shake, blocked ? 1.5 : o.heavy ? 6 : 3);
      if (tgt.hp <= 0) { knock(tgt, att, 300, true); g.mode = 'ko'; g.t = 0; g.slow = 0.35; g.flash = 0.25; g.shake = 10; return true; }
      if (blocked) { tgt.kx = (att.x < tgt.x ? 1 : -1) * kb * 0.5; return true; }
      if (o.knock || o.lift) { knock(tgt, att, o.lift || 220); return true; }
      begin(tgt, 'hit'); tgt.kx = (att.x < tgt.x ? 1 : -1) * kb; tgt.flash = 0.12;
      return true;
    }
    function knock(tgt, att, vy, ko) {
      begin(tgt, 'down'); tgt.vy = vy; tgt.kx = (att.x < tgt.x ? 1 : -1) * 150; tgt.flash = 0.15; tgt.ko = !!ko; tgt.downT = 0;
    }
    function burst(x, y, c, big, soft) {
      fx.push({ kind: 'ring', x: x, y: y, t: 0.25, T: 0.25, c: c, r: (soft ? 6 : 10) * big });
      if (!soft) fx.push({ kind: 'star', x: x, y: y, t: 0.12, T: 0.12, c: '#fff', r: 14 * big });
      for (var i = 0; i < (soft ? 5 : 12 * big); i++) fx.push({ kind: 'dot', x: x, y: y, vx: (Math.random() - 0.5) * 320, vy: Math.random() * 260 - 60, t: 0.45, T: 0.45, c: Math.random() < 0.5 ? c : '#fff' });
    }
    function dust(x, n) { for (var i = 0; i < n; i++) fx.push({ kind: 'dust', x: x + (Math.random() - 0.5) * 14, y: 2, vx: (Math.random() - 0.5) * 90, vy: Math.random() * 30, t: 0.5, T: 0.5, r: 3 + Math.random() * 3 }); }
    function inReach(f, a) {
      var o = opp(f), front = (o.x - f.x) * f.dir, ay = f.y + a.hy;
      return front > -6 && front < 11 + a.reach && ay > o.y - 6 && ay < o.y + 86;
    }

    function stepFighter(f, dt) {
      var o = opp(f), k = f.def.move;
      f.t += dt; f.cd = Math.max(0, f.cd - dt); f.flash = Math.max(0, f.flash - dt); f.inv = Math.max(0, f.inv - dt);
      if (f.ghost > f.hp) f.ghost = Math.max(f.hp, f.ghost - 40 * dt);
      var slow = puddles.some(function (p) { return p.owner !== f && Math.abs(f.x - p.x) < p.w / 2 && f.y === 0; }) ? 0.4 : 1;
      if ((free(f) || f.st === 'win') && f.y === 0) f.dir = o.x >= f.x ? 1 : -1;
      if (f.st === 'atk') {
        var a = ATK[f.atk];
        if (f.atk === 'dash' && f.t > a.start && f.t < a.start + a.act) { f.vx = f.dir * 470; if (Math.random() < 0.6) fx.push({ kind: 'fire', x: f.x - f.dir * 10, y: 20 + Math.random() * 40, vx: -f.dir * 60, vy: 40, t: 0.3, T: 0.3 }); }
        var on = f.t >= a.start && f.t <= a.start + a.act;
        if (on && a.multi) {
          var n = Math.floor((f.t - a.start) / (a.act / a.multi));
          if (n >= f.done && f.done < a.multi) { f.done = n + 1; if (inReach(f, a)) hurt(f, o, a.dmg, a.kb, { at: tip(f) }); }
        } else if (on && !f.done && inReach(f, a)) {
          f.done = 1; hurt(f, o, a.dmg, a.kb, { heavy: a.heavy, knock: a.knock, lift: a.lift, low: a.low, at: tip(f) });
        }
        if ((f.atk === 'jab' || f.atk === 'cross') && f.t > a.start) f.trail.push(tip(f));
        if (f.trail.length > 5) f.trail.shift();
        if (a.air) { if (f.y === 0 && f.t > 0.05) { begin(f, 'idle'); dust(f.x, 4); } }
        else if (f.t > a.end) {
          f.vx = 0;
          if (f.queue && ATK[f.queue]) { var q2 = f.queue2; f.queue2 = null; attack(f, f.queue); f.queue = q2; } else begin(f, 'idle');
        }
      } else if (f.st === 'special') {
        if (k === 'spool' && f.t > 0.3 && !f.done) { f.done = 1; shots.push({ kind: 'spool', owner: f, x: f.x + f.dir * 24, y: 9, vx: f.dir * 330, vy: 0, dmg: 10, spin: 0, trail: [] }); }
        if (k === 'resin' && f.t > 0.3 && !f.done) { f.done = 1; shots.push({ kind: 'resin', owner: f, x: f.x + f.dir * 22, y: 50, vx: f.dir * 250, vy: 140, dmg: 6, trail: [] }); }
        if (k === 'wall' && f.t > 0.3 && !f.done) { f.done = 1; walls.push({ owner: f, x: f.x + f.dir * 44, t: 3.2, h: 0 }); }
        if (k === 'pillars' && f.t > 0.3 && !f.done) { f.done = 1; pend.push({ owner: f, x: o.x, t: 0.5, up: 0 }); }
        if (k === 'laser' && f.t > 0.32 && !f.done) { f.done = 1; beams.push({ owner: f, kind: 'laser', t: 0.22, T: 0.22, dmg: 9, y: 50, hit: 0 }); g.shake = Math.max(g.shake, 2); }
        if (k === 'slam') {
          if (f.t > 0.3 && f.vy > -500 && f.y > 0) f.vy -= 2200 * dt;          // comes down hard
          if (f.y === 0 && f.t > 0.12 && !f.done) { f.done = 1; waves.push({ owner: f, x: f.x, t: 0, hit: 0 }); g.shake = 8; dust(f.x, 14); }
        }
        if (f.t > (k === 'slam' ? 0.9 : 0.75)) begin(f, 'idle');
      } else if (f.st === 'super') {
        if (f.t > 0.6 && !f.done) { f.done = 1; f.pw = 0; beams.push({ owner: f, kind: 'super', t: 0.6, T: 0.6, dmg: 28, y: 50, hit: 0 }); g.shake = 9; g.flash = 0.12; }
        if (f.t > 1.3) begin(f, 'idle');
      } else if (f.st === 'hit') {
        f.vx = f.kx; f.kx *= 0.86;
        if (f.t > 0.3) { begin(f, 'idle'); f.vx = 0; }
      } else if (f.st === 'down') {
        f.vx = f.kx; f.kx *= 0.92;
        if (f.y === 0) { f.downT += dt; if (f.downT < dt * 1.5) { dust(f.x, 8); g.shake = Math.max(g.shake, 3); } }
        if (!f.ko && f.downT > 0.7) { begin(f, 'rise'); f.inv = 0.6; }
      } else if (f.st === 'rise') {
        if (f.t > 0.35) begin(f, 'idle');
      } else if (f.st === 'charge') {
        f.pw = Math.min(100, f.pw + 32 * dt);
        if (Math.random() < 0.5) fx.push({ kind: 'spark', x: f.x + (Math.random() - 0.5) * 40, y: Math.random() * 20, vx: 0, vy: 120 + Math.random() * 80, t: 0.5, T: 0.5, c: f.def.color });
      } else if (f.st === 'walk') {
        f.walkPh += dt * 9 * slow;
      }
      if (f.st !== 'walk' && f.st !== 'hit' && f.st !== 'down' && !(f.st === 'atk' && f.atk === 'dash') && f.st !== 'dashstep' && f.y === 0) f.vx = 0;
      if (f.st === 'dashstep') { if (f.t > 0.18) begin(f, 'idle'); }
      var nx = f.x + f.vx * dt * (f.st === 'walk' ? slow : 1);
      walls.forEach(function (w) { if (w.owner !== f && w.h > 30 && ((f.x < w.x && nx > w.x - 14) || (f.x > w.x && nx < w.x + 14))) nx = f.x < w.x ? w.x - 14 : w.x + 14; });
      f.x = Math.max(14, Math.min(AW() - 14, nx));
      if (f.y > 0 || f.vy > 0) {
        var wasAir = f.y > 0;
        f.vy -= 1300 * dt; f.y = Math.max(0, f.y + f.vy * dt);
        if (f.y === 0) { f.vy = 0; if (wasAir && f.st !== 'down') dust(f.x, 4); if (f.st === 'air') begin(f, 'idle'); }
      }
      if (Math.abs(f.x - o.x) < 22 && Math.abs(f.y - o.y) < 40 && f.st !== 'down' && o.st !== 'down') f.x = o.x + (f.x <= o.x ? -22 : 22);
      f.x = Math.max(14, Math.min(AW() - 14, f.x));
    }

    // ---- the player's keys
    function player(f) {
      if (f.st === 'charge' && !held.KeyF) begin(f, 'idle');
      if (f.st === 'block' && !held.ArrowDown) begin(f, 'idle');
      // combo: A during a punch queues the next one
      if (f.st === 'atk' && hit.KeyA && ATK[f.atk].next) { if (!f.queue) f.queue = ATK[f.atk].next; else if (ATK[f.queue] && ATK[f.queue].next) f.queue2 = ATK[f.queue].next; }
      if (f.st === 'air' && hit.KeyS) { attack(f, 'airkick'); tutMark('kick'); return; }
      if (f.st === 'air' && hit.KeyA) { attack(f, 'airkick'); return; }
      if (!free(f)) return;
      if (hit.KeyA) { attack(f, 'jab'); tutMark('punch'); return; }
      if (hit.KeyS) { if (held.ArrowDown) { attack(f, 'sweep'); tutMark('kick'); } else { attack(f, 'kick'); tutMark('kick'); } return; }
      if (hit.KeyD && special(f)) { tutMark('special'); return; }
      if (hit.KeyF && f.pw >= 100) { begin(f, 'super'); tutMark('super'); return; }
      if (held.KeyF && f.pw < 100) { if (f.st !== 'charge') begin(f, 'charge'); tutMark('charge'); return; }
      if (held.ArrowDown) { if (f.st !== 'block') begin(f, 'block'); tutMark('block'); return; }
      if (hit.ArrowUp && f.y === 0) { f.vy = 440; f.vx = held.ArrowLeft ? -160 : held.ArrowRight ? 160 : 0; begin(f, 'air'); tutMark('jump'); return; }
      // double tap: a quick dash step
      ['ArrowLeft', 'ArrowRight'].forEach(function (k) {
        if (hit[k]) { if (now - (lastTap[k] || 0) < 0.25) { begin(f, 'dashstep'); f.vx = (k === 'ArrowLeft' ? -1 : 1) * 380; dust(f.x, 5); } lastTap[k] = now; }
      });
      if (f.st === 'dashstep') return;
      if (held.ArrowLeft || held.ArrowRight) { f.st = 'walk'; f.vx = held.ArrowLeft ? -150 : 150; }
      else if (f.st === 'walk') begin(f, 'idle');
    }
    // ---- the computer: quicker, blocks more, combos more and hits harder every level
    function computer(f, dt) {
      var o = g.p, L = f.L, dist = Math.abs(o.x - f.x);
      if (g.tut >= 0) { if (free(f)) { if (dist > 60) { f.st = 'walk'; f.vx = (o.x > f.x ? 1 : -1) * 60; } else begin(f, 'idle'); } return; }   // the lesson: he only walks up
      var react = Math.max(0.12, 0.7 - 0.07 * L), blockP = Math.min(0.7, 0.04 + 0.08 * L), aggr = Math.min(0.92, 0.3 + 0.07 * L), combo = Math.min(0.85, 0.1 + 0.1 * L);
      f.ai = f.ai || { t: 0.4, dir: 0 };
      f.ai.t -= dt;
      if (f.st === 'atk' && ATK[f.atk].next && f.t > ATK[f.atk].start && !f.queue && Math.random() < combo * dt * 12) f.queue = ATK[f.atk].next;
      var attacking = o.st === 'atk' || o.st === 'special' || o.st === 'super';
      if (f.st === 'block') { f.blockT -= dt; if (f.blockT <= 0) begin(f, 'idle'); return; }
      if (f.st === 'charge') { f.chargeT -= dt; if (f.chargeT <= 0 || dist < 90) begin(f, 'idle'); return; }
      if (!free(f)) return;
      if (attacking && dist < 120 && Math.random() < blockP * dt * 7) { begin(f, 'block'); f.blockT = 0.35; return; }
      if (o.st === 'super' && o.t > 0.3 && Math.random() < blockP * dt * 6) { begin(f, 'block'); f.blockT = 0.8; return; }
      if (o.st === 'atk' && o.atk === 'sweep' && Math.random() < blockP) { f.vy = 440; begin(f, 'air'); return; }
      if (f.ai.t > 0) { if (f.st === 'walk') f.vx = f.ai.dir * 150; return; }
      f.ai.t = react * (0.6 + Math.random() * 0.8);
      if (f.pw >= 100 && dist < 330) { begin(f, 'super'); return; }
      var ranged = ['spool', 'laser', 'pillars', 'resin', 'whip'].indexOf(f.def.move) >= 0;
      if (f.cd <= 0 && Math.random() < 0.16 + 0.03 * L && (ranged ? dist < 320 : dist < 90)) { special(f); return; }
      if (dist > 38) {
        if (Math.random() < aggr) { f.st = 'walk'; f.ai.dir = o.x > f.x ? 1 : -1; f.vx = f.ai.dir * 150; }
        else if (f.pw < 100 && dist > 170 && Math.random() < 0.5) { begin(f, 'charge'); f.chargeT = 0.8; }
        else { f.st = 'walk'; f.ai.dir = o.x > f.x ? -1 : 1; f.vx = f.ai.dir * 150; f.ai.t = 0.25; }
      } else {
        var r = Math.random();
        if (r < 0.1 + 0.02 * L) { f.vy = 440; f.vx = f.dir * 120; begin(f, 'air'); return; }
        attack(f, r < 0.55 ? 'jab' : r < 0.82 ? 'kick' : 'sweep');
      }
    }

    // ---- the lesson in the first fight
    var TUT = [
      ['punch', 'Press A to punch'], ['combo', 'Press A three times fast: a 3-hit combo with an uppercut'], ['kick', 'Press S to kick (↓+S sweeps his legs)'],
      ['block', 'Hold ↓ to block'], ['jump', 'Press ↑ to jump (S in the air: flying kick)'], ['special', 'Press D for your special'],
      ['charge', 'Hold F to power up'], ['super', 'Bar full? Press F: Print Blast!']
    ];
    function tutMark(what) {
      if (g.tut < 0) return;
      g.tutDone[what] = 1;
      g.tut = 0; while (g.tut < TUT.length && g.tutDone[TUT[g.tut][0]]) g.tut++;
      if (TUT[g.tut] && TUT[g.tut][0] === 'super') g.p.pw = Math.max(g.p.pw, 100);
      if (g.tut >= TUT.length) endTut();
    }
    function endTut() { g.tut = -1; tutDone = true; try { localStorage.setItem('erp_fight_tut', '1'); } catch (e) {} pops.push({ x: AW() / 2, y: 70, t: 1.4, s: gw('Now fight!'), c: '#ef4444', size: 14, word: 1 }); }

    // ---- flow
    function startRun() {
      var me = roster[g.pick];
      g.opps = roster.filter(function (d) { return d !== me; });
      for (var i = g.opps.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), t = g.opps[i]; g.opps[i] = g.opps[j]; g.opps[j] = t; }
      g.opps.push(BOSS);
      g.level = 1; intro();
    }
    function intro() {
      var me = roster[g.pick], them = g.opps[g.level - 1], L = g.level;
      g.p = make(me, AW() * 0.3, 1); g.c = make(them, AW() * 0.7, -1, L);
      g.c.mul = 0.75 + 0.08 * (L - 1) + (them.boss ? 0.25 : 0);
      shots = []; walls = []; puddles = []; pend = []; beams = []; waves = []; fx = []; pops = [];
      g.tut = !tutDone && L === 1 ? 0 : -1; g.tutDone = {};
      g.mode = 'intro'; g.t = 0; g.slow = 1; run();
    }
    function levels() { return g.opps.length; }
    function step(dt) {
      now += dt;
      if (g.freeze > 0) { g.freeze -= dt; return; }   // key presses wait for the freeze to end
      dt *= g.slow;
      g.t += dt; g.shake = Math.max(0, g.shake - 30 * dt); g.flash = Math.max(0, g.flash - dt);
      if (g.mode === 'intro') { if (g.t > 2) { g.mode = 'fight'; g.t = 0; } }
      if (g.mode === 'fight' || g.mode === 'ko') {
        if (g.mode === 'fight') { player(g.p); computer(g.c, dt); if (g.tut >= 0) g.tutT += dt; }
        stepFighter(g.p, dt); stepFighter(g.c, dt);
        stepThings(dt);
        if (g.mode === 'ko') {
          if (g.t > 1) g.slow = 1;
          var w = g.c.hp <= 0 ? g.p : g.c;
          if (g.t > 1.2 && w.st !== 'win' && free(w)) begin(w, 'win');
          if (g.t > 2.6) {
            if (g.c.hp <= 0) {
              if (g.level > best) { best = g.level; if (opts.bestSet) opts.bestSet(best); }
              if (g.level >= levels()) { g.mode = 'champion'; stopLoop(); draw(); return; }
              g.level++; intro(); return;
            }
            g.mode = 'lost'; stopLoop(); draw(); return;
          }
        }
      }
      fx.forEach(function (p) { p.t -= dt; if (p.vx !== undefined) { p.x += p.vx * dt; p.y += p.vy * dt; if (p.kind === 'dot') p.vy -= 700 * dt; } }); fx = fx.filter(function (p) { return p.t > 0; });
      pops.forEach(function (p) { p.t -= dt; p.y += 22 * dt; }); pops = pops.filter(function (p) { return p.t > 0; });
      hit = {};
    }
    function stepThings(dt) {
      shots = shots.filter(function (s) {
        var o = opp(s.owner);
        s.x += s.vx * dt; s.spin = (s.spin || 0) + dt * 14; s.trail.push({ x: s.x, y: s.y }); if (s.trail.length > 10) s.trail.shift();
        if (s.kind === 'resin') { s.vy -= 700 * dt; s.y += s.vy * dt; if (s.y <= 0) { puddles.push({ owner: s.owner, x: s.x, w: 70, t: 3.2 }); burst(s.x, 4, '#22c55e', 0.8, true); return false; } }
        if (walls.some(function (w) { return w.owner !== s.owner && w.h > 20 && Math.abs(s.x - w.x) < 10; })) { burst(s.x, s.y, '#eab308', 0.8); return false; }
        if (Math.abs(s.x - o.x) < 16 && s.y > o.y - 10 && s.y < o.y + 80) { hurt(s.owner, o, s.dmg, 100, { heavy: 1, at: { x: s.x, y: s.y + 6 } }); return false; }
        return s.x > -20 && s.x < AW() + 20;
      });
      walls.forEach(function (w) { w.t -= dt; w.h = Math.min(62, w.h + 200 * dt); }); walls = walls.filter(function (w) { return w.t > 0; });
      puddles.forEach(function (p) { p.t -= dt; }); puddles = puddles.filter(function (p) { return p.t > 0; });
      pend = pend.filter(function (p) {
        p.t -= dt; var o = opp(p.owner);
        if (p.t <= 0 && !p.fired) { p.fired = true; g.shake = Math.max(g.shake, 4); if (Math.abs(o.x - p.x) < 26 && o.y < 30) hurt(p.owner, o, 12, 20, { lift: 380, heavy: 1, at: { x: o.x, y: 20 } }); }
        if (p.fired) p.up += dt;
        return p.up < 0.6;
      });
      beams = beams.filter(function (b) {
        b.t -= dt; var f = b.owner, o = opp(f);
        if (!b.hit && (o.x - f.x) * f.dir > 0 && o.y < (b.kind === 'super' ? 75 : 36)) { b.hit = 1; hurt(f, o, b.dmg, b.kind === 'super' ? 240 : 90, { heavy: 1, knock: b.kind === 'super', at: { x: o.x - f.dir * 8, y: o.y + b.y } }); }
        return b.t > 0;
      });
      waves = waves.filter(function (w) {
        w.t += dt; var o = opp(w.owner), r = 26 + w.t * 380;
        if (!w.hit && o.y === 0 && Math.abs(o.x - w.x) < r && Math.abs(o.x - w.x) > r - 60) { w.hit = 1; hurt(w.owner, o, 11, 120, { knock: 1, heavy: 1, at: { x: o.x, y: 12 } }); }
        return w.t < 0.4;
      });
    }

    // ---- loop
    function loopOn() { return g.mode === 'intro' || g.mode === 'fight' || g.mode === 'ko'; }
    function tick(t) {
      if (dead || g.paused || !loopOn()) return;
      var dt = Math.min(0.05, (t - last) / 1000 || 0); last = t;
      step(dt); draw();
      if (loopOn() && !g.paused) raf = requestAnimationFrame(tick);
    }
    function run() { g.paused = false; last = performance.now(); cancelAnimationFrame(raf); raf = requestAnimationFrame(tick); }
    function stopLoop() { cancelAnimationFrame(raf); }

    // ---- the body: pose -> joints
    function poseOf(f) {
      var k = f.def.move, b = now * 4;
      switch (f.st) {
        case 'walk': var ph = f.walkPh, sn = Math.sin(ph);
          return { L: 8, hy: 29 + Math.abs(Math.sin(ph)) * 1.5, sF: 36 + sn * 10, eF: 104, sB: 16 - sn * 10, eB: 116, hF: 10 + 28 * sn, kF: -18 - 22 * Math.max(0, -sn), hB: 6 - 28 * sn, kB: -18 - 22 * Math.max(0, sn) };
        case 'block': return P.block;
        case 'air': return P.air;
        case 'hit': return mix(P.hit, I, ease(f.t / 0.3));
        case 'charge': return over(P.charge, { sF: 28 + Math.sin(b * 3) * 4, sB: 30 - Math.sin(b * 3) * 4 });
        case 'win': return over(P.win, { hy: 30 + Math.abs(Math.sin(b)) * 2 });
        case 'dashstep': return over(I, { L: 18 });
        case 'atk':
          var a = ATK[f.atk];
          if (f.atk === 'flurry') { var ph2 = Math.floor(f.t * 30) % 2; return over(I, ph2 ? { sF: 90, eF: 0, sB: 20, eB: 120, L: 16 } : { sB: 90, eB: 0, sF: 30, eF: 120, L: 18 }); }
          return a.fr ? keys(f.t, a.fr) : I;
        case 'special': return k === 'slam' ? (f.y > 0 ? keys(f.t, SLAM) : LAND) : keys(f.t, CAST);
        case 'super': return keys(f.t * 0.6, CAST);
        default: return over(I, { hy: 29 + Math.sin(b) * 0.8, L: 6 + Math.sin(b) * 1 });
      }
    }
    function rad(a) { return a * Math.PI / 180; }
    function joints(p) {
      var hip = { x: 0, y: p.hy }, L = rad(p.L);
      var neck = { x: hip.x + Math.sin(L) * 24, y: hip.y + Math.cos(L) * 24 };
      var sh = { x: hip.x + Math.sin(L) * 20, y: hip.y + Math.cos(L) * 20 };
      function limb(o, a1, a2, l1, l2) {
        var m = { x: o.x + Math.sin(rad(a1)) * l1, y: o.y - Math.cos(rad(a1)) * l1 };
        var e = { x: m.x + Math.sin(rad(a1 + a2)) * l2, y: m.y - Math.cos(rad(a1 + a2)) * l2 };
        return [o, m, e, a1 + a2];
      }
      return { hip: hip, neck: neck, L: p.L,
        aF: limb({ x: sh.x + 2, y: sh.y }, p.sF, p.eF, 12, 12), aB: limb({ x: sh.x - 2, y: sh.y }, p.sB, p.eB, 12, 12),
        lF: limb({ x: hip.x + 2, y: hip.y }, p.hF, p.kF, 15, 15), lB: limb({ x: hip.x - 2, y: hip.y }, p.hB, p.kB, 15, 15) };
    }
    function drawFighter(f, ghost) {
      var s = g.s, d = f.def, p = poseOf(f), J = joints(p);
      var rot = 0;
      if (f.st === 'down') rot = -Math.min(1, (f.downT > 0 ? 1 : f.t * 3)) * 82;
      if (f.st === 'rise') rot = -82 * (1 - ease(f.t / 0.35));
      var cr = Math.cos(rad(rot)), sr = Math.sin(rad(rot));
      var shk = f.flash > 0 ? (Math.random() - 0.5) * 2 : 0;
      function X(pt) { var x = pt.x * cr - pt.y * sr, y = pt.x * sr + pt.y * cr; return sx(f.x + f.dir * x + shk); }
      function Y(pt) { var x = pt.x * cr - pt.y * sr, y = pt.x * sr + pt.y * cr; return sy(f.y + Math.max(rot ? 3 : -99, y)); }
      function seg(a, b, w, c) { ctx.strokeStyle = c; ctx.lineWidth = w * s; ctx.beginPath(); ctx.moveTo(X(a), Y(a)); ctx.lineTo(X(b), Y(b)); ctx.stroke(); }
      function limb(l, c1, c2, w) { seg(l[0], l[1], w + 2, OUT); seg(l[1], l[2], w + 2, OUT); seg(l[0], l[1], w, c1); seg(l[1], l[2], w - 0.6, c2); }
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      var sh = f.flash > 0 ? '#ffffff' : d.color, sk = f.flash > 0 ? '#ffffff' : d.skin;
      if (ghost) ctx.globalAlpha = ghost;
      // the back arm and leg first
      limb(J.lB, PANTS, PANTS, 7);
      foot(J.lB, X, Y, s);
      limb(J.aB, sh, sk, 6);
      fist(J.aB[2], X, Y, s, sk);
      // torso
      seg(J.hip, J.neck, 17, OUT); seg(J.hip, J.neck, 15, sh);
      ctx.lineCap = 'butt'; seg({ x: J.hip.x, y: J.hip.y }, { x: J.hip.x + Math.sin(rad(J.L)) * 3, y: J.hip.y + Math.cos(rad(J.L)) * 3 }, 15, '#3b2a20'); ctx.lineCap = 'round';
      limb(J.lF, PANTS, PANTS, 7);
      foot(J.lF, X, Y, s);
      // head
      ctx.save();
      ctx.translate(X({ x: J.neck.x, y: J.neck.y + 14 }), Y({ x: J.neck.x, y: J.neck.y + 14 }));
      ctx.rotate(rad(-(rot + J.L * 0.4) * f.dir));
      ctx.scale(f.dir, 1);
      ctx.drawImage(d.img, -12.5 * s, -17 * s, 25 * s, 31 * s);
      if (f.flash > 0) { ctx.globalAlpha = 0.6 * (ghost || 1); ctx.drawImage(d.white, -12.5 * s, -17 * s, 25 * s, 31 * s); }
      ctx.restore();
      if (ghost) ctx.globalAlpha = ghost;
      limb(J.aF, sh, sk, 6);
      fist(J.aF[2], X, Y, s, sk);
      ctx.globalAlpha = 1;
    }
    function fist(pt, X, Y, s, c) { ctx.fillStyle = OUT; ctx.beginPath(); ctx.arc(X(pt), Y(pt), 4.2 * s, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = c; ctx.beginPath(); ctx.arc(X(pt), Y(pt), 3.2 * s, 0, Math.PI * 2); ctx.fill(); }
    function foot(l, X, Y, s) {
      var e = l[2], a = rad(l[3] + 90), t = { x: e.x + Math.sin(a) * 6, y: e.y - Math.cos(a) * 6 };
      ctx.strokeStyle = OUT; ctx.lineWidth = 7 * s; ctx.beginPath(); ctx.moveTo(X(e), Y(e)); ctx.lineTo(X(t), Y(t)); ctx.stroke();
      ctx.strokeStyle = BOOT; ctx.lineWidth = 5 * s; ctx.stroke();
    }
    function drawBoss(f) {
      var s = g.s, t = now * 3, attack = f.st === 'atk' || f.st === 'special' || f.st === 'super';
      var rot = f.st === 'down' ? -Math.min(1, f.t * 3) * 1.3 * f.dir : 0;
      ctx.save(); ctx.translate(sx(f.x), sy(f.y)); ctx.rotate(rot); ctx.scale(f.dir * s, s);
      ctx.lineCap = 'round';
      for (var i = 0; i < 11; i++) {
        ctx.strokeStyle = f.flash ? '#fff' : FIL[i % FIL.length]; ctx.lineWidth = 3.2;
        var a = i * 0.7 + t * (i % 2 ? 1 : -1);
        ctx.beginPath(); ctx.ellipse(Math.sin(a) * 6, -40 + Math.cos(a * 1.3) * 6, 19 + (i % 3) * 4, 30 + (i % 4) * 3, a * 0.3, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.strokeStyle = FIL[0]; ctx.lineWidth = 4;
      var reachX = attack ? (f.atk === 'whip' || f.st === 'special' ? 104 : f.atk === 'kick' || f.atk === 'sweep' ? 48 : 36) : 18 + Math.sin(t) * 3;
      ctx.beginPath(); ctx.moveTo(10, -44); ctx.quadraticCurveTo(reachX * 0.6, -64 + Math.sin(t * 3) * 6, reachX, -46); ctx.stroke();
      ctx.strokeStyle = FIL[3]; ctx.beginPath(); ctx.moveTo(10, -30); ctx.quadraticCurveTo(reachX * 0.5, -10, reachX * 0.8, -26); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(-4, -56, 5.5, 0, Math.PI * 2); ctx.arc(9, -56, 5.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(-2, -55, 2.4, 0, Math.PI * 2); ctx.arc(11, -55, 2.4, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#111'; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.moveTo(-11, -65); ctx.lineTo(0, -61); ctx.moveTo(16, -65); ctx.lineTo(5, -61); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-4, -44); ctx.quadraticCurveTo(3, -40 + (attack ? 4 : 0), 10, -44); ctx.stroke();
      ctx.restore();
    }

    // ---- the workshop behind the fight (drawn once per size)
    function background() {
      var c = document.createElement('canvas'); c.width = Math.max(1, Math.round(g.W)); c.height = Math.max(1, Math.round(g.H));
      var x = c.getContext('2d'), s = g.s, lt = light(), W = g.W, H = g.H;
      var top = lt ? '#e9eef5' : '#1d2230', bot = lt ? '#d5dde8' : '#141822';
      var gr = x.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, top); gr.addColorStop(1, bot); x.fillStyle = gr; x.fillRect(0, 0, W, H);
      // shelves with printers and spools
      var shelfY = (120 - 66) * s;
      x.fillStyle = lt ? '#c7cfdb' : '#2a3142'; x.fillRect(0, shelfY, W, 3 * s);
      for (var i = 0; i < Math.ceil(W / (60 * s)); i++) {
        var px = i * 60 * s + 10 * s;
        if (i % 3 === 1) { // spools
          [0, 1, 2].forEach(function (j) { x.fillStyle = FIL[(i + j) % FIL.length]; x.globalAlpha = 0.55; x.beginPath(); x.arc(px + j * 13 * s + 6 * s, shelfY - 7 * s, 6 * s, 0, Math.PI * 2); x.fill(); x.globalAlpha = 1; });
        } else { // a printer
          x.strokeStyle = lt ? '#9aa6b8' : '#3b4458'; x.lineWidth = Math.max(1, s);
          x.strokeRect(px, shelfY - 30 * s, 30 * s, 30 * s); x.fillStyle = lt ? '#b8c2d1' : '#323a4c'; x.fillRect(px + 3 * s, shelfY - 5 * s, 24 * s, 3 * s);
        }
      }
      // floor
      var fy = sy(0);
      x.fillStyle = lt ? '#cfb48a' : '#3a2f25'; x.fillRect(0, fy, W, H - fy);
      x.strokeStyle = lt ? 'rgba(0,0,0,.12)' : 'rgba(255,255,255,.06)'; x.lineWidth = 1;
      for (var k = -20; k < 30; k++) { var bx = W / 2 + k * 40 * s; x.beginPath(); x.moveTo(bx, fy); x.lineTo(W / 2 + k * 60 * s, H); x.stroke(); }
      x.strokeStyle = lt ? '#a07a3d' : '#c9973f'; x.beginPath(); x.moveTo(0, fy + 0.5); x.lineTo(W, fy + 0.5); x.stroke();
      return c;
    }
    function bar(x, y, w, h, v, ghost, c, back, rightToLeft) {
      ctx.fillStyle = back; ctx.fillRect(x, y, w, h);
      var gw2 = (w - 2) * ghost, vw = (w - 2) * v;
      ctx.fillStyle = '#fde68a'; ctx.fillRect(rightToLeft ? x + 1 + (w - 2 - gw2) : x + 1, y + 1, gw2, h - 2);
      ctx.fillStyle = c; ctx.fillRect(rightToLeft ? x + 1 + (w - 2 - vw) : x + 1, y + 1, vw, h - 2);
      ctx.strokeStyle = OUT; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    }
    function text(t, x, y, size, color, align, bold, stroke) {
      ctx.font = (bold ? '800 ' : '600 ') + Math.round(size) + 'px system-ui, sans-serif'; ctx.textAlign = align || 'left';
      if (stroke) { ctx.lineWidth = Math.max(2, size / 6); ctx.strokeStyle = OUT; ctx.strokeText(t, x, y); }
      ctx.fillStyle = color; ctx.fillText(t, x, y);
    }
    function draw() {
      var W = g.W, H = g.H, s = g.s; if (!W || !H) return;
      var ink = css('--ink', '#ddd'), mute = css('--muted', '#888'), ring = css('--ring', '#333');
      ctx.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0);
      ctx.clearRect(0, 0, W, H);
      if (!bg) bg = background();
      var shx = g.shake ? (Math.random() - 0.5) * g.shake * 2 : 0, shy = g.shake ? (Math.random() - 0.5) * g.shake * 2 : 0;
      ctx.save(); ctx.translate(shx, shy);
      ctx.drawImage(bg, 0, 0, W, H);
      // blinking printer lights
      for (var i = 0; i < Math.ceil(W / (60 * s)); i++) if (i % 3 !== 1) { ctx.fillStyle = Math.floor(now * 2 + i) % 2 ? '#22c55e' : '#16a34a'; ctx.fillRect(i * 60 * s + 34 * s, (120 - 66) * s - 27 * s, 2 * s, 2 * s); var nz = i * 60 * s + 10 * s + (15 + Math.sin(now * 2 + i) * 11) * s; ctx.fillStyle = '#d4a017'; ctx.fillRect(nz - 2 * s, (120 - 66) * s - 20 * s, 4 * s, 4 * s); }
      if (g.mode === 'select') { ctx.restore(); return drawSelect(ink, mute, ring); }
      if (!g.p) { ctx.restore(); return; }
      // floor things
      puddles.forEach(function (p) { ctx.fillStyle = '#22c55e'; ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.ellipse(sx(p.x), sy(0) + 2 * s, p.w / 2 * s, 3.5 * s, 0, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 0.8; for (var b = 0; b < 3; b++) { ctx.beginPath(); ctx.arc(sx(p.x + Math.sin(now * 3 + b * 2) * p.w * 0.35), sy(0) + 1 * s, (1 + (now * 2 + b) % 1.5) * s, 0, Math.PI * 2); ctx.stroke(); } ctx.globalAlpha = 1; });
      // shadows
      [g.c, g.p].forEach(function (f) { ctx.fillStyle = 'rgba(0,0,0,.28)'; var w = Math.max(6, 16 - f.y * 0.08); ctx.beginPath(); ctx.ellipse(sx(f.x), sy(0) + 2 * s, w * s, 2.6 * s, 0, 0, Math.PI * 2); ctx.fill(); });
      walls.forEach(function (w) {
        for (var l = 0; l < w.h; l += 3) { ctx.fillStyle = FIL[Math.floor(l / 9) % 5]; ctx.fillRect(sx(w.x) - 6 * s, sy(l + 3), 12 * s, 3 * s - 1); }
        if (w.h < 62) { ctx.fillStyle = '#d4a017'; ctx.fillRect(sx(w.x + Math.sin(now * 30) * 6) - 2 * s, sy(w.h + 7), 4 * s, 4 * s); }
      });
      pend.forEach(function (p) {
        if (!p.fired) { ctx.strokeStyle = '#a855f7'; ctx.lineWidth = 2; ctx.globalAlpha = 0.5 + 0.5 * Math.sin(now * 30); ctx.beginPath(); ctx.ellipse(sx(p.x), sy(0) + s, 22 * s, 4 * s, 0, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1; }
        else { var hh = Math.min(1, p.up * 5) * 50, fade = p.up > 0.4 ? 1 - (p.up - 0.4) / 0.2 : 1; ctx.globalAlpha = Math.max(0, fade);
          [-16, -5, 6, 16].forEach(function (o, j) { for (var l = 0; l < hh - j * 6; l += 3) { ctx.fillStyle = l % 6 ? '#a855f7' : '#c084fc'; ctx.fillRect(sx(p.x + o) - 2.5 * s, sy(l + 3), 5 * s, 3 * s - 1); } }); ctx.globalAlpha = 1; }
      });
      // fighters (the boss is drawn its own way); afterimages for dashes
      [g.c, g.p].forEach(function (f) {
        if (f.def.boss) { drawBoss(f); return; }
        if ((f.st === 'atk' && (f.atk === 'dash' || f.atk === 'flurry')) || f.st === 'dashstep') {
          var ox = f.x; [3, 2, 1].forEach(function (n) { f.x = ox - f.dir * n * 9; drawFighter(f, 0.12 * (4 - n)); }); f.x = ox;
        }
        // aura
        if (f.st === 'charge' || (f.st === 'super' && f.t < 0.7) || f.pw >= 100) {
          var fl = f.st === 'charge' || f.st === 'super' ? 0.32 + 0.14 * Math.sin(now * 25) : 0.1 + 0.05 * Math.sin(now * 6);
          ctx.globalAlpha = fl; ctx.fillStyle = f.def.color;
          ctx.beginPath(); ctx.ellipse(sx(f.x), sy(f.y + 42), 28 * s, 54 * s, 0, 0, Math.PI * 2); ctx.fill();
          ctx.globalAlpha = fl * 0.6; ctx.beginPath(); ctx.ellipse(sx(f.x), sy(f.y + 44), 36 * s, 64 * s, 0, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
        }
        drawFighter(f);
        // punch trails
        if (f.trail.length > 1) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2 * s; ctx.globalAlpha = 0.5; ctx.beginPath(); f.trail.forEach(function (t2, j) { if (j) ctx.lineTo(sx(t2.x), sy(t2.y)); else ctx.moveTo(sx(t2.x), sy(t2.y)); }); ctx.stroke(); ctx.globalAlpha = 1; }
        // the whip
        if (f.st === 'atk' && f.atk === 'whip' && f.t > 0.12 && f.t < 0.36) {
          var J = joints(poseOf(f)), hx = f.x + f.dir * J.aF[2].x, hy = f.y + J.aF[2].y, ln = Math.min(1, (f.t - 0.12) / 0.08) * 92;
          ctx.strokeStyle = f.def.color; ctx.lineWidth = 3 * s; ctx.beginPath(); ctx.moveTo(sx(hx), sy(hy));
          ctx.quadraticCurveTo(sx(hx + f.dir * ln * 0.5), sy(hy + 14 + Math.sin(now * 40) * 6), sx(hx + f.dir * ln), sy(hy - 2)); ctx.stroke();
          ctx.strokeStyle = '#fff'; ctx.lineWidth = 1 * s; ctx.stroke();
        }
        // charging the blast: a spinning ball of filament at the hands
        if ((f.st === 'super' && f.t < 0.62) || (f.st === 'special' && f.def.move === 'laser' && f.t < 0.34)) {
          var J2 = joints(poseOf(f)), bx = sx(f.x + f.dir * (J2.aF[2].x + 6)), by = sy(f.y + J2.aF[2].y), rr = (f.st === 'super' ? 4 + f.t * 16 : 3 + f.t * 10) * s;
          for (var q = 0; q < 4; q++) { ctx.strokeStyle = q % 2 ? f.def.color : '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(bx, by, rr, rr * 0.5, now * 8 + q, 0, Math.PI * 2); ctx.stroke(); }
        }
      });
      // shots
      shots.forEach(function (sh) {
        sh.trail.forEach(function (t2, j) { ctx.globalAlpha = j / sh.trail.length * 0.5; ctx.fillStyle = sh.kind === 'spool' ? sh.owner.def.color : '#22c55e'; ctx.fillRect(sx(t2.x) - 1.5 * s, sy(t2.y) - 1.5 * s, 3 * s, 3 * s); }); ctx.globalAlpha = 1;
        if (sh.kind === 'spool') {
          ctx.save(); ctx.translate(sx(sh.x), sy(sh.y)); ctx.rotate(sh.spin * sh.owner.dir);
          ctx.fillStyle = sh.owner.def.color; ctx.beginPath(); ctx.arc(0, 0, 9 * s, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = OUT; ctx.lineWidth = 1.5; ctx.stroke();
          ctx.fillStyle = '#e5e7eb'; ctx.beginPath(); ctx.arc(0, 0, 3.4 * s, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = '#e5e7eb'; ctx.lineWidth = s; ctx.beginPath(); ctx.moveTo(-8 * s, 0); ctx.lineTo(8 * s, 0); ctx.moveTo(0, -8 * s); ctx.lineTo(0, 8 * s); ctx.stroke();
          ctx.restore();
        } else { ctx.fillStyle = '#22c55e'; ctx.beginPath(); ctx.arc(sx(sh.x), sy(sh.y), 5 * s, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#86efac'; ctx.beginPath(); ctx.arc(sx(sh.x) - s, sy(sh.y) - s, 2 * s, 0, Math.PI * 2); ctx.fill(); }
      });
      waves.forEach(function (w) {
        var r = 26 + w.t * 380, a = 1 - w.t / 0.4;
        [-1, 1].forEach(function (side) {
          ctx.globalAlpha = a; ctx.fillStyle = '#ec4899';
          for (var j = 0; j < 4; j++) { var hx2 = w.x + side * (r - j * 10); ctx.fillRect(sx(hx2) - 2 * s, sy(14 - j * 3), 4 * s, (14 - j * 3) * s); }
        }); ctx.globalAlpha = 1;
      });
      beams.forEach(function (b) {
        var f = b.owner, J = joints(poseOf(f)), x0 = sx(f.x + f.dir * (J.aF[2].x + 4)), x1 = f.dir > 0 ? W + 20 : -20, y = sy(f.y + b.y), life = b.t / b.T;
        if (b.kind === 'laser') {
          ctx.globalAlpha = 0.35; ctx.strokeStyle = '#06b6d4'; ctx.lineWidth = 7 * s; ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
          ctx.globalAlpha = 1; ctx.lineWidth = 2.4 * s; ctx.stroke(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 0.9 * s; ctx.stroke();
        } else {   // the Print Blast: layer upon layer of filament, scrolling
          var hh = 12 * s * (0.6 + 0.4 * Math.min(1, (b.T - b.t) * 8)) * (life < 0.25 ? life * 4 : 1);
          ctx.globalAlpha = 0.3; ctx.fillStyle = f.def.color; ctx.fillRect(Math.min(x0, x1), y - hh * 1.8, Math.abs(x1 - x0), hh * 3.6);
          for (var l = -5; l <= 5; l++) { ctx.globalAlpha = 0.95 - Math.abs(l) * 0.08; ctx.fillStyle = (l + Math.floor(now * 20)) % 2 ? f.def.color : '#ffffff'; ctx.fillRect(Math.min(x0, x1), y + l * hh / 5.5 - hh / 11, Math.abs(x1 - x0), hh / 5.5); }
          ctx.globalAlpha = 1;
          for (var q2 = 0; q2 < 3; q2++) fx.push({ kind: 'dot', x: (Math.min(x0, x1) + Math.random() * Math.abs(x1 - x0)) / s - left(), y: f.y + b.y + (Math.random() - 0.5) * 20, vx: f.dir * 200, vy: 0, t: 0.2, T: 0.2, c: Math.random() < 0.5 ? f.def.color : '#fff' });
        }
      });
      // sparks, rings, dust, words
      fx.forEach(function (p) {
        var a = p.t / p.T; ctx.globalAlpha = Math.max(0, a);
        if (p.kind === 'ring') { ctx.strokeStyle = p.c; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(sx(p.x), sy(p.y), (p.r + (1 - a) * 16) * s, 0, Math.PI * 2); ctx.stroke(); }
        else if (p.kind === 'star') { ctx.strokeStyle = p.c; ctx.lineWidth = 2.5; for (var k2 = 0; k2 < 8; k2++) { var an = k2 * Math.PI / 4 + 0.3; ctx.beginPath(); ctx.moveTo(sx(p.x + Math.cos(an) * 4), sy(p.y + Math.sin(an) * 4)); ctx.lineTo(sx(p.x + Math.cos(an) * p.r * (k2 % 2 ? 0.6 : 1)), sy(p.y + Math.sin(an) * p.r * (k2 % 2 ? 0.6 : 1))); ctx.stroke(); } }
        else if (p.kind === 'dust') { ctx.fillStyle = 'rgba(180,170,150,.7)'; ctx.beginPath(); ctx.arc(sx(p.x), sy(p.y), p.r * (1.6 - a) * s, 0, Math.PI * 2); ctx.fill(); }
        else if (p.kind === 'fire') { ctx.fillStyle = a > 0.6 ? '#fde047' : a > 0.3 ? '#f97316' : '#ef4444'; ctx.fillRect(sx(p.x) - 2 * s, sy(p.y) - 2 * s, 4 * s * a + 1, 4 * s * a + 1); }
        else { ctx.fillStyle = p.c; ctx.fillRect(sx(p.x) - 1.2 * s, sy(p.y) - 1.2 * s, 2.4 * s, 2.4 * s); }
      });
      ctx.globalAlpha = 1;
      pops.forEach(function (p) { var a = Math.min(1, p.t * 3); ctx.globalAlpha = a; var sc = p.word ? 1 + Math.max(0, p.t - 0.5) : 1; text(p.s, sx(p.x), sy(p.y), p.size * s * 0.7 * sc, p.c, 'center', true, true); });
      ctx.globalAlpha = 1;
      ctx.restore();
      if (g.flash > 0) { ctx.globalAlpha = Math.min(0.6, g.flash * 3); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
      hud(ink, mute, ring);
    }
    function hud(ink, mute, ring) {
      var W = g.W, H = g.H, s = g.s, bw = Math.min(300, W * 0.32), fs = Math.max(11, 6.5 * s), ph = Math.max(22, 13 * s), pw2 = ph * 28 / 34;
      // portraits
      [[g.p, 10, 1], [g.c, W - 10 - pw2, -1]].forEach(function (o) {
        var f = o[0], x = o[1];
        ctx.fillStyle = OUT; ctx.fillRect(x - 1, 7, pw2 + 2, ph + 2);
        ctx.fillStyle = f.def.color; ctx.fillRect(x, 8, pw2, ph);
        if (f.def.boss) { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x + pw2 * 0.35, 8 + ph * 0.45, pw2 * 0.12, 0, 7); ctx.arc(x + pw2 * 0.65, 8 + ph * 0.45, pw2 * 0.12, 0, 7); ctx.fill(); }
        else { ctx.save(); ctx.translate(x + pw2 / 2, 8); ctx.scale(o[2], 1); ctx.drawImage(f.def.img, -pw2 / 2, 0, pw2, ph); ctx.restore(); }
      });
      var lx = 14 + pw2, rx = W - 14 - pw2 - bw;
      text(g.p.def.name, lx, 7 + fs, fs, ink, 'left', true, false);
      bar(lx, 10 + fs, bw, Math.max(8, 4.5 * s), g.p.hp / g.p.max, g.p.ghost / g.p.max, g.p.hp < 30 ? '#ef4444' : '#22c55e', ring, false);
      text(g.c.def.name, W - 14 - pw2, 7 + fs, fs, ink, 'right', true, false);
      bar(rx, 10 + fs, bw, Math.max(8, 4.5 * s), g.c.hp / g.c.max, g.c.ghost / g.c.max, g.c.hp < 30 ? '#ef4444' : '#22c55e', ring, true);
      var py = 12 + fs + Math.max(8, 4.5 * s);
      [[g.p, lx, false], [g.c, rx + bw * 0.45, true]].forEach(function (o) {
        var f = o[0], full = f.pw >= 100, x = o[1], w = bw * 0.55;
        ctx.fillStyle = ring; ctx.fillRect(x, py, w, 5);
        for (var q = 0; q < 4; q++) { var seg = Math.max(0, Math.min(1, f.pw / 25 - q)); ctx.fillStyle = full ? (Math.floor(now * 8) % 2 ? '#facc15' : '#fff') : f.def.color; var sw = w / 4 - 2; ctx.fillRect(o[2] ? x + w - (q + 1) * (w / 4) + 1 + (sw - sw * seg) : x + q * (w / 4) + 1, py + 1, sw * seg, 3); }
        if (full) text('MAX', o[2] ? x - 4 : x + w + 4, py + 6, Math.max(9, 5 * s), '#facc15', o[2] ? 'right' : 'left', true, true);
      });
      text(gw('Level') + ' ' + g.level + ' / ' + levels(), W / 2, 7 + fs, fs, mute, 'center', true);
      if (g.c.def.boss) text(gw('FINAL BOSS'), W / 2, 9 + fs * 2, fs * 0.85, '#ef4444', 'center', true);
      // the keys, always visible
      text(gw('A punch (×3 combo) · S kick · ↓+S sweep · D special · hold F power · F full: blast · ↓ block · ↑ jump'), W / 2, H - 6, Math.max(10, 4.6 * s), 'rgba(255,255,255,.75)', 'center', true, true);
      if (g.tut >= 0 && g.mode === 'fight' && TUT[g.tut]) {
        var msg = gw(TUT[g.tut][1]) + (TUT[g.tut][0] === 'special' ? ' (' + gw(MOVES[g.p.def.move][0]) + ')' : '');
        var bw2 = Math.min(W - 40, msg.length * fs * 0.62 + 40), by = H * 0.3;
        ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect((W - bw2) / 2, by - fs * 1.6, bw2, fs * 2.4);
        text(gw('Lesson') + ' ' + (Object.keys(g.tutDone).filter(function (k) { return TUT.some(function (t) { return t[0] === k; }); }).length + 1) + '/' + TUT.length + ':  ' + msg, W / 2, by, fs * 1.1, '#fde047', 'center', true);
        text(gw('Esc: skip the lesson'), W / 2, by + fs * 1.2 + 4, fs * 0.8, '#e5e7eb', 'center');
      }
      if (g.mode === 'intro') {
        var k = Math.min(1, g.t * 2.5), y0 = H * 0.42;
        text(gw('Level') + ' ' + g.level, W / 2, y0 - 14 * s * (1 - k) - 8 * s, Math.max(16, 9 * s), '#fde047', 'center', true, true);
        text(g.p.def.name + '  VS  ' + g.c.def.name, W / 2, y0 + 3 * s, Math.max(15, 9 * s), '#fff', 'center', true, true);
        if (g.t > 1.2) { var z = 1 + Math.max(0, 1.6 - g.t) * 2; text(gw('FIGHT!'), W / 2, y0 + 18 * s, Math.max(20, 14 * s * z), '#ef4444', 'center', true, true); }
      }
      if (g.mode === 'ko') { var z2 = 1 + Math.max(0, 0.4 - g.t) * 4; text('K.O.', W / 2, H * 0.48, Math.max(26, 22 * s * z2), '#ef4444', 'center', true, true); }
      if (g.paused) text(gw('Paused — click to carry on'), W / 2, H * 0.48, Math.max(13, 8 * s), '#fff', 'center', true, true);
      if (g.mode === 'lost') {
        ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(0, 0, W, H);
        text(g.c.def.name + ' ' + gw('wins.'), W / 2, H * 0.38, Math.max(16, 10 * s), '#fff', 'center', true, true);
        text(gw('You reached level') + ' ' + g.level + '.', W / 2, H * 0.38 + 11 * s, Math.max(12, 7 * s), '#e5e7eb', 'center', true);
        text(gw('Enter or click: try this level again · Esc: choose another fighter'), W / 2, H * 0.38 + 21 * s, Math.max(11, 6 * s), '#e5e7eb', 'center');
      }
      if (g.mode === 'champion') {
        ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(0, 0, W, H);
        text(g.p.def.name + ' ' + gw('is the champion!'), W / 2, H * 0.4, Math.max(18, 12 * s), '#facc15', 'center', true, true);
        text(gw('Enter or click: play again'), W / 2, H * 0.4 + 12 * s, Math.max(11, 6.5 * s), '#e5e7eb', 'center');
      }
    }
    var cells = [];
    function drawSelect(ink, mute) {
      var W = g.W, H = g.H, n = roster.length, cw = Math.min(96, (W - 40) / n), hh = Math.min(H * 0.42, cw * 1.2), x0 = (W - cw * n) / 2, y0 = H * 0.2;
      ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(0, 0, W, H);
      text(gw('Costareen Brawl — choose your fighter'), W / 2, Math.max(16, H * 0.12), Math.max(14, H * 0.07), '#fff', 'center', true, true);
      cells = [];
      roster.forEach(function (d, i) {
        var x = x0 + i * cw, sel = i === g.pick, iw = hh / 34 * 28, bob = sel ? Math.sin(now * 6) * 2 : 0;
        ctx.fillStyle = sel ? d.color : 'rgba(255,255,255,.08)'; ctx.globalAlpha = sel ? 0.35 : 1; ctx.fillRect(x + 2, y0 - 4, cw - 4, hh + 26); ctx.globalAlpha = 1;
        if (sel) { ctx.strokeStyle = d.color; ctx.lineWidth = 3; ctx.strokeRect(x + 2, y0 - 4, cw - 4, hh + 26); }
        ctx.drawImage(d.img, x + (cw - iw) / 2, y0 + bob, iw, hh);
        text(d.name, x + cw / 2, y0 + hh + 15, Math.max(10, Math.min(13, cw / 7.5)), sel ? '#fff' : '#cbd5e1', 'center', sel, sel);
        cells.push([x, y0 - 4, cw, hh + 26]);
      });
      var d = roster[g.pick];
      text(gw('Special') + ': ' + gw(MOVES[d.move][0]) + ' — ' + gw(MOVES[d.move][1]) + (best ? '   ·   ' + gw('Best') + ': ' + gw('level') + ' ' + best : ''), W / 2, y0 + hh + 38, Math.max(11, H * 0.05), '#fde047', 'center', true, true);
      text(gw('← → choose · Enter or click again: fight · "How to play" above for all the keys'), W / 2, Math.min(H - 8, y0 + hh + 58), Math.max(10, H * 0.042), '#e5e7eb', 'center');
    }

    // ---- input: only while the canvas has focus
    var KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyA', 'KeyS', 'KeyD', 'KeyF', 'Enter', 'Space'];
    cv.addEventListener('keydown', function (ev) {
      var c = ev.code; if (KEYS.indexOf(c) < 0 && c !== 'Escape') return;
      ev.preventDefault();
      if (g.paused) { g.paused = false; run(); return; }
      if (g.mode === 'select') {
        if (c === 'ArrowLeft') g.pick = (g.pick + roster.length - 1) % roster.length;
        if (c === 'ArrowRight') g.pick = (g.pick + 1) % roster.length;
        if (c === 'Enter' || c === 'Space' || c === 'KeyA') { startRun(); return; }
        draw(); return;
      }
      if (g.mode === 'lost') { if (c === 'Escape') { g.mode = 'select'; draw(); } else if (c === 'Enter' || c === 'Space') intro(); return; }
      if (g.mode === 'champion') { if (c === 'Enter' || c === 'Space') { g.mode = 'select'; draw(); } return; }
      if (c === 'Escape') { if (g.tut >= 0) { endTut(); return; } api.pause(); cv.blur(); return; }
      if (!ev.repeat) hit[c] = true;
      held[c] = true;
    });
    cv.addEventListener('keyup', function (ev) { held[ev.code] = false; });
    cv.addEventListener('blur', function () { held = {}; api.pause(); });
    cv.addEventListener('mousedown', function (ev) {
      ev.preventDefault(); cv.focus({ preventScroll: true });
      if (g.paused) { g.paused = false; run(); return; }
      if (g.mode === 'select') {
        var r = cv.getBoundingClientRect(), x = ev.clientX - r.left, y = ev.clientY - r.top;
        for (var i = 0; i < cells.length; i++) { var c = cells[i]; if (x >= c[0] && x <= c[0] + c[2] && y >= c[1] && y <= c[1] + c[3]) { if (g.pick === i) startRun(); else { g.pick = i; draw(); } return; } }
        return;
      }
      if (g.mode === 'lost') { intro(); return; }
      if (g.mode === 'champion') { g.mode = 'select'; draw(); }
    });
    // the select screen breathes a little (the chosen face bobs)
    var idleT = setInterval(function () { if (dead) { clearInterval(idleT); return; } if (g.mode === 'select' && document.body.contains(cv)) { now += 0.1; draw(); } }, 100);

    var api = {
      size: g.size,
      pause: function () { if (loopOn() && !g.paused) { g.paused = true; stopLoop(); held = {}; draw(); } },
      stop: function () { dead = true; stopLoop(); clearInterval(idleT); },
      draw: draw,
      state: function () { return loopOn() ? (g.paused ? 'paused' : 'run') : 'idle'; },
      _g: g
    };
    return api;
  };
  // what the "How to play" window says
  window.ERP_FIGHT_HELP = function (roster, gw) {
    gw = gw || function (t) { return t; };
    var list = (roster && roster.length >= 2 ? roster : PLAIN);
    var k = function (t) { return '<kbd>' + t + '</kbd>'; };
    var esc = function (t) { return String(t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
    return '<h3>' + gw('Costareen Brawl — how to play') + '</h3>' +
      '<p>' + gw('Click the game first. Choose a fighter with ← → and press Enter. Beat everyone, one level after another; the last one is the Spaghetti Monster. The first fight starts with a short lesson.') + '</p>' +
      '<table><tbody>' +
      '<tr><td>' + k('←') + ' ' + k('→') + '</td><td>' + gw('move (tap twice fast: a quick dash)') + '</td></tr>' +
      '<tr><td>' + k('↑') + '</td><td>' + gw('jump') + '</td></tr>' +
      '<tr><td>' + k('↓') + '</td><td>' + gw('hold to block') + '</td></tr>' +
      '<tr><td>' + k('A') + '</td><td>' + gw('punch — press 3 times fast for a combo that ends in an uppercut') + '</td></tr>' +
      '<tr><td>' + k('S') + '</td><td>' + gw('kick · with ↓: sweep (knocks him down) · in the air: flying kick') + '</td></tr>' +
      '<tr><td>' + k('D') + '</td><td>' + gw('your special move (wait a moment between two)') + '</td></tr>' +
      '<tr><td>' + k('F') + '</td><td>' + gw('hold to power up; when the bar says MAX, press F: Print Blast') + '</td></tr>' +
      '<tr><td>' + k('Esc') + '</td><td>' + gw('pause / skip the lesson') + '</td></tr>' +
      '</tbody></table>' +
      '<h4>' + gw('Special moves') + '</h4><table><tbody>' +
      list.map(function (d) { var m = MOVES[d.move] || ['', '']; return '<tr><td><b>' + esc(d.name) + '</b></td><td>' + gw(m[0]) + ' — ' + gw(m[1]) + '</td></tr>'; }).join('') +
      '</tbody></table>' +
      '<p>' + gw('Tips: block, then hit back. Jump over sweeps and spools. Hitting and getting hit both fill your power bar.') + '</p>';
  };
})();
