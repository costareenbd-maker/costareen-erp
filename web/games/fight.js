/*
 * Costareen Brawl - a small fighting game for the strip under New invoice.
 * One player against the computer; every win brings a harder opponent, the last one is the Spaghetti Monster.
 * Loaded only when its tab is opened. The fighters' faces are not in this file: they come from the
 * business's own data (erpFighters), so nobody's photo sits in a public file.
 */
(function () {
  'use strict';
  var MOVES = { whip: 'Filament Whip', spool: 'Spool Throw', dash: 'Hot Nozzle Dash', resin: 'Resin Splash', wall: 'Layer Wall',
    pillars: 'Support Pillars', laser: 'Laser Engraver', slam: 'Heated Bed Slam', flurry: 'Speed Print 300' };
  var OUT = '#141016', PANTS = '#2b3044', BOOT = '#151318', BELT = '#3b2a20';
  var FIL = ['#ef4444', '#3b82f6', '#22c55e', '#eab308', '#f97316', '#a855f7', '#f1f5f9'];

  function headCanvas(hd) {
    var c = document.createElement('canvas'); c.width = hd.w; c.height = hd.h;
    var x = c.getContext('2d');
    for (var i = 0; i < hd.px.length; i++) {
      var ch = hd.px.charAt(i); if (ch === '.') continue;
      x.fillStyle = hd.pal[parseInt(ch, 16)]; x.fillRect(i % hd.w, Math.floor(i / hd.w), 1, 1);
    }
    return c;
  }
  function skinOf(hd) {   // the colour at the cheek
    var i = Math.floor(hd.h * 0.62) * hd.w + Math.floor(hd.w * 0.3), ch = hd.px.charAt(i);
    return ch === '.' ? '#b07a5a' : hd.pal[parseInt(ch, 16)];
  }
  // a plain face for businesses that have not added their own fighters
  function plainHead(skin, hair) {
    var w = 28, h = 34, px = '';
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var e = Math.pow((x - 13.5) / 13, 2) + Math.pow((y - 17) / 16.5, 2);
      var c = '.';
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

  window.ERP_FIGHT = function (cv, opts) {
    opts = opts || {};
    var gw = opts.words || function (t) { return t; };
    var roster = (opts.roster && opts.roster.length >= 2 ? opts.roster : PLAIN).map(function (d) {
      return { name: d.name, move: d.move, color: d.color, head: d.head, img: headCanvas(d.head), skin: skinOf(d.head) };
    });
    var ctx = cv.getContext('2d');
    var g = { mode: 'select', W: 0, H: 0, s: 1, pick: 0, level: 1, opps: [], p: null, c: null, t: 0, msg: '', paused: false };
    var raf = 0, last = 0, dead = false, held = {}, hit = {}, fx = [], shots = [], walls = [], puddles = [], pend = [], beams = [], waves = [];
    var best = opts.bestGet ? opts.bestGet() : 0;
    function css(n, f) { var v = getComputedStyle(document.documentElement).getPropertyValue(n).trim(); return v || f; }

    // ---- sizes: the arena is 120 units high; the floor sits at 112
    g.size = function (w, h) {
      if (w === g.W && h === g.H) return;
      var r = window.devicePixelRatio || 1;
      g.W = w; g.H = h; g.s = h / 120;
      cv.width = Math.round(w * r); cv.height = Math.round(h * r); cv.style.height = h + 'px';
      ctx.setTransform(r, 0, 0, r, 0, 0); ctx.imageSmoothingEnabled = false;
      if (!loopOn()) draw();
    };
    function AW() { return Math.min(g.W / g.s - 20, 560); }
    function left() { return (g.W / g.s - AW()) / 2; }
    function sx(x) { return (left() + x) * g.s; }
    function sy(y) { return (112 - y) * g.s; }

    // ---- fighters
    function make(def, x, dir, L) {
      var boss = !!def.boss;
      return { def: def, x: x, y: 0, vx: 0, vy: 0, dir: dir, hp: boss ? 160 : 100, max: boss ? 160 : 100, pw: 0, st: 'idle', t: 0, cd: 0,
        done: 0, kx: 0, flash: 0, ai: null, mul: 1, L: L || 0, blockT: 0, chargeT: 0 };
    }
    var ATK = {
      punch: { start: 0.07, act: 0.08, rec: 0.14, range: 30, dmg: 5, kb: 60 },
      kick: { start: 0.12, act: 0.1, rec: 0.24, range: 42, dmg: 8, kb: 110 },
      whip: { start: 0.16, act: 0.1, rec: 0.3, range: 95, dmg: 10, kb: 120 },
      flurry: { start: 0.05, act: 0.35, rec: 0.25, range: 34, dmg: 3, kb: 25 },
      dash: { start: 0.05, act: 0.28, rec: 0.2, range: 26, dmg: 12, kb: 160 }
    };
    function opp(f) { return f === g.p ? g.c : g.p; }
    function free(f) { return f.st === 'idle' || f.st === 'walk' || f.st === 'block' || f.st === 'charge'; }
    function begin(f, st) { f.st = st; f.t = 0; f.done = 0; }
    function special(f) {
      if (f.cd > 0) return false;
      f.cd = 2.8; begin(f, 'special');
      if (f.def.move === 'slam') { f.vy = 330; }
      return true;
    }
    function hurt(att, tgt, dmg, kb, unblockable) {
      if (tgt.st === 'down' || g.mode !== 'fight') return;
      var blocked = !unblockable && tgt.st === 'block';
      var d = dmg * att.mul * (blocked ? 0.2 : 1);
      tgt.hp = Math.max(0, tgt.hp - d);
      att.pw = Math.min(100, att.pw + (blocked ? 3 : 8)); tgt.pw = Math.min(100, tgt.pw + 5);
      spark(tgt.x, tgt.y + 45, blocked ? '#cbd5e1' : att.def.color, blocked ? 5 : 10);
      if (!blocked) { begin(tgt, 'hit'); tgt.kx = att.x < tgt.x ? kb : -kb; tgt.flash = 0.12; }
      if (tgt.hp <= 0) { begin(tgt, 'down'); tgt.vy = 160; tgt.kx = att.x < tgt.x ? 140 : -140; g.mode = 'ko'; g.t = 0; }
    }
    function spark(x, y, c, n) { for (var i = 0; i < n; i++) fx.push({ x: x, y: y, vx: (Math.random() - 0.5) * 260, vy: Math.random() * 220, t: 0.4, c: c }); }
    function reach(f, range) { var o = opp(f), front = (o.x - f.x) * f.dir; return front > -6 && front < 12 + range && Math.abs(o.y - f.y) < 50; }

    function stepFighter(f, dt) {
      var o = opp(f), k = f.def.move;
      f.t += dt; f.cd = Math.max(0, f.cd - dt); f.flash = Math.max(0, f.flash - dt);
      var slow = puddles.some(function (p) { return p.owner !== f && Math.abs(f.x - p.x) < p.w / 2 && f.y === 0; }) ? 0.4 : 1;
      if (free(f) && f.y === 0) f.dir = o.x >= f.x ? 1 : -1;
      // what each state does
      var a = ATK[f.st] || (f.st === 'special' ? ATK[k] : null);
      if ((f.st === 'punch' || f.st === 'kick' || (f.st === 'special' && ATK[k])) && a) {
        if (k === 'dash' && f.st === 'special' && f.t > a.start && f.t < a.start + a.act) f.vx = f.dir * 480;
        var on = f.t >= a.start && f.t <= a.start + a.act;
        if (on && f.st === 'special' && k === 'flurry') { if (f.t - a.start >= f.done * 0.07 && f.done < 5) { f.done++; if (reach(f, a.range)) hurt(f, o, a.dmg, a.kb); } }
        else if (on && !f.done && reach(f, a.range)) { f.done = 1; hurt(f, o, a.dmg, a.kb); }
        if (f.t > a.start + a.act + a.rec) { begin(f, 'idle'); f.vx = 0; }
      } else if (f.st === 'special') {
        if (k === 'spool' && f.t > 0.15 && !f.done) { f.done = 1; shots.push({ kind: 'spool', owner: f, x: f.x + f.dir * 20, y: 9, vx: f.dir * 320, vy: 0, dmg: 10 }); }
        if (k === 'resin' && f.t > 0.15 && !f.done) { f.done = 1; shots.push({ kind: 'resin', owner: f, x: f.x + f.dir * 18, y: 50, vx: f.dir * 250, vy: 120, dmg: 6 }); }
        if (k === 'wall' && f.t > 0.2 && !f.done) { f.done = 1; walls.push({ owner: f, x: f.x + f.dir * 42, t: 3, h: 0 }); }
        if (k === 'pillars' && f.t > 0.25 && !f.done) { f.done = 1; pend.push({ owner: f, x: o.x, t: 0.45, up: 0 }); }
        if (k === 'laser' && f.t > 0.35 && !f.done) { f.done = 1; beams.push({ owner: f, kind: 'laser', t: 0.14, dmg: 9, y: 45, hit: 0 }); }
        if (k === 'slam' && f.y === 0 && f.t > 0.1 && !f.done) { f.done = 1; waves.push({ owner: f, x: f.x, t: 0, hit: 0 }); }
        if (f.t > (k === 'slam' ? 0.75 : 0.55)) begin(f, 'idle');
      } else if (f.st === 'super') {
        if (f.t > 0.55 && !f.done) { f.done = 1; f.pw = 0; beams.push({ owner: f, kind: 'super', t: 0.5, dmg: 30, y: 46, hit: 0 }); }
        if (f.t > 1.15) begin(f, 'idle');
      } else if (f.st === 'hit') {
        f.vx = f.kx; f.kx *= 0.85;
        if (f.t > 0.28) { begin(f, 'idle'); f.vx = 0; }
      } else if (f.st === 'down') {
        f.vx = f.kx; f.kx *= 0.9;
      } else if (f.st === 'charge') {
        f.pw = Math.min(100, f.pw + 30 * dt);
      }
      if (f.st !== 'walk' && f.st !== 'hit' && f.st !== 'down' && !(f.st === 'special' && k === 'dash') && f.y === 0) f.vx = 0;
      // move, with walls in the way
      var nx = f.x + f.vx * dt * (f.st === 'walk' ? slow : 1);
      walls.forEach(function (w) { if (w.owner !== f && w.h > 30 && ((f.x < w.x && nx > w.x - 14) || (f.x > w.x && nx < w.x + 14))) nx = f.x < w.x ? w.x - 14 : w.x + 14; });
      f.x = Math.max(14, Math.min(AW() - 14, nx));
      if (f.y > 0 || f.vy > 0) { f.vy -= 1300 * dt; f.y = Math.max(0, f.y + f.vy * dt); if (f.y === 0) { f.vy = 0; if (f.st === 'air') begin(f, 'idle'); } }
      // fighters do not pass through each other
      if (Math.abs(f.x - o.x) < 22 && Math.abs(f.y - o.y) < 40 && f.st !== 'down' && o.st !== 'down') f.x = o.x + (f.x <= o.x ? -22 : 22);
      f.x = Math.max(14, Math.min(AW() - 14, f.x));
    }

    // ---- the player's keys
    function player(f, dt) {
      var pressed = function (k) { return hit[k]; };
      if (f.st === 'charge' && !held.KeyF) begin(f, 'idle');
      if (f.st === 'block' && !held.ArrowDown) begin(f, 'idle');
      var canAct = free(f) || f.st === 'air';
      if (!canAct) return;
      if (pressed('KeyA')) { begin(f, 'punch'); return; }
      if (pressed('KeyS')) { begin(f, 'kick'); return; }
      if (f.st === 'air') return;
      if (pressed('KeyD') && special(f)) return;
      if (pressed('KeyF') && f.pw >= 100) { begin(f, 'super'); return; }
      if (held.KeyF && f.pw < 100) { if (f.st !== 'charge') begin(f, 'charge'); return; }
      if (held.ArrowDown) { if (f.st !== 'block') begin(f, 'block'); return; }
      if (pressed('ArrowUp') && f.y === 0) { f.vy = 430; f.vx = held.ArrowLeft ? -150 : held.ArrowRight ? 150 : 0; begin(f, 'air'); return; }
      if (held.ArrowLeft || held.ArrowRight) { f.st = 'walk'; f.vx = held.ArrowLeft ? -150 : 150; }
      else if (f.st === 'walk') begin(f, 'idle');
    }
    // ---- the computer: quicker, blocks more and hits harder every level
    function computer(f, dt) {
      var o = g.p, L = f.L, dist = Math.abs(o.x - f.x);
      var react = Math.max(0.12, 0.55 - 0.05 * L), blockP = Math.min(0.7, 0.12 + 0.07 * L), aggr = Math.min(0.92, 0.38 + 0.06 * L);
      f.ai = f.ai || { t: 0, plan: 'wait', until: 0 };
      f.ai.t -= dt;
      var attacking = ['punch', 'kick', 'special', 'super'].indexOf(o.st) >= 0;
      if (f.st === 'block') { f.blockT -= dt; if (f.blockT <= 0) begin(f, 'idle'); return; }
      if (f.st === 'charge') { f.chargeT -= dt; if (f.chargeT <= 0 || dist < 90) begin(f, 'idle'); return; }
      if (!free(f)) return;
      if (attacking && dist < 110 && Math.random() < blockP * dt * 7) { begin(f, 'block'); f.blockT = 0.35; return; }
      if (o.st === 'super' && o.t > 0.3 && Math.random() < blockP * dt * 6) { begin(f, 'block'); f.blockT = 0.7; return; }
      if (f.ai.t > 0) { if (f.st === 'walk') f.vx = f.ai.dir * 150; return; }
      f.ai.t = react * (0.6 + Math.random() * 0.8);
      var r = Math.random();
      if (f.pw >= 100 && dist < 320) { begin(f, 'super'); return; }
      var ranged = ['spool', 'laser', 'pillars', 'resin', 'whip'].indexOf(f.def.move) >= 0;
      if (f.cd <= 0 && r < 0.18 + 0.03 * L && (ranged ? dist < 300 : dist < 90)) { special(f); return; }
      if (dist > 36) {
        if (Math.random() < aggr) { f.st = 'walk'; f.ai.dir = o.x > f.x ? 1 : -1; f.vx = f.ai.dir * 150; }
        else if (f.pw < 100 && dist > 170 && Math.random() < 0.5) { begin(f, 'charge'); f.chargeT = 0.7; }
        else { f.st = 'walk'; f.ai.dir = o.x > f.x ? -1 : 1; f.vx = f.ai.dir * 150; f.ai.t = 0.25; }
      } else {
        if (Math.random() < 0.12 + 0.02 * L) { f.vy = 430; begin(f, 'air'); return; }
        begin(f, Math.random() < 0.55 ? 'punch' : 'kick');
      }
    }

    // ---- flow: choose -> level intro -> fight -> K.O. -> next level (or try again)
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
      g.c.mul = 1 + 0.07 * (L - 1) + (them.boss ? 0.25 : 0);
      shots = []; walls = []; puddles = []; pend = []; beams = []; waves = []; fx = [];
      g.mode = 'intro'; g.t = 0; run();
    }
    function levels() { return g.opps.length; }
    function step(dt) {
      g.t += dt;
      if (g.mode === 'intro') { if (g.t > 1.8) { g.mode = 'fight'; g.t = 0; } }
      if (g.mode === 'fight' || g.mode === 'ko') {
        if (g.mode === 'fight') { player(g.p, dt); computer(g.c, dt); }
        stepFighter(g.p, dt); stepFighter(g.c, dt);
        stepThings(dt);
        if (g.mode === 'ko' && g.t > 2) {
          if (g.c.hp <= 0) {
            if (g.level > best) { best = g.level; if (opts.bestSet) opts.bestSet(best); }
            if (g.level >= levels()) { g.mode = 'champion'; stopLoop(); draw(); return; }
            g.level++; intro(); return;
          }
          g.mode = 'lost'; stopLoop(); draw(); return;
        }
      }
      hit = {};
    }
    function stepThings(dt) {
      shots = shots.filter(function (s) {
        var o = opp(s.owner);
        s.x += s.vx * dt;
        if (s.kind === 'resin') { s.vy -= 700 * dt; s.y += s.vy * dt; if (s.y <= 0) { puddles.push({ owner: s.owner, x: s.x, w: 64, t: 3 }); return false; } }
        if (walls.some(function (w) { return w.owner !== s.owner && w.h > 20 && Math.abs(s.x - w.x) < 10; })) { spark(s.x, s.y, '#eab308', 6); return false; }
        if (Math.abs(s.x - o.x) < 16 && Math.abs((s.y) - (o.y + 30)) < 40) { hurt(s.owner, o, s.dmg, 90); return false; }
        return s.x > -20 && s.x < AW() + 20;
      });
      walls.forEach(function (w) { w.t -= dt; w.h = Math.min(60, w.h + 240 * dt); }); walls = walls.filter(function (w) { return w.t > 0; });
      puddles.forEach(function (p) { p.t -= dt; }); puddles = puddles.filter(function (p) { return p.t > 0; });
      pend = pend.filter(function (p) {
        p.t -= dt; var o = opp(p.owner);
        if (p.t <= 0 && !p.fired) { p.fired = true; if (Math.abs(o.x - p.x) < 24 && o.y < 30) { hurt(p.owner, o, 12, 20); if (o.st === 'hit') o.vy = 300; } }
        if (p.fired) p.up += dt;
        return p.up < 0.4;
      });
      beams = beams.filter(function (b) {
        b.t -= dt; var f = b.owner, o = opp(f);
        if (!b.hit && (o.x - f.x) * f.dir > 0 && o.y < (b.kind === 'super' ? 70 : 34)) { b.hit = 1; hurt(f, o, b.dmg, b.kind === 'super' ? 220 : 80, false); }
        return b.t > 0;
      });
      waves = waves.filter(function (w) {
        w.t += dt; var o = opp(w.owner), r = 30 + w.t * 360;
        if (!w.hit && o.y === 0 && Math.abs(o.x - w.x) < r && Math.abs(o.x - w.x) > r - 50) { w.hit = 1; hurt(w.owner, o, 10, 120); }
        return w.t < 0.35;
      });
      fx.forEach(function (p) { p.t -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy -= 600 * dt; }); fx = fx.filter(function (p) { return p.t > 0; });
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

    // ---- drawing
    function pose(f) {
      var st = f.st, k = f.def.move, R = [], ph = Math.sin(f.x / 9);
      var torso = [-12, -51, 24, 26, 'sh'], belt = [-12, -27, 24, 3, 'bl'];
      var legs = [[-11, -25, 7, 22, 'pt'], [4, -25, 7, 22, 'pt'], [-13, -4, 10, 4, 'bt'], [4, -4, 10, 4, 'bt']];
      if (st === 'walk') legs = [[-11 + ph * 3, -25, 7, 22, 'pt'], [4 - ph * 3, -25, 7, 22, 'pt'], [-13 + ph * 3, -4, 10, 4, 'bt'], [4 - ph * 3, -4, 10, 4, 'bt']];
      if (f.y > 0) legs = [[-11, -25, 7, 14, 'pt'], [4, -25, 7, 12, 'pt'], [-13, -13, 10, 4, 'bt'], [5, -15, 10, 4, 'bt']];
      var guard = [[-17, -49, 6, 12, 'sh'], [-16, -57, 6, 9, 'sk'], [11, -49, 6, 10, 'sh'], [13, -57, 7, 8, 'sk']];
      var arms = guard;
      var swing = st === 'punch' || (st === 'special' && (k === 'flurry' || k === 'dash' || k === 'whip'));
      if (swing) arms = [[-17, -49, 6, 12, 'sh'], [-16, -57, 6, 9, 'sk'], [11, -49, 14, 6, 'sh'], [25, -50, 8, 8, 'sk']];
      if (st === 'special' && k === 'flurry' && Math.floor(f.t * 28) % 2) arms = [[-12, -48, 22, 6, 'sh'], [10, -49, 8, 8, 'sk'], [11, -42, 16, 6, 'sh'], [27, -43, 8, 8, 'sk']];
      if (st === 'kick') legs = [[-11, -25, 7, 22, 'pt'], [-13, -4, 10, 4, 'bt'], [6, -36, 22, 7, 'pt'], [28, -38, 6, 10, 'bt']];
      if (st === 'block') arms = [[11, -58, 6, 26, 'sk'], [15, -54, 6, 20, 'sh'], [-15, -49, 6, 12, 'sh']];
      if (st === 'super' || (st === 'special' && ['spool', 'resin', 'laser', 'wall', 'pillars'].indexOf(k) >= 0)) arms = [[10, -50, 16, 6, 'sh'], [26, -51, 8, 8, 'sk'], [8, -43, 16, 6, 'sh'], [24, -44, 8, 8, 'sk']];
      if (st === 'charge') arms = [[-19, -48, 6, 16, 'sh'], [-19, -33, 6, 6, 'sk'], [13, -48, 6, 16, 'sh'], [13, -33, 6, 6, 'sk']];
      if (st === 'special' && k === 'slam') arms = [[-19, -66, 6, 18, 'sh'], [-19, -72, 6, 6, 'sk'], [13, -66, 6, 18, 'sh'], [13, -72, 6, 6, 'sk']];
      R = legs.concat([torso, belt]).concat(arms);
      return R;
    }
    function drawFighter(f) {
      var s = g.s, d = f.def;
      ctx.save();
      ctx.translate(sx(f.x), sy(f.y));
      if (f.st === 'down') { ctx.rotate(-f.dir * Math.min(1, f.t * 4) * Math.PI / 2); }
      else if (f.st === 'hit') ctx.translate(-f.dir * 3 * s, 0);
      // power aura
      if (f.st === 'charge' || (f.st === 'super' && f.t < 0.6) || f.pw >= 100) {
        var fl = f.st === 'charge' || f.st === 'super' ? 0.35 + 0.15 * Math.sin(performance.now() / 50) : 0.12;
        ctx.globalAlpha = fl; ctx.fillStyle = d.color;
        ctx.beginPath(); ctx.ellipse(0, -42 * s, 26 * s, 50 * s, 0, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
      }
      ctx.scale(f.dir * s, s);
      if (d.boss) { drawBoss(f); ctx.restore(); return; }
      var R = pose(f), col = { sh: f.flash ? '#ffffff' : d.color, sk: d.skin, pt: PANTS, bt: BOOT, bl: BELT };
      ctx.fillStyle = OUT; R.forEach(function (r) { ctx.fillRect(r[0] - 1, r[1] - 1, r[2] + 2, r[3] + 2); });
      R.forEach(function (r) { ctx.fillStyle = col[r[4]]; ctx.fillRect(r[0], r[1], r[2], r[3]); });
      // the whip itself
      if (f.st === 'special' && d.move === 'whip' && f.t > 0.12 && f.t < 0.3) {
        ctx.strokeStyle = d.color; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(30, -46);
        ctx.quadraticCurveTo(70, -60 + Math.sin(f.t * 40) * 8, 105, -44); ctx.stroke();
      }
      ctx.drawImage(d.img, -14, -81, 28, 34);
      ctx.restore();
    }
    function drawBoss(f) {
      var t = performance.now() / 300, attack = f.st === 'punch' || f.st === 'kick' || f.st === 'special';
      ctx.lineWidth = 3; ctx.lineCap = 'round';
      for (var i = 0; i < 9; i++) {
        ctx.strokeStyle = f.flash ? '#fff' : FIL[i % FIL.length];
        ctx.beginPath();
        var a = i * 0.7 + t * (i % 2 ? 1 : -1);
        ctx.ellipse(Math.sin(a) * 6, -38 + Math.cos(a * 1.3) * 6, 18 + (i % 3) * 4, 28 + (i % 4) * 3, a * 0.3, 0, Math.PI * 2); ctx.stroke();
      }
      // tendrils reach out to hit
      ctx.strokeStyle = FIL[0]; ctx.lineWidth = 3;
      var reachX = attack ? (f.st === 'special' ? 100 : f.st === 'kick' ? 44 : 32) : 18;
      ctx.beginPath(); ctx.moveTo(10, -40); ctx.quadraticCurveTo(reachX * 0.6, -60 + Math.sin(t * 3) * 6, reachX, -42); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(10, -30); ctx.quadraticCurveTo(reachX * 0.5, -10, reachX * 0.8, -26); ctx.stroke();
      // eyes
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(-4, -52, 5, 0, Math.PI * 2); ctx.arc(8, -52, 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(-2, -51, 2.2, 0, Math.PI * 2); ctx.arc(10, -51, 2.2, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#111'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-10, -60); ctx.lineTo(0, -57); ctx.moveTo(14, -60); ctx.lineTo(4, -57); ctx.stroke();
    }
    function bar(x, y, w, h, v, c, back) {
      ctx.fillStyle = back; ctx.fillRect(x, y, w, h);
      ctx.fillStyle = c; ctx.fillRect(x + 1, y + 1, Math.max(0, (w - 2) * v), h - 2);
    }
    function text(t, x, y, size, color, align, bold) {
      ctx.font = (bold ? '700 ' : '600 ') + Math.round(size) + 'px system-ui, sans-serif'; ctx.fillStyle = color; ctx.textAlign = align || 'left'; ctx.fillText(t, x, y);
    }
    function draw() {
      var W = g.W, H = g.H, s = g.s; if (!W || !H) return;
      var ink = css('--ink', '#ddd'), mute = css('--muted', '#888'), ring = css('--ring', '#333'), surf = css('--surface', '#222');
      ctx.clearRect(0, 0, W, H);
      // the workshop: printers in the back, the floor
      ctx.fillStyle = ring;
      for (var i = 0; i < 6; i++) { var px = sx(AW() * (i + 0.5) / 6) - 14 * s; ctx.strokeStyle = ring; ctx.lineWidth = 1; ctx.strokeRect(px, sy(70), 28 * s, 34 * s); ctx.fillRect(px + 4 * s, sy(48), 20 * s, 2 * s); }
      ctx.fillStyle = 'rgba(212,160,70,.14)'; ctx.fillRect(sx(0), sy(0), AW() * s, 8 * s);
      ctx.strokeStyle = '#c9973f'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(sx(0), sy(0) + 0.5); ctx.lineTo(sx(AW()), sy(0) + 0.5); ctx.stroke();
      if (g.mode === 'select') return drawSelect(ink, mute, ring);
      if (!g.p) return;
      // puddles, walls, pillars, shots
      puddles.forEach(function (p) { ctx.fillStyle = '#22c55e'; ctx.globalAlpha = 0.45; ctx.beginPath(); ctx.ellipse(sx(p.x), sy(0), p.w / 2 * s, 3 * s, 0, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1; });
      walls.forEach(function (w) { for (var l = 0; l < w.h; l += 4) { ctx.fillStyle = FIL[(l / 4) % 2 ? 3 : 4]; ctx.fillRect(sx(w.x) - 5 * s, sy(l + 4), 10 * s, 4 * s - 1); } });
      pend.forEach(function (p) {
        if (!p.fired) { ctx.fillStyle = '#a855f7'; ctx.globalAlpha = 0.5 + 0.5 * Math.sin(performance.now() / 60); ctx.fillRect(sx(p.x) - 20 * s, sy(0) - 2 * s, 40 * s, 3 * s); ctx.globalAlpha = 1; }
        else { var hh = Math.min(1, p.up * 6) * 46; ctx.fillStyle = '#a855f7'; [-14, -3, 8].forEach(function (o) { ctx.fillRect(sx(p.x + o) - 2.5 * s, sy(hh), 5 * s, hh * s); }); }
      });
      shots.forEach(function (sh) {
        if (sh.kind === 'spool') {
          var c = sh.owner.def.color; ctx.fillStyle = c; ctx.beginPath(); ctx.arc(sx(sh.x), sy(sh.y), 9 * s, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = surf; ctx.beginPath(); ctx.arc(sx(sh.x), sy(sh.y), 3 * s, 0, Math.PI * 2); ctx.fill();
        } else { ctx.fillStyle = '#22c55e'; ctx.beginPath(); ctx.arc(sx(sh.x), sy(sh.y), 4 * s, 0, Math.PI * 2); ctx.fill(); }
      });
      waves.forEach(function (w) { var r = 30 + w.t * 360; ctx.strokeStyle = '#ec4899'; ctx.lineWidth = 3; ctx.globalAlpha = 1 - w.t / 0.35; ctx.beginPath(); ctx.moveTo(sx(w.x - r), sy(0)); ctx.lineTo(sx(w.x - r + 10), sy(8)); ctx.moveTo(sx(w.x + r), sy(0)); ctx.lineTo(sx(w.x + r - 10), sy(8)); ctx.stroke(); ctx.globalAlpha = 1; });
      drawFighter(g.c); drawFighter(g.p);
      beams.forEach(function (b) {
        var f = b.owner, x0 = sx(f.x + f.dir * 30), x1 = f.dir > 0 ? W : 0, y = sy(f.y + b.y);
        if (b.kind === 'laser') { ctx.strokeStyle = '#06b6d4'; ctx.lineWidth = 2 * s; ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 0.7 * s; ctx.stroke(); }
        else {   // the Print Blast: layer upon layer of filament
          for (var l = -5; l <= 5; l++) { ctx.fillStyle = l % 2 ? f.def.color : '#ffffff'; ctx.globalAlpha = 0.85 - Math.abs(l) * 0.1; ctx.fillRect(Math.min(x0, x1), y + l * 2.2 * s, Math.abs(x1 - x0), 2.2 * s); }
          ctx.globalAlpha = 1;
        }
      });
      fx.forEach(function (p) { ctx.fillStyle = p.c; ctx.fillRect(sx(p.x), sy(p.y), 2.5 * s, 2.5 * s); });
      // bars
      var bw = Math.min(260, W * 0.3), fs = Math.max(11, 7 * s);
      text(g.p.def.name, 12, 16, fs, ink, 'left', true);
      bar(12, 21, bw, 9, g.p.hp / g.p.max, '#22c55e', ring); bar(12, 32, bw * 0.6, 5, g.p.pw / 100, g.p.pw >= 100 ? '#facc15' : g.p.def.color, ring);
      text(g.c.def.name, W - 12, 16, fs, ink, 'right', true);
      bar(W - 12 - bw, 21, bw, 9, g.c.hp / g.c.max, '#ef4444', ring); bar(W - 12 - bw * 0.6, 32, bw * 0.6, 5, g.c.pw / 100, g.c.pw >= 100 ? '#facc15' : g.c.def.color, ring);
      text(gw('Level') + ' ' + g.level + ' / ' + levels(), W / 2, 16, fs, mute, 'center');
      if (g.p.pw >= 100 && g.mode === 'fight') text(gw('Power full: press F'), W / 2, 30, fs * 0.9, '#eab308', 'center', true);
      if (g.mode === 'intro') {
        text(gw('Level') + ' ' + g.level + ': ' + g.p.def.name + ' vs ' + g.c.def.name, W / 2, H * 0.42, Math.max(14, 10 * s), ink, 'center', true);
        if (g.t > 1) text(gw('Fight!'), W / 2, H * 0.42 + 13 * s, Math.max(16, 12 * s), '#ef4444', 'center', true);
      }
      if (g.mode === 'ko') text('K.O.', W / 2, H * 0.45, Math.max(20, 16 * s), '#ef4444', 'center', true);
      if (g.paused) text(gw('Paused — click to carry on'), W / 2, H * 0.45, Math.max(13, 9 * s), ink, 'center', true);
      if (g.mode === 'lost') {
        text(g.c.def.name + ' ' + gw('wins.') + ' ' + gw('You reached level') + ' ' + g.level + '.', W / 2, H * 0.4, Math.max(14, 10 * s), ink, 'center', true);
        text(gw('Enter or click: try this level again · Esc: choose another fighter'), W / 2, H * 0.4 + 12 * s, Math.max(11, 7 * s), mute, 'center');
      }
      if (g.mode === 'champion') {
        text(g.p.def.name + ' ' + gw('is the champion!'), W / 2, H * 0.4, Math.max(16, 12 * s), '#eab308', 'center', true);
        text(gw('Enter or click: play again'), W / 2, H * 0.4 + 12 * s, Math.max(11, 7 * s), mute, 'center');
      }
    }
    var cells = [];
    function drawSelect(ink, mute, ring) {
      var W = g.W, H = g.H, n = roster.length, cw = Math.min(90, (W - 40) / n), hh = Math.min(H * 0.42, cw * 1.2), x0 = (W - cw * n) / 2, y0 = H * 0.2;
      text(gw('Costareen Brawl — choose your fighter'), W / 2, Math.max(16, H * 0.12), Math.max(13, H * 0.07), ink, 'center', true);
      cells = [];
      roster.forEach(function (d, i) {
        var x = x0 + i * cw, sel = i === g.pick, iw = hh / 34 * 28;
        if (sel) { ctx.fillStyle = d.color; ctx.globalAlpha = 0.2; ctx.fillRect(x + 2, y0 - 4, cw - 4, hh + 26); ctx.globalAlpha = 1; ctx.strokeStyle = d.color; ctx.lineWidth = 2; ctx.strokeRect(x + 2, y0 - 4, cw - 4, hh + 26); }
        ctx.drawImage(d.img, x + (cw - iw) / 2, y0, iw, hh);
        text(d.name, x + cw / 2, y0 + hh + 15, Math.max(10, Math.min(13, cw / 7)), sel ? ink : mute, 'center', sel);
        cells.push([x, y0 - 4, cw, hh + 26]);
      });
      var d = roster[g.pick];
      text(gw('Special') + ': ' + gw(MOVES[d.move]) + (best ? '   ·   ' + gw('Best') + ': ' + gw('level') + ' ' + best : ''), W / 2, y0 + hh + 36, Math.max(11, H * 0.05), mute, 'center');
      text(gw('← → choose · Enter fight  |  A punch · S kick · D special · ↑ jump · ↓ block · hold F power up, F when full: Print Blast'), W / 2, Math.min(H - 8, y0 + hh + 54), Math.max(10, H * 0.042), mute, 'center');
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
      if (c === 'Escape') { api.pause(); cv.blur(); return; }
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

    var api = {
      size: g.size,
      pause: function () { if (loopOn() && !g.paused) { g.paused = true; stopLoop(); held = {}; draw(); } },
      stop: function () { dead = true; stopLoop(); },
      draw: draw,
      state: function () { return loopOn() ? (g.paused ? 'paused' : 'run') : 'idle'; },
      _g: g
    };
    return api;
  };
})();
