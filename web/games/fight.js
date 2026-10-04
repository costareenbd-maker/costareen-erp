/*
 * Costareen Brawl v3 - a small fighting game for the strip under New invoice.
 * Story: beat everyone (best of 3 rounds each), the last one is the Spaghetti Monster. Endless: waves that never stop.
 * Loaded only when its tab is opened. The fighters' faces are not in this file: they come from the
 * business's own data (erpFighters), so nobody's photo sits in a public file.
 *
 * Units: the arena is 128 units high, the floor at 120 from the top; x grows to the right, y grows UP from the floor.
 * Bodies are skeletons posed by joint angles and tweened between key poses. Sounds are made in code (no files).
 */
(function () {
  'use strict';
  var MOVES = {
    whip: ['Filament Whip', 'a long lash of hot filament: hits from far away', 'WHIP STORM', 'five lashes in a row'],
    spool: ['Spool Throw', 'a spool rolls along the floor at the enemy', 'SPOOL STORM', 'spools rain down on him'],
    dash: ['Hot Nozzle Dash', 'a burning dash punch: knocks down', 'INFERNO RUSH', 'a burning rush of hits'],
    resin: ['Resin Splash', 'a sticky blob: the puddle slows the enemy', 'RESIN FLOOD', 'the whole floor gets sticky, blobs fall'],
    wall: ['Layer Wall', 'prints a wall that stops attacks', 'WALL CRUSH', 'two walls print and crush him'],
    pillars: ['Support Pillars', 'pillars print up under the enemy', 'MEGA PILLAR', 'a giant pillar throws him sky high'],
    laser: ['Laser Engraver', 'a laser beam across the floor', 'LASER SWEEP', 'the laser sweeps from the sky to the floor'],
    slam: ['Heated Bed Slam', 'jump and slam: a shockwave both ways', 'EARTHQUAKE', 'three shockwaves'],
    flurry: ['Speed Print 300', 'a storm of very fast punches', 'SPEED PRINT 1000', 'a hundred fists and an uppercut']
  };
  var OUTFITS = ['tshirt', 'panjabi', 'vest', 'tracksuit', 'tshirt', 'panjabi', 'vest', 'tracksuit', 'suit'];
  var TAUNTS = ['Ei workshop amar!', 'Aj tor print fail hobe!', 'Filament dhore rakh, beta!', 'Ami 300 mm/s e mari!', 'Tor nozzle gorom kore dibo!',
    'Bed level kore nish, porbi!', 'Spaghetti banabo tore!', 'Ek layer o chharbo na!', 'Support chara darabi kemne?', 'Ami printer er Don!',
    'Tor warping thik kore dibo!', 'Infill 100% - bhangte parbi na!', 'Cooling fan bondho, ebar jolbi!', 'Retraction e palabi kothay?'];
  var OUT = '#141016', PANTS = '#2b3044', BOOT = '#16131a';
  var FIL = ['#ef4444', '#3b82f6', '#22c55e', '#eab308', '#f97316', '#a855f7', '#f1f5f9'];
  var WORDS_HIT = ['POW!', 'BAM!', 'WHAM!', 'THUD!', 'KRAK!', 'BOOM!', 'SMASH!'];

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
  function shade(hex, k) {   // k < 0 darker, k > 0 lighter
    var n = parseInt(hex.slice(1), 16), r = n >> 16, g2 = (n >> 8) & 255, b = n & 255;
    var f = function (v) { return Math.max(0, Math.min(255, Math.round(k < 0 ? v * (1 + k) : v + (255 - v) * k))); };
    return 'rgb(' + f(r) + ',' + f(g2) + ',' + f(b) + ')';
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
  var BOSS = { name: 'Spaghetti Monster', move: 'whip', color: '#f59e0b', boss: true, taunt: 'Ami tomader shob failed print!' };

  // ---- sound, made in code; off until switched on (M or the speaker)
  var AC = null, NOISE = null, soundOn = false, music = null;
  try { soundOn = localStorage.getItem('erp_fight_sound') === '1'; } catch (e) {}
  function ac() {
    if (!AC) { var C = window.AudioContext || window.webkitAudioContext; if (!C) return null; AC = new C(); var n = AC.sampleRate; NOISE = AC.createBuffer(1, n, n); var d = NOISE.getChannelData(0); for (var i = 0; i < n; i++) d[i] = Math.random() * 2 - 1; }
    if (AC.state === 'suspended') AC.resume();
    return AC;
  }
  function tone(type, f0, f1, dur, vol, delay) {
    var a = ac(); if (!a) return; var t = a.currentTime + (delay || 0);
    var o = a.createOscillator(), gn = a.createGain(); o.type = type; o.frequency.setValueAtTime(f0, t); if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    gn.gain.setValueAtTime(vol, t); gn.gain.exponentialRampToValueAtTime(0.001, t + dur); o.connect(gn); gn.connect(a.destination); o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(dur, vol, fq, kind, f1) {
    var a = ac(); if (!a) return; var t = a.currentTime;
    var s = a.createBufferSource(), fl = a.createBiquadFilter(), gn = a.createGain(); s.buffer = NOISE; fl.type = kind || 'lowpass'; fl.frequency.setValueAtTime(fq, t); if (f1) fl.frequency.exponentialRampToValueAtTime(f1, t + dur);
    gn.gain.setValueAtTime(vol, t); gn.gain.exponentialRampToValueAtTime(0.001, t + dur); s.connect(fl); fl.connect(gn); gn.connect(a.destination); s.start(t); s.stop(t + dur + 0.02);
  }
  function snd(k) {
    if (!soundOn) return;
    try {
      if (k === 'hit') { noise(0.09, 0.5, 1400); tone('sine', 180, 70, 0.1, 0.4); }
      else if (k === 'heavy') { noise(0.18, 0.7, 900); tone('sine', 120, 40, 0.22, 0.6); }
      else if (k === 'block') { tone('square', 900, 600, 0.05, 0.12); noise(0.04, 0.2, 3000, 'highpass'); }
      else if (k === 'whoosh') noise(0.14, 0.18, 500, 'bandpass', 2400);
      else if (k === 'jump') tone('sine', 260, 520, 0.12, 0.12);
      else if (k === 'super') { tone('sawtooth', 110, 55, 0.9, 0.25); noise(0.9, 0.35, 300, 'bandpass', 3000); }
      else if (k === 'charge') tone('triangle', 200 + Math.random() * 200, 0, 0.06, 0.05);
      else if (k === 'ko') { tone('sine', 660, 0, 1.4, 0.35); tone('sine', 990, 0, 1.2, 0.2); noise(0.3, 0.5, 600); }
      else if (k === 'round') { tone('square', 523, 0, 0.12, 0.12); tone('square', 784, 0, 0.25, 0.12, 0.13); }
      else if (k === 'pick') tone('square', 660, 0, 0.05, 0.08);
      else if (k === 'throw') { tone('square', 140, 70, 0.12, 0.18); tone('square', 110, 60, 0.14, 0.16, 0.1); noise(0.22, 0.25, 400, 'bandpass', 1600); }
      else if (k === 'slam') { noise(0.3, 0.8, 500); tone('sine', 90, 30, 0.35, 0.7); }
      else if (k === 'parry') { tone('sine', 1760, 0, 0.35, 0.25); tone('triangle', 2637, 0, 0.25, 0.15); noise(0.05, 0.3, 5000, 'highpass'); }
      else if (k === 'crack') { noise(0.07, 0.7, 2500, 'highpass'); tone('square', 320, 70, 0.12, 0.3); noise(0.2, 0.5, 700); }
      else if (k === 'finish') { tone('sawtooth', 82, 48, 1.3, 0.3); tone('sawtooth', 123, 70, 1.3, 0.15); noise(1.2, 0.2, 300, 'lowpass'); }
      else if (k === 'brutal') { tone('square', 220, 55, 0.45, 0.3); noise(0.35, 0.6, 600); }
      else if (k === 'win') [523, 659, 784, 1046].forEach(function (f, i) { tone('square', f, 0, 0.18, 0.1, i * 0.12); });
    } catch (e) {}
  }
  function musicOn(on) {
    if (music) { clearInterval(music); music = null; }
    if (!on || !soundOn) return;
    var bass = [55, 55, 82, 73, 55, 55, 98, 82], i = 0;
    music = setInterval(function () { try { tone('triangle', bass[i % 8], 0, 0.2, 0.08); if (i % 2 === 0) noise(0.05, 0.08, 7000, 'highpass'); if (i % 4 === 2) noise(0.1, 0.15, 900); } catch (e) {} i++; }, 220);
  }

  // ---- poses: angles in degrees from straight down, positive = towards the enemy
  var P = {
    idle: { L: 6, hy: 29, sF: 38, eF: 108, sB: 18, eB: 118, hF: 22, kF: -30, hB: -14, kB: -18 },
    block: { L: 0, hy: 26, sF: 58, eF: 140, sB: 48, eB: 145, hF: 26, kF: -38, hB: -16, kB: -26 },
    air: { L: 4, hy: 30, sF: 62, eF: 92, sB: 40, eB: 100, hF: 62, kF: -95, hB: 18, kB: -85 },
    hit: { L: -26, hy: 28, sF: -24, eF: 30, sB: -40, eB: 22, hF: 8, kF: -8, hB: -22, kB: -10 },
    charge: { L: 0, hy: 25, sF: 28, eF: -12, sB: 30, eB: -12, hF: 36, kF: -36, hB: -36, kB: -24 },
    win: { L: 0, hy: 30, sF: 172, eF: 12, sB: 20, eB: 110, hF: 12, kF: -6, hB: -10, kB: -4 },
    dizzy: { L: -8, hy: 27, sF: 10, eF: 20, sB: -10, eB: 20, hF: 14, kF: -20, hB: -10, kB: -16 }
  };
  function mix(a, b, t) { var o = {}; for (var k in a) o[k] = a[k] + (b[k] - a[k]) * t; return o; }
  function over(base, ch) { var o = {}; for (var k in base) o[k] = base[k]; for (var j in ch) o[j] = ch[j]; return o; }
  function ease(t) { return t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t); }
  function keys(t, fr) {
    if (t <= fr[0][0]) return fr[0][1];
    for (var i = 1; i < fr.length; i++) if (t <= fr[i][0]) return mix(fr[i - 1][1], fr[i][1], ease((t - fr[i - 1][0]) / (fr[i][0] - fr[i - 1][0])));
    return fr[fr.length - 1][1];
  }
  var I = P.idle;
  var PUNCH = over(I, { sF: 88, eF: 2, L: 16, sB: 10 }), CROSS = over(I, { sB: 92, eB: 0, L: 24, sF: 26, eF: 125, hF: 32, hB: -24 }), UPPER = over(I, { sF: 168, eF: 18, hy: 32, L: -6 });
  var ATK = {
    jab: { start: 0.06, act: 0.1, end: 0.24, reach: 30, dmg: 5, kb: 80, hy: 50, next: 'cross', snd: 'hit',
      fr: [[0, over(I, { sF: 22, eF: 128, L: 4 })], [0.07, PUNCH], [0.15, PUNCH], [0.24, I]] },
    cross: { start: 0.07, act: 0.11, end: 0.26, reach: 33, dmg: 6, kb: 90, hy: 52, next: 'upper', snd: 'hit',
      fr: [[0, over(I, { sB: 12, eB: 130, L: 2 })], [0.08, CROSS], [0.16, CROSS], [0.26, I]] },
    upper: { start: 0.1, act: 0.12, end: 0.38, reach: 28, dmg: 10, kb: 100, hy: 58, lift: 360, knock: 1, heavy: 1,
      fr: [[0, over(I, { sF: 8, eF: 60, hy: 24, L: 14, hF: 34, kF: -50 })], [0.12, UPPER], [0.24, UPPER], [0.38, I]] },
    kick: { start: 0.1, act: 0.11, end: 0.34, reach: 44, dmg: 9, kb: 150, hy: 38, heavy: 1,
      fr: [[0, I], [0.08, over(I, { hF: 86, kF: -112, L: -8, hB: -6, kB: -8 })], [0.14, over(I, { hF: 98, kF: 0, L: -22, hB: -8, kB: -6 })], [0.22, over(I, { hF: 98, kF: 0, L: -22, hB: -8, kB: -6 })], [0.34, I]] },
    sweep: { start: 0.1, act: 0.12, end: 0.42, reach: 46, dmg: 7, kb: 60, hy: 5, low: 1, knock: 1,
      fr: [[0, over(I, { hy: 18, L: 26 })], [0.12, { L: 34, hy: 12, sF: 70, eF: 60, sB: 10, eB: 80, hF: 92, kF: 0, hB: -40, kB: 120 }], [0.28, { L: 34, hy: 12, sF: 70, eF: 60, sB: 10, eB: 80, hF: 92, kF: 0, hB: -40, kB: 120 }], [0.42, I]] },
    airkick: { start: 0.04, act: 0.3, end: 0.4, reach: 38, dmg: 9, kb: 160, hy: 22, heavy: 1, air: 1,
      fr: [[0, P.air], [0.06, { L: -12, hy: 30, sF: 40, eF: 90, sB: 70, eB: 60, hF: 74, kF: 0, hB: -12, kB: -70 }], [0.4, { L: -12, hy: 30, sF: 40, eF: 90, sB: 70, eB: 60, hF: 74, kF: 0, hB: -12, kB: -70 }]] },
    whip: { start: 0.16, act: 0.12, end: 0.46, reach: 100, dmg: 10, kb: 160, hy: 48, heavy: 1, knock: 1, snd: 'whoosh',
      fr: [[0, over(I, { sF: -40, eF: 110, L: -6 })], [0.16, over(I, { sF: 100, eF: 0, L: 18 })], [0.32, over(I, { sF: 100, eF: 0, L: 18 })], [0.46, I]] },
    flurry: { start: 0.06, act: 0.5, end: 0.75, reach: 34, dmg: 3, kb: 25, hy: 50, multi: 7 },
    backfist: { start: 0.12, act: 0.1, end: 0.38, reach: 32, dmg: 11, kb: 220, hy: 52, heavy: 1,
      fr: [[0, over(I, { L: -12, sF: -30, eF: 70, sB: 40, eB: 120 })], [0.12, over(I, { L: -20, sF: 100, eF: 0, hF: 30, hB: -32 })], [0.24, over(I, { L: -20, sF: 100, eF: 0, hF: 30, hB: -32 })], [0.38, I]] },
    dropkick: { start: 0.06, act: 0.32, end: 0.5, reach: 36, dmg: 13, kb: 340, hy: 30, heavy: 1, knock: 1, air: 1,
      fr: [[0, P.air], [0.06, { L: -42, hy: 32, sF: -60, eF: 40, sB: -80, eB: 40, hF: 95, kF: 0, hB: 86, kB: 0 }], [0.5, { L: -42, hy: 32, sF: -60, eF: 40, sB: -80, eB: 40, hF: 95, kF: 0, hB: 86, kB: 0 }]] },
    divekick: { start: 0.02, act: 0.6, end: 0.6, reach: 30, dmg: 10, kb: 220, hy: 14, heavy: 1, air: 1,
      fr: [[0, { L: -20, hy: 30, sF: -40, eF: 60, sB: -60, eB: 50, hF: 58, kF: 0, hB: -20, kB: -80 }], [0.6, { L: -20, hy: 30, sF: -40, eF: 60, sB: -60, eB: 50, hF: 58, kF: 0, hB: -20, kB: -80 }]] },
    airpunch: { start: 0.03, act: 0.12, end: 0.26, reach: 28, dmg: 6, kb: 90, hy: 46, lift: 200, air: 1, next: 'airkick',
      fr: [[0, P.air], [0.04, { L: 20, hy: 30, sF: 95, eF: 0, sB: 20, eB: 110, hF: 60, kF: -90, hB: 20, kB: -80 }], [0.26, P.air]] },
    elbowdrop: { start: 0.08, act: 0.3, end: 0.45, reach: 30, dmg: 9, kb: 40, hy: 6, otg: 1, air: 1,
      fr: [[0, P.air], [0.08, { L: 62, hy: 18, sF: 150, eF: 150, sB: 30, eB: 60, hF: 70, kF: -120, hB: -20, kB: -60 }], [0.45, { L: 62, hy: 18, sF: 150, eF: 150, sB: 30, eB: 60, hF: 70, kF: -120, hB: -20, kB: -60 }]] },
    crusher: { start: 0.25, act: 0.9, end: 1.3, reach: 34, dmg: 10, kb: 30, hy: 50, multi: 3, heavy: 1, crush: 1, last: { knock: 1, kb: 320, lift: 320 },
      fr: [[0, over(I, { L: -10, sF: -40, eF: 120, sB: -30, eB: 120 })], [0.25, over(I, { L: 22, sF: 95, eF: 0, sB: 20, eB: 120, hF: 40, hB: -30 })], [0.55, over(I, { L: 26, sB: 95, eB: 0, sF: 20, eF: 120, hF: 40, hB: -30 })], [0.85, over(I, { L: -8, sF: 170, eF: 15, hy: 32 })], [1.3, I]] },
    risingknee: { start: 0.04, act: 0.2, end: 0.42, reach: 26, dmg: 10, kb: 120, hy: 52, lift: 440, heavy: 1, knock: 1, air: 1,
      fr: [[0, P.air], [0.05, { L: -12, hy: 30, sF: 150, eF: 30, sB: -40, eB: 60, hF: 112, kF: -150, hB: -20, kB: -40 }], [0.42, { L: -12, hy: 30, sF: 150, eF: 30, sB: -40, eB: 60, hF: 112, kF: -150, hB: -20, kB: -40 }]] },
    headbutt: { start: 0.11, act: 0.08, end: 0.34, reach: 20, dmg: 7, kb: 70, hy: 72, daze: 1,
      fr: [[0, over(I, { L: -14 })], [0.11, over(I, { L: 42, sF: 20, eF: 120, sB: 10, eB: 120 })], [0.2, over(I, { L: 42, sF: 20, eF: 120, sB: 10, eB: 120 })], [0.34, I]] },
    charge: { start: 0.03, act: 0.3, end: 0.46, reach: 26, dmg: 11, kb: 400, hy: 46, heavy: 1, knock: 1, dashv: 470,
      fr: [[0, I], [0.04, over(I, { L: 36, sF: 20, eF: 90, sB: 10, eB: 120, hF: 52, kF: -52, hB: -42, kB: -20 })], [0.46, over(I, { L: 36, sF: 20, eF: 90, sB: 10, eB: 120, hF: 52, kF: -52, hB: -42, kB: -20 })]] },
    slide: { start: 0.05, act: 0.3, end: 0.5, reach: 30, dmg: 8, kb: 80, hy: 4, low: 1, knock: 1, lift: 300, dashv: 390,
      fr: [[0, I], [0.05, { L: -62, hy: 10, sF: -90, eF: 30, sB: -100, eB: 30, hF: 86, kF: 0, hB: 70, kB: 30 }], [0.5, { L: -62, hy: 10, sF: -90, eF: 30, sB: -100, eB: 30, hF: 86, kF: 0, hB: 70, kB: 30 }]] },
    tornado: { start: 0.04, act: 0.5, end: 0.6, reach: 30, dmg: 4, kb: 50, hy: 30, air: 1, multi: 4, last: { knock: 1, kb: 300, lift: 260 },
      fr: [[0, P.air], [0.05, { L: -10, hy: 30, sF: 90, eF: 20, sB: -90, eB: 20, hF: 92, kF: 0, hB: -30, kB: -60 }], [0.6, { L: -10, hy: 30, sF: 90, eF: 20, sB: -90, eB: 20, hF: 92, kF: 0, hB: -30, kB: -60 }]] },
    grab: { start: 0.07, act: 0.07, end: 0.45, reach: 26, dmg: 0, kb: 0, hy: 50, grab: 1,
      fr: [[0, I], [0.07, over(I, { sF: 80, eF: 20, sB: 70, eB: 30, L: 20 })], [0.45, I]] },
    dash: { start: 0.06, act: 0.3, end: 0.5, reach: 26, dmg: 12, kb: 200, hy: 48, heavy: 1, knock: 1,
      fr: [[0, over(I, { L: 20, sF: 10, eF: 120 })], [0.08, over(I, { L: 30, sF: 92, eF: 0, sB: -30, eB: 30, hF: 60, kF: -40, hB: -50, kB: -30 })], [0.4, over(I, { L: 30, sF: 92, eF: 0, sB: -30, eB: 30, hF: 60, kF: -40, hB: -50, kB: -30 })], [0.5, I]] },
    // the supers that are moves of the body
    whipstorm: { start: 0.1, act: 0.8, end: 1.05, reach: 140, dmg: 5, kb: 60, hy: 48, multi: 5, last: { knock: 1, kb: 260 } },
    inferno: { start: 0.05, act: 0.6, end: 0.85, reach: 30, dmg: 5, kb: 40, hy: 48, multi: 5, dashv: 520, last: { knock: 1, kb: 300 } },
    flurry1000: { start: 0.05, act: 0.9, end: 1.15, reach: 36, dmg: 2.2, kb: 12, hy: 50, multi: 14, last: { lift: 460, knock: 1, kb: 120 } }
  };
  var CAST = [[0, over(I, { sF: -42, eF: 110, sB: -32, eB: 110, L: -6 })], [0.2, over(I, { sF: -46, eF: 116, sB: -36, eB: 116, L: -8 })],
              [0.32, { L: 12, hy: 27, sF: 90, eF: 0, sB: 86, eB: 0, hF: 42, kF: -32, hB: -32, kB: -10 }], [0.9, { L: 12, hy: 27, sF: 90, eF: 0, sB: 86, eB: 0, hF: 42, kF: -32, hB: -32, kB: -10 }]];
  var SLAM = [[0, over(P.air, { sF: 172, eF: 0, sB: 166, eB: 0 })], [0.6, over(P.air, { sF: 172, eF: 0, sB: 166, eB: 0 })]];
  var LAND = { L: 34, hy: 18, sF: 120, eF: 0, sB: 110, eB: 0, hF: 50, kF: -80, hB: -40, kB: -60 };
  var DIFF = { easy: 0.65, normal: 1, hard: 1.4 };

  window.ERP_FIGHT = function (cv, opts) {
    opts = opts || {};
    var gw = opts.words || function (t) { return t; };
    var roster = (opts.roster && opts.roster.length >= 2 ? opts.roster : PLAIN).map(function (d, i) {
      var h = 0; for (var q = 0; q < d.name.length; q++) h = (h * 31 + d.name.charCodeAt(q)) >>> 0;
      return { name: d.name, move: d.move, color: d.color, head: d.head, img: headCanvas(d.head),
        white: headCanvas({ w: d.head.w, h: d.head.h, pal: ['#ffffff'], px: d.head.px.replace(/[^.]/g, '0') }),
        skin: skinOf(d.head), outfit: d.outfit || OUTFITS[i % OUTFITS.length], taunt: d.taunt || TAUNTS[h % TAUNTS.length] };
    });
    var ctx = cv.getContext('2d');
    var g = { mode: 'select', W: 0, H: 0, s: 1, pick: 0, level: 1, opps: [], p: null, c: null, t: 0, paused: false,
      freeze: 0, shake: 0, slow: 1, flash: 0, tut: -1, tutT: 0, tutDone: {}, zoom: 1, zx: 0, zy: 0, dim: 0, banner: null,
      round: 1, pW: 0, cW: 0, timer: 60, endless: false, blood: true, fin: null, koChecked: 0, streak: 0, diff: 'normal', cracks: [] };
    try { g.blood = localStorage.getItem('erp_fight_blood') !== '0'; } catch (e) {}
    try { g.diff = localStorage.getItem('erp_fight_diff') || 'normal'; g.endless = localStorage.getItem('erp_fight_mode') === 'endless'; } catch (e) {}
    if (!DIFF[g.diff]) g.diff = 'normal';
    var pcv = null, pctx = null, hitT = {}, raf = 0, last = 0, dead = false, held = {}, hit = {}, lastTap = {}, fx = [], shots = [], walls = [], puddles = [], pend = [], beams = [], waves = [], pops = [];
    var best = opts.bestGet ? opts.bestGet() : 0, bestEndless = 0, bg = null, now = 0;
    try { bestEndless = Number(localStorage.getItem('erp_fight_endless')) || 0; } catch (e) {}
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
      return { def: def, x: x, y: 0, vx: 0, vy: 0, dir: dir, hp: boss ? 180 : 100, max: boss ? 180 : 100, ghost: boss ? 180 : 100, pw: 0,
        st: 'idle', t: 0, atk: null, cd: 0, done: 0, kx: 0, flash: 0, ai: null, mul: 1, L: L || 0, blockT: 0, chargeT: 0,
        queue: null, queue2: null, walkPh: 0, inv: 0, trail: [], downT: 0, ko: false, heavies: [], juggles: 0, bounced: false,
        combo: 0, comboT: 0, seen: {}, punish: 0, react: null };
    }
    function opp(f) { return f === g.p ? g.c : g.p; }
    function free(f) { return f.st === 'idle' || f.st === 'walk' || f.st === 'block' || f.st === 'charge'; }
    function begin(f, st, atk) { if (st !== 'down') f.rag = null;
      f.st = st; f.t = 0; f.done = 0; f.atk = atk || null; f.queue = null; f.queue2 = null; f.trail = []; }
    function beginOld(f, st, atk) { f.st = st; f.t = 0; f.done = 0; f.atk = atk || null; f.queue = null; f.queue2 = null; f.trail = []; }
    function attack(f, name) {
      begin(f, 'atk', name);
      if (name === 'dropkick') { f.vy = 300; f.vx = f.dir * 330; snd('whoosh'); }
      if (name === 'divekick') { f.vy = -560; f.vx = f.dir * 380; f.flip = 0; snd('whoosh'); }
      if (name === 'elbowdrop') { f.vy = 230; f.vx = f.dir * 120; }
      if (name === 'risingknee') { f.vy = Math.max(f.vy, 430); f.vx = f.dir * 80; snd('whoosh'); }
      if (name === 'charge' || name === 'slide' || name === 'headbutt') snd('whoosh');
      if (name === 'airpunch' && f.vy < 120) f.vy = Math.max(f.vy, 120);   // a little hang in the air for juggles
      if (name === 'dash' || name === 'inferno') dust(f.x, 6);
      if (ATK[name].snd === 'whoosh' || name === 'kick' || name === 'sweep') snd('whoosh');
      if (f === g.p) { g.c.seen[name] = (g.c.seen[name] || 0) + 1; if (name === 'upper') tutMark('combo'); }
    }
    function special(f) {
      if (f.cd > 0) return false;
      f.cd = 2.4;
      var k = f.def.move;
      if (k === 'whip' || k === 'flurry' || k === 'dash') { attack(f, k); return true; }
      begin(f, 'special'); snd('whoosh');
      if (k === 'slam') { f.vy = 360; snd('jump'); }
      return true;
    }
    function superMove(f) {
      f.pw = 0; begin(f, 'super'); snd('super');
      g.banner = { f: f, t: 1.1, name: f.def.boss ? 'SPAGHETTI STORM' : MOVES[f.def.move][2] };
      g.dim = 0.7; g.zoom = 1.1; g.zx = f.x; g.zy = 50;
    }
    function tip(f) {
      var a = f.atk && ATK[f.atk];
      var y = a ? a.hy : 48, r = a ? Math.min(a.reach, 40) : 24;
      return { x: f.x + f.dir * (10 + r), y: f.y + y };
    }
    function hurt(att, tgt, dmg, kb, o) {
      o = o || {};
      if (g.mode !== 'fight' || tgt.inv > 0 || tgt.st === 'rise') return false;
      if (tgt.st === 'down' && o.otg) {
        if (tgt.ko) return false;
        var dd = Math.round(dmg * att.mul * 10) / 10; tgt.hp = Math.max(g.tut >= 0 && tgt === g.c ? 25 : 0, tgt.hp - dd);
        burst(tgt.x, tgt.y + 10, att.def.color, 1.4); g.freeze = 0.1; g.shake = Math.max(g.shake, 6); snd('slam'); sweat(tgt, 6);
        pops.push({ x: tgt.x, y: tgt.y + 40, t: 0.8, s: '-' + Math.round(dd), c: '#fde047', size: 7 }); pops.push({ x: tgt.x, y: tgt.y + 60, t: 0.8, s: gw('ELBOW DROP!'), c: att.def.color, size: 11, word: 1 });
        if (tgt.rag) { tgt.rag.t = 0; for (var kq in tgt.rag.pts) { var pq = tgt.rag.pts[kq]; pq.py = pq.y + 1.5; } }
        if (tgt.hp <= 0) { tgt.ko = true; g.mode = 'ko'; g.t = 0; g.slow = 0.45; g.flash = 0.3; snd('ko'); musicOn(false); pops.push({ x: tgt.x, y: 90, t: 1.4, s: gw('FINISH!'), c: att.def.color, size: 18, word: 1 }); }
        att.pw = Math.min(100, att.pw + 8); return true;
      }
      if (tgt.st === 'down') {
        if (tgt.ko || tgt.y < 8 || tgt.juggles >= 4) return false;
        tgt.juggles++;
        if (tgt.rag) {   // a juggle: the hit throws the flying ragdoll again
          var jd = Math.round(dmg * att.mul * 10) / 10, jdir = att.x < tgt.x ? 1 : -1; tgt.hp = Math.max(g.tut >= 0 && tgt === g.c ? 25 : 0, tgt.hp - jd);
          for (var kj in tgt.rag.pts) { var pj = tgt.rag.pts[kj]; pj.px = pj.x - jdir * (kb + 60) / 60 * 0.6; pj.py = pj.y - (o.lift || 260) / 60 * 0.8; }
          burst((att.x + tgt.x) / 2, tgt.y + 30, att.def.color, 1.3); g.freeze = 0.07; snd('hit'); att.combo = (att.comboT > 0 ? att.combo : 0) + 1; att.comboT = 0.9;
          pops.push({ x: tgt.x, y: tgt.y + 40, t: 0.7, s: '-' + Math.round(jd), c: '#fde047', size: 7 });
          if (att.combo >= 3) pops.push({ x: att.x, y: att.y + 100, t: 0.7, s: att.combo + ' ' + gw('HITS!'), c: '#fde047', size: 9, word: 1 });
          if (tgt.hp <= 0) { tgt.ko = true; g.mode = 'ko'; g.t = 0; g.slow = 0.45; g.flash = 0.3; snd('ko'); musicOn(false); pops.push({ x: tgt.x, y: 90, t: 1.4, s: gw('FINISH!'), c: att.def.color, size: 18, word: 1 }); }
          return true;
        }
        o.lift = Math.max(o.lift || 0, 240);
      }
      if (o.low && tgt.y > 6) return false;
      var blocked = !o.unblockable && tgt.st === 'block' && (tgt.x - att.x) * tgt.dir < 0;
      if (blocked && now - (tgt.blockAt || -9) < 0.16) {
        burst((att.x + tgt.x) / 2, tgt.y + 50, '#93c5fd', 1.8); g.flash = 0.18; g.freeze = 0.2; g.shake = Math.max(g.shake, 4);
        pops.push({ x: tgt.x, y: tgt.y + 100, t: 0.9, s: gw('PARRY!'), c: '#93c5fd', size: 14, word: 1 }); snd('parry');
        tgt.pw = Math.min(100, tgt.pw + 15); begin(att, 'hit'); att.kx = (att.x < tgt.x ? -1 : 1) * 160; att.flash = 0.15;
        return true;
      }
      var d = Math.round(dmg * att.mul * (blocked ? 0.15 : 1) * 10) / 10;
      if (tgt.st === 'dizzy') d *= 1.3;
      tgt.hp = Math.max(g.tut >= 0 && tgt === g.c ? 25 : 0, tgt.hp - d);
      att.pw = Math.min(100, att.pw + (blocked ? 3 : 6 + dmg * 0.5)); tgt.pw = Math.min(100, tgt.pw + 4);
      if (!blocked) { att.combo = (att.comboT > 0 ? att.combo : 0) + 1; att.comboT = 0.9; }
      var at = o.at || { x: (att.x + tgt.x) / 2, y: tgt.y + 48 };
      burst(at.x, at.y, blocked ? '#cbd5e1' : att.def.color, o.heavy && !blocked ? 1.6 : 1, blocked);
      if (!blocked) { sweat(tgt, o.heavy ? 6 : 3); bleed(at.x, at.y, att.x < tgt.x ? 1 : -1, o.heavy ? 5 : 2); }
      if (!blocked && att.combo >= 5 && !att.brutal && o.heavy) {
        att.brutal = 1; o.knock = 1; kb = Math.max(kb, 380); o.lift = Math.max(o.lift || 0, 340);
        g.slow = 0.35; g.slowAt = now; g.flash = 0.2; g.shake = 10; snd('brutal'); setTimeout(function () { if (g.mode === 'fight') g.slow = 1; }, 650);
        pops.push({ x: tgt.x, y: tgt.y + 110, t: 1.1, s: gw('BRUTAL!'), c: '#ef4444', size: 18, word: 1 });
      }
      pops.push({ x: at.x, y: at.y + 14, t: 0.8, s: blocked ? gw('BLOCK') : '-' + Math.round(d), c: blocked ? '#cbd5e1' : '#fde047', size: 7 });
      if (o.heavy && !blocked) { pops.push({ x: at.x + (Math.random() - 0.5) * 20, y: at.y + 30, t: 0.75, s: WORDS_HIT[Math.floor(Math.random() * WORDS_HIT.length)], c: att.def.color, size: 13, word: 1 }); g.zoom = Math.max(g.zoom, 1.05); g.zx = at.x; g.zy = at.y; }
      if (att.combo >= 3 && !blocked) pops.push({ x: att.x, y: att.y + 100, t: 0.7, s: att.combo + ' ' + gw('HITS!'), c: '#fde047', size: 9, word: 1 });
      snd(blocked ? 'block' : o.heavy ? 'heavy' : 'hit');
      g.freeze = blocked ? 0.04 : o.heavy ? 0.14 : 0.07;
      g.shake = Math.max(g.shake, blocked ? 1.5 : o.heavy ? 7 : 3);
      if (blocked) { tgt.kx = (att.x < tgt.x ? 1 : -1) * kb * 0.6; tgt.vx = tgt.kx; if (tgt === g.c) tgt.punish = 0.35; return true; }
      if (tgt.hp <= 0) {
        knock(tgt, att, 340, true); g.mode = 'ko'; g.t = 0; g.slow = 0.45; g.flash = 0.3; g.shake = 12; g.zoom = 1.15; g.zx = tgt.x; g.zy = 40;
        pops.push({ x: tgt.x, y: 90, t: 1.4, s: gw('FINISH!'), c: att.def.color, size: 18, word: 1 }); snd('ko'); musicOn(false);
        return true;
      }
      if (o.heavy) { tgt.heavies.push(now); tgt.heavies = tgt.heavies.filter(function (t) { return now - t < 2.5; }); }
      if (o.knock || o.lift) { knock(tgt, att, o.lift || 230); return true; }
      if (tgt.heavies.length >= 3) { tgt.heavies = []; begin(tgt, 'dizzy'); tgt.kx = 0; pops.push({ x: tgt.x, y: tgt.y + 98, t: 1, s: gw('DIZZY!'), c: '#facc15', size: 10, word: 1 }); return true; }
      begin(tgt, 'hit'); tgt.kx = (att.x < tgt.x ? 1 : -1) * kb; tgt.flash = 0.12; tgt.hitCount = (tgt.hitCount || 0) + 1;
      return true;
    }
    function knock(tgt, att, vy, ko) {
      var pose0 = poseOf(tgt);
      begin(tgt, 'down'); tgt.vy = vy; tgt.kx = (att.x < tgt.x ? 1 : -1) * (ko ? 260 : 190); tgt.flash = 0.15; tgt.ko = !!ko; tgt.downT = 0; tgt.bounced = false;
      if (!tgt.def.boss) { tgt.rag = ragOf(tgt, pose0, tgt.kx * 1.2, vy); tgt.rag.owner = tgt; }
    }
    function ragOf(f, pose, vx, vy) {
      var J = joints(pose), pts = {}, d0 = 1 / 60;
      var map = { hip: J.hip, neck: J.neck, head: { x: J.neck.x + Math.sin(rad(J.L)) * 14, y: J.neck.y + Math.cos(rad(J.L)) * 14 },
        eF: J.aF[1], hF: J.aF[2], eB: J.aB[1], hB: J.aB[2], kF: J.lF[1], fF: J.lF[2], kB: J.lB[1], fB: J.lB[2] };
      for (var k in map) { var x = f.x + f.dir * map[k].x, y = f.y + map[k].y, sp = k === 'head' ? 1.2 : 1; pts[k] = { x: x, y: y, px: x - vx * sp * d0, py: y - vy * sp * d0 }; }
      var st = [['head', 'neck'], ['neck', 'hip'], ['neck', 'eF'], ['eF', 'hF'], ['neck', 'eB'], ['eB', 'hB'], ['hip', 'kF'], ['kF', 'fF'], ['hip', 'kB'], ['kB', 'fB'], ['head', 'hip'], ['eF', 'eB']];
      return { pts: pts, st: st.map(function (q) { var a = pts[q[0]], b = pts[q[1]]; return [q[0], q[1], Math.hypot(a.x - b.x, a.y - b.y)]; }) };
    }
    function stepRag(r, dt) {   // fixed 1/60 s steps, so slow motion only slows it down
      r.acc = (r.acc || 0) + dt; r.t = (r.t || 0) + dt;
      while (r.acc >= 1 / 60) { r.acc -= 1 / 60; ragStep(r, 1 / 60); }
    }
    function ragStep(r, dt) {
      for (var k in r.pts) {
        var p = r.pts[k], vx = (p.x - p.px) * 0.995, vy = (p.y - p.py) * 0.995;
        p.px = p.x; p.py = p.y; p.x += vx; p.y += vy - 1300 * dt * dt;
        if (p.y < 0) { p.y = 0; p.py = p.y + vy * 0.35; p.px = p.x - vx * 0.7; if (vy < -4 && (k === 'hip' || k === 'head')) { dust(p.x, 4); g.shake = Math.max(g.shake, 2); } }
        if (p.x < 8 || p.x > AW() - 8) {
          if (Math.abs(vx) > 4.5 && (k === 'hip' || k === 'head') && !r.splat && r.owner) {   // slammed into the edge of the floor
            r.splat = 1; g.shake = Math.max(g.shake, 9); burst(p.x, p.y + 10, '#fff', 1.4); snd('slam');
            pops.push({ x: p.x, y: p.y + 40, t: 0.9, s: gw('WALL SPLAT!'), c: '#ef4444', size: 12, word: 1 });
            if (!r.owner.ko) r.owner.hp = Math.max(1, r.owner.hp - 4);
          }
          p.x = p.x < 8 ? 8 : AW() - 8; p.px = p.x + vx * 0.45;
        }
      }
      for (var it = 0; it < 4; it++) r.st.forEach(function (q) { var a = r.pts[q[0]], b = r.pts[q[1]], dx = b.x - a.x, dy = b.y - a.y, dd = Math.hypot(dx, dy) || 0.01, df = (dd - q[2]) / dd * 0.5; a.x += dx * df; a.y += dy * df; b.x -= dx * df; b.y -= dy * df; });
    }
    function drawRag(f) {
      var r = f.rag, P2 = r.pts, s = g.s, d = f.def;
      function L2(a, b, w, c) { ctx.strokeStyle = c; ctx.lineWidth = w * s; ctx.beginPath(); ctx.moveTo(sx(P2[a].x), sy(P2[a].y)); ctx.lineTo(sx(P2[b].x), sy(P2[b].y)); ctx.stroke(); }
      ctx.lineCap = 'round';
      [['hip', 'kB', 10.5, OUT], ['kB', 'fB', 9.5, OUT], ['hip', 'kF', 10.5, OUT], ['kF', 'fF', 9.5, OUT], ['neck', 'eB', 9, OUT], ['eB', 'hB', 8, OUT], ['neck', 'eF', 9, OUT], ['eF', 'hF', 8, OUT], ['neck', 'hip', 17, OUT]].forEach(function (q) { L2(q[0], q[1], q[2], q[3]); });
      [['hip', 'kB', 8.5, PANTS], ['kB', 'fB', 7.5, PANTS], ['hip', 'kF', 8.5, PANTS], ['kF', 'fF', 7.5, PANTS], ['neck', 'eB', 7, d.color], ['eB', 'hB', 6, d.skin], ['neck', 'eF', 7, d.color], ['eF', 'hF', 6, d.skin], ['neck', 'hip', 15, d.color]].forEach(function (q) { L2(q[0], q[1], q[2], q[3]); });
      var hd = P2.head, nk = P2.neck, an = Math.atan2(-(hd.y - nk.y), hd.x - nk.x) + Math.PI / 2;
      ctx.save(); ctx.translate(sx(hd.x), sy(hd.y)); ctx.rotate(an); ctx.scale(f.dir, 1); ctx.drawImage(d.img, -13 * s, -17.5 * s, 26 * s, 32 * s); ctx.restore();
    }
    function burst(x, y, c, big, soft) {
      fx.push({ kind: 'ring', x: x, y: y, t: 0.25, T: 0.25, c: c, r: (soft ? 6 : 10) * big });
      if (!soft) { fx.push({ kind: 'star', x: x, y: y, t: 0.13, T: 0.13, c: '#fff', r: 15 * big }); fx.push({ kind: 'flashball', x: x, y: y, t: 0.08, T: 0.08, r: 9 * big }); }
      for (var i = 0; i < (soft ? 5 : 14 * big); i++) fx.push({ kind: 'dot', x: x, y: y, vx: (Math.random() - 0.5) * 360, vy: Math.random() * 280 - 60, t: 0.45, T: 0.45, c: Math.random() < 0.5 ? c : '#fff' });
    }
    function bleed(x, y, dir, n) { if (!g.blood) return; for (var i = 0; i < n; i++) fx.push({ kind: 'blood', x: x, y: y, vx: dir * (40 + Math.random() * 220) + (Math.random() - 0.5) * 60, vy: 60 + Math.random() * 200, t: 0.7, T: 0.7 }); }
    function sweat(f, n) { for (var i = 0; i < n; i++) fx.push({ kind: 'drop', x: f.x + (Math.random() - 0.5) * 8, y: f.y + 70 + Math.random() * 10, vx: -f.dir * (60 + Math.random() * 120), vy: 80 + Math.random() * 120, t: 0.6, T: 0.6 }); }
    function dust(x, n) { for (var i = 0; i < n; i++) fx.push({ kind: 'dust', x: x + (Math.random() - 0.5) * 14, y: 2, vx: (Math.random() - 0.5) * 90, vy: Math.random() * 30, t: 0.5, T: 0.5, r: 3 + Math.random() * 3 }); }
    function inReach(f, a) {
      var o = opp(f), front = (o.x - f.x) * f.dir, ay = f.y + a.hy;
      return front > -6 && front < 11 + a.reach && ay > o.y - 6 && ay < o.y + 86;
    }

    function stepFighter(f, dt) {
      var o = opp(f), k = f.def.move;
      f.t += dt; f.cd = Math.max(0, f.cd - dt); f.flash = Math.max(0, f.flash - dt); f.inv = Math.max(0, f.inv - dt); f.punish = Math.max(0, f.punish - dt);
      f.comboT = Math.max(0, f.comboT - dt); if (f.comboT <= 0) f.brutal = 0;
      if (f.ghost > f.hp) f.ghost = Math.max(f.hp, f.ghost - 40 * dt);
      var slow = puddles.some(function (p) { return p.owner !== f && Math.abs(f.x - p.x) < p.w / 2 && f.y === 0; }) ? 0.4 : 1;
      if ((free(f) || f.st === 'win') && f.y === 0) f.dir = o.x >= f.x ? 1 : -1;
      if (f.st === 'throwing') {
        var v = f.victim, lift = Math.min(1, f.t / 0.3);
        f.vx = 0;
        if (v && v.st === 'thrown') { v.x = f.x + f.dir * (14 - lift * 16); v.y = f.y + lift * 46; v.dir = -f.dir; }
        if (f.t > 0.42 && v && v.st === 'thrown') {
          var back = f === g.p ? (held.ArrowLeft ? -1 : held.ArrowRight ? 1 : f.dir) : (Math.random() < 0.35 ? -f.dir : f.dir);
          v.x = f.x + back * 12; v.y = f.y + 40;
          var dmg = 12 * f.mul; v.hp = Math.max(g.tut >= 0 && v === g.c ? 25 : 0, v.hp - dmg);
          burst(v.x, v.y + 30, f.def.color, 1.6); g.shake = 8; g.freeze = 0.1; snd('whoosh'); snd('slam');
          pops.push({ x: v.x, y: v.y + 70, t: 0.9, s: gw('THROW!'), c: f.def.color, size: 12, word: 1 });
          if (v.hp <= 0) { knock(v, f, 420, true); v.kx = back * 380; g.mode = 'ko'; g.t = 0; g.slow = 0.45; g.flash = 0.3; snd('ko'); musicOn(false); pops.push({ x: v.x, y: 90, t: 1.4, s: gw('FINISH!'), c: f.def.color, size: 18, word: 1 }); }
          else { knock(v, f, 380); v.kx = back * 360; v.bounced = false; }
          f.victim = null;
        }
        if (f.t > 0.62) begin(f, 'idle');
      } else if (f.st === 'kneeing') {
        var vk = f.victim; f.vx = 0;
        if (vk && vk.st === 'thrown') { vk.x = f.x + f.dir * 20; vk.y = 0; vk.dir = -f.dir; }
        [0.15, 0.3, 0.45].forEach(function (tt, i) { if (f.t >= tt && (f.knees || 0) <= i && vk) { f.knees = i + 1; var dk = 4 * f.mul; vk.hp = Math.max(g.tut >= 0 && vk === g.c ? 25 : 0, vk.hp - dk); burst(vk.x, 40, f.def.color, 1.1); snd('hit'); g.freeze = 0.06; g.shake = Math.max(g.shake, 3); bleed(vk.x, 40, f.dir, 2); pops.push({ x: vk.x, y: 70, t: 0.6, s: '-' + Math.round(dk), c: '#fde047', size: 7 }); } });
        if (f.t > 0.6 && vk && vk.st === 'thrown') { f.victim = null; f.knees = 0; if (vk.hp <= 0) { knock(vk, f, 300, true); g.mode = 'ko'; g.t = 0; g.slow = 0.45; snd('ko'); musicOn(false); } else { knock(vk, f, 200); vk.kx = f.dir * 300; } }
        if (f.t > 0.75) { f.kneeGrab = 0; begin(f, 'idle'); }
      } else if (f.st === 'thrown') {
        if (!opp(f).victim) { begin(f, 'down'); f.vy = 100; f.downT = 0; }
        f.x = Math.max(14, Math.min(AW() - 14, f.x)); return;
      } else if (f.st === 'atk') {
        var a = ATK[f.atk];
        if (a.grab) {
          if (!f.done && f.t >= a.start && f.t <= a.start + a.act && inReach(f, a) && o.y < 8 && ['down', 'rise', 'thrown', 'air'].indexOf(o.st) < 0 && o.inv <= 0) {
            f.done = 1;
            var breakIt = o === g.c ? Math.random() < Math.min(0.35, 0.05 + 0.04 * o.L) * DIFF[g.diff] : hit.KeyW;
            if (breakIt) { delete hit.KeyW; burst((f.x + o.x) / 2, o.y + 50, '#fff', 1); pops.push({ x: o.x, y: o.y + 95, t: 0.8, s: gw('BREAK!'), c: '#fff', size: 10, word: 1 }); begin(f, 'hit'); f.kx = -f.dir * 160; o.kx = f.dir * 160; begin(o, 'hit'); }
            else if (f.kneeGrab) { begin(f, 'kneeing'); f.victim = o; begin(o, 'thrown'); o.vx = 0; o.vy = 0; snd('throw'); }
            else { begin(f, 'throwing'); f.victim = o; begin(o, 'thrown'); o.vx = 0; o.vy = 0; snd('throw'); }
            return;
          }
          if (f.t > a.end) begin(f, 'idle');
          f.vx = 0;
        } else {
        if (f.atk === 'tornado') { f.flip = 1; f.flipDir = 1; }
        if ((f.atk === 'charge' || f.atk === 'slide') && f.t > a.start && f.t < a.start + a.act) { f.vx = f.dir * a.dashv * (1 - (f.t - a.start) / a.act * 0.5); if (f.atk === 'slide' && Math.random() < 0.6) dust(f.x, 2); }
        if ((f.atk === 'dash' || f.atk === 'inferno') && f.t > a.start && f.t < a.start + a.act) {
          f.vx = f.dir * (a.dashv || 470);
          if (Math.random() < 0.7) fx.push({ kind: 'fire', x: f.x - f.dir * 10, y: 20 + Math.random() * 40, vx: -f.dir * 60, vy: 40, t: 0.35, T: 0.35 });
          if (f.atk === 'inferno' && Math.abs(f.x - o.x) < 30) f.vx = f.dir * 60;
        }
        var on = f.t >= a.start && f.t <= a.start + a.act;
        if (on && a.multi && f.atk !== 'whipstorm' && f.atk !== 'inferno' && Math.abs(o.x - f.x) > 26) f.vx = f.dir * 140;   // keeps up with him
        if (on && a.multi) {
          var n = Math.floor((f.t - a.start) / (a.act / a.multi));
          if (n >= f.done && f.done < a.multi) {
            f.done = n + 1; var lastHit = f.done === a.multi && a.last;
            if (f.atk === 'whipstorm') snd('whoosh');
            if (a.crush && inReach(f, a)) { snd('crack'); g.flash = 0.16; g.freeze = 0.2; g.zoom = 1.14; g.zx = o.x; g.zy = o.y + 50; pops.push({ x: o.x + (Math.random() - 0.5) * 20, y: o.y + 70, t: 0.8, s: gw('CRACK!'), c: '#f8fafc', size: 14, word: 1 }); bleed(o.x, o.y + 50, f.dir, 6); }
            if (inReach(f, a)) hurt(f, o, a.dmg * (lastHit ? 2 : 1), lastHit ? a.last.kb : a.kb, lastHit ? { heavy: 1, knock: a.last.knock, lift: a.last.lift, at: tip(f) } : { at: tip(f) });
          }
        } else if (on && !f.done && inReach(f, a)) {
          f.done = 1; if (hurt(f, o, a.dmg, a.kb, { heavy: a.heavy, knock: a.knock, lift: a.lift, low: a.low, otg: a.otg, at: tip(f) }) && a.daze && o.st === 'hit') { begin(o, 'dizzy'); o.t = 0.5; pops.push({ x: o.x, y: o.y + 98, t: 0.9, s: gw('DIZZY!'), c: '#facc15', size: 10, word: 1 }); snd('crack'); }
        }
        if (f.atk === 'jab' || f.atk === 'cross' || f.atk === 'upper' || f.atk === 'kick') { if (f.t > a.start - 0.03 && f.t < a.start + a.act) f.trail.push(tip(f)); if (f.trail.length > 6) f.trail.shift(); }
        if (a.air) { if (f.y === 0 && f.t > 0.05) { var heavyLand = f.atk === 'divekick' || f.atk === 'elbowdrop' || f.atk === 'dropkick'; begin(f, 'idle'); dust(f.x, heavyLand ? 10 : 4); if (heavyLand) { g.shake = Math.max(g.shake, 3); snd('hit'); } } }
        else if (f.t > a.end) {
          f.vx = 0; if (a.crush) { g.slow = 1; g.dim = 0; }
          if (f.queue && ATK[f.queue]) { var q2 = f.queue2; attack(f, f.queue); f.queue = q2; } else begin(f, 'idle');
        }
        }
      } else if (f.st === 'special') {
        if (k === 'spool' && f.t > 0.3 && !f.done) { f.done = 1; shots.push({ kind: 'spool', owner: f, x: f.x + f.dir * 24, y: 9, vx: f.dir * 330, vy: 0, dmg: 10, spin: 0, trail: [] }); }
        if (k === 'resin' && f.t > 0.3 && !f.done) { f.done = 1; shots.push({ kind: 'resin', owner: f, x: f.x + f.dir * 22, y: 50, vx: f.dir * 250, vy: 140, dmg: 6, trail: [] }); }
        if (k === 'wall' && f.t > 0.3 && !f.done) { f.done = 1; walls.push({ owner: f, x: f.x + f.dir * 44, t: 3.2, h: 0 }); }
        if (k === 'pillars' && f.t > 0.3 && !f.done) { f.done = 1; pend.push({ owner: f, x: o.x, t: 0.5, up: 0, w: 1, dmg: 12, lift: 380 }); }
        if (k === 'laser' && f.t > 0.32 && !f.done) { f.done = 1; beams.push({ owner: f, kind: 'laser', t: 0.22, T: 0.22, dmg: 9, y: 50, hit: 0 }); g.shake = Math.max(g.shake, 2); }
        if (k === 'slam') {
          if (f.t > 0.3 && f.y > 0) f.vy -= 2200 * dt;
          if (f.y === 0 && f.t > 0.12 && !f.done) { f.done = 1; waves.push({ owner: f, x: f.x, t: 0, hit: 0, dmg: 11 }); g.shake = 9; dust(f.x, 14); crack(f.x); snd('heavy'); }
        }
        if (f.t > (k === 'slam' ? 0.9 : 0.75)) begin(f, 'idle');
      } else if (f.st === 'super') {
        stepSuper(f, o, dt);
      } else if (f.st === 'hit') {
        f.vx = f.kx; f.kx *= 0.86;
        if (f.t > 0.32) { begin(f, 'idle'); f.vx = 0; f.hitCount = 0; }
      } else if (f.st === 'dizzy') {
        if (f.t > 1.3) begin(f, 'idle');
      } else if (f.st === 'down' && f.rag) {
        stepRag(f.rag, dt); var hp0 = f.rag.pts.hip; f.x = hp0.x; f.y = Math.max(0, hp0.y - 24); f.vx = 0; f.vy = 0;
        if (!f.ko && f.rag.t > 0.9 && Math.hypot(hp0.x - hp0.px, hp0.y - hp0.py) < 0.5 && hp0.y < 14) { f.rag = null; f.y = 0; begin(f, 'rise'); f.inv = 0.6; f.juggles = 0; dust(f.x, 6); }
        return;
      } else if (f.st === 'down') {
        f.vx = f.kx; f.kx *= 0.93;
        // flung into the edge of the floor: bounce off it
        if (!f.bounced && Math.abs(f.kx) > 110 && (f.x <= 15 || f.x >= AW() - 15)) {
          f.bounced = true; f.kx = -f.kx * 0.45; f.vy = Math.max(f.vy, 220); g.shake = 10; burst(f.x, f.y + 40, '#fff', 1.4);
          pops.push({ x: f.x, y: f.y + 80, t: 0.9, s: gw('WALL SPLAT!'), c: '#ef4444', size: 12, word: 1 }); snd('heavy');
          if (!f.ko) f.hp = Math.max(1, f.hp - 4);
        }
        if (f.y === 0) { f.downT += dt; if (f.downT < dt * 1.5) { dust(f.x, 10); g.shake = Math.max(g.shake, 4); snd('hit'); } }
        if (!f.ko && f.downT > 0.7) { begin(f, 'rise'); f.inv = 0.6; f.juggles = 0; }
      } else if (f.st === 'rise') {
        if (f.t > 0.35) begin(f, 'idle');
      } else if (f.st === 'charge') {
        f.pw = Math.min(100, f.pw + 32 * dt);
        if (Math.random() < 0.6) fx.push({ kind: 'spark', x: f.x + (Math.random() - 0.5) * 40, y: Math.random() * 20, vx: 0, vy: 140 + Math.random() * 80, t: 0.5, T: 0.5, c: f.def.color });
        if (Math.random() < 0.15) snd('charge');
      } else if (f.st === 'walk') {
        f.walkPh += dt * 9 * slow;
      }
      if (f.st !== 'walk' && f.st !== 'hit' && f.st !== 'down' && !(f.st === 'atk' && (f.atk === 'dash' || f.atk === 'inferno' || f.atk === 'charge' || f.atk === 'slide' || ATK[f.atk].multi)) && f.st !== 'dashstep' && f.y === 0 && f.punish <= 0) f.vx = 0;
      if (f.st === 'dashstep') { if (f.t > 0.18) begin(f, 'idle'); }
      if (f.st === 'block' && f.y === 0) { f.vx *= 0.8; }
      var nx = f.x + f.vx * dt * (f.st === 'walk' ? slow : 1);
      walls.forEach(function (w) { if (w.owner !== f && w.h > 30 && ((f.x < w.x && nx > w.x - 14) || (f.x > w.x && nx < w.x + 14))) nx = f.x < w.x ? w.x - 14 : w.x + 14; });
      f.x = Math.max(14, Math.min(AW() - 14, nx));
      if (f.flip && f.y > 0) f.spin = (f.spin || 0) - dt * 760 * (f.flipDir || 1);
      if (f.y > 0 || f.vy > 0) {
        var wasAir = f.y > 0;
        f.vy -= 1300 * dt; f.y = Math.max(0, f.y + f.vy * dt);
        if (f.y === 0) { f.vy = 0; f.flip = 0; f.spin = 0; if (wasAir && f.st !== 'down') dust(f.x, 4); if (f.st === 'air') begin(f, 'idle'); }
      }
      if (Math.abs(f.x - o.x) < 22 && Math.abs(f.y - o.y) < 40 && f.st !== 'down' && o.st !== 'down') f.x = o.x + (f.x <= o.x ? -22 : 22);
      f.x = Math.max(14, Math.min(AW() - 14, f.x));
    }
    function crack(x) { g.cracks.push({ x: x, t: 4, seed: Math.random() }); if (g.cracks.length > 6) g.cracks.shift(); }

    // ---- each fighter's own super (F when the power bar is full)
    function stepSuper(f, o, dt) {
      var k = f.def.boss ? 'boss' : f.def.move, t = f.t;
      if (t < 0.55) { f.vx = 0; return; }                 // the build-up (banner, dark screen)
      if (!f.done) {
        f.done = 1; g.dim = 0;
        if (k === 'whip') { attack(f, 'whipstorm'); return; }
        if (k === 'dash') { attack(f, 'inferno'); return; }
        if (k === 'flurry') { attack(f, 'flurry1000'); return; }
        if (k === 'spool') for (var i = 0; i < 7; i++) shots.push({ kind: 'spool', owner: f, x: o.x + (i - 3) * 16 + (Math.random() - 0.5) * 8, y: 130 + i * 22, vx: 0, vy: -320, dmg: 5, spin: 0, trail: [], rain: 1 });
        if (k === 'resin') { puddles.push({ owner: f, x: o.x, w: 220, t: 4 }); for (var j = 0; j < 4; j++) shots.push({ kind: 'resin', owner: f, x: o.x + (j - 1.5) * 26, y: 140 + j * 20, vx: 0, vy: -200, dmg: 6, trail: [] }); }
        if (k === 'wall') { walls.push({ owner: f, x: Math.max(16, o.x - 34), t: 1.6, h: 0, crush: 1 }); walls.push({ owner: f, x: Math.min(AW() - 16, o.x + 34), t: 1.6, h: 0, crush: -1 }); pend.push({ owner: f, x: o.x, t: 0.55, up: 0, w: 2.2, dmg: 22, lift: 280, crush: 1 }); }
        if (k === 'pillars') pend.push({ owner: f, x: o.x, t: 0.35, up: 0, w: 2.6, dmg: 22, lift: 560, mega: 1 });
        if (k === 'laser') beams.push({ owner: f, kind: 'sweep', t: 0.7, T: 0.7, dmg: 22, y: 50, hit: 0 });
        if (k === 'slam') { f.vy = 420; f.quake = 3; }
        if (k === 'boss') { for (var q = 0; q < 5; q++) pend.push({ owner: f, x: o.x + (q - 2) * 30, t: 0.25 + q * 0.12, up: 0, w: 1.2, dmg: 7, lift: 300, tendril: 1 }); }
        g.shake = 8; g.flash = 0.12;
      }
      if (k === 'slam' && f.quake) {
        if (f.y > 0 && t > 0.75) f.vy -= 2600 * dt;
        if (f.y === 0 && t > 0.62) { waves.push({ owner: f, x: f.x, t: 0, hit: 0, dmg: 10, soft: f.quake > 1 }); crack(f.x); g.shake = 12; dust(f.x, 16); snd('heavy'); f.quake--; if (f.quake > 0) f.vy = 300; }
      }
      if (t > (k === 'slam' ? 2.4 : 1.6)) begin(f, 'idle');
    }

    // ---- the player's keys
    function backflip(f) { f.vy = 430; f.vx = -f.dir * 240; f.flip = 1; f.flipDir = -1; f.inv = 0.35; begin(f, 'air'); snd('whoosh'); dust(f.x, 5); }
    function wallJump(f) { var away = f.x < AW() / 2 ? 1 : -1; f.dir = away; f.vy = 480; f.vx = away * 320; f.flip = 1; f.flipDir = 1; begin(f, 'air'); snd('jump'); burst(f.x - away * 6, f.y + 30, '#fff', 0.8, true); pops.push({ x: f.x, y: f.y + 70, t: 0.6, s: gw('WALL JUMP'), c: '#e5e7eb', size: 8, word: 1 }); }
    function superJump(f, o) { var dx = o.x - f.x; f.dir = dx >= 0 ? 1 : -1; f.vy = 560; f.vx = Math.max(-420, Math.min(420, dx * 2.2)); f.flip = 0; begin(f, 'air'); snd('jump'); dust(f.x, 8); f.airChase = 1; }
    function crusher(f) {
      f.pw = 0; attack(f, 'crusher'); g.dim = 0.6; g.slow = 0.55; g.slowAt = now; snd('finish');
      g.banner = { f: f, t: 1.0, name: gw('CRUSHER') };
    }
    function use(k) { if (!hit[k]) return false; delete hit[k]; return true; }
    function player(f) {
      if (f.st === 'charge' && !held.KeyF) begin(f, 'idle');
      if (f.st === 'block' && !held.ArrowDown) begin(f, 'idle');
      if (f.st === 'atk' && hit.KeyA && ATK[f.atk].next) { delete hit.KeyA; if (!f.queue) f.queue = ATK[f.atk].next; else if (ATK[f.queue] && ATK[f.queue].next) f.queue2 = ATK[f.queue].next; }
      // a hit that lands can be cancelled straight into the special or the super
      if (f.st === 'atk' && f.done && !ATK[f.atk].grab) {
        if (hit.KeyD && f.cd <= 0) { use('KeyD'); special(f); tutMark('special'); pops.push({ x: f.x, y: f.y + 100, t: 0.6, s: gw('CANCEL!'), c: '#93c5fd', size: 8, word: 1 }); return; }
        if (hit.KeyF && f.pw >= 100) { use('KeyF'); superMove(f); tutMark('super'); return; }
      }
      var awayKey = f.dir > 0 ? 'ArrowLeft' : 'ArrowRight', towardKey = f.dir > 0 ? 'ArrowRight' : 'ArrowLeft';
      if (f.st === 'air' || (f.st === 'atk' && ATK[f.atk].air && f.done && f.y > 0)) {
        if ((f.x < 22 || f.x > AW() - 22) && use('ArrowUp')) { wallJump(f); return; }   // kick off the edge
        if (use('KeyA')) { var oz = opp(f); attack(f, f.vy > 0 && Math.abs(oz.x - f.x) < 44 && Math.abs(oz.y - f.y) < 50 ? 'risingknee' : 'airpunch'); tutMark('kick'); return; }
        if (hit.KeyS) { use('KeyS'); attack(f, held.ArrowDown ? 'divekick' : held.ArrowUp ? 'tornado' : 'airkick'); tutMark('kick'); return; }
      }
      // after a launch: jump after him for an air combo
      if (free(f) && f.y === 0 && hit.ArrowUp && opp(f).st === 'down' && opp(f).y > 20 && !opp(f).ko) { use('ArrowUp'); superJump(f, opp(f)); return; }
      if (f.st === 'dashstep' && hit.KeyA) { use('KeyA'); attack(f, 'charge'); return; }
      if (!free(f)) return;
      if (use('KeyW')) { f.kneeGrab = held.ArrowDown ? 1 : 0; attack(f, 'grab'); return; }
      if (f.st === 'dashstep' && use('KeyA')) { attack(f, 'charge'); return; }
      if (use('KeyA')) {
        var oq = opp(f);
        if (held.ArrowDown && oq.st === 'down' && !oq.ko && Math.abs(oq.x - f.x) < 60) { attack(f, 'elbowdrop'); return; }
        attack(f, held[awayKey] ? 'backfist' : (held[towardKey] && Math.abs(oq.x - f.x) < 34) ? 'headbutt' : 'jab'); tutMark('punch'); return;
      }
      if (use('KeyS')) { var moving = held[towardKey] && (f.st === 'walk' || f.st === 'dashstep' || now - (f.walkAt || -9) < 0.3); attack(f, held.ArrowDown ? (moving ? 'slide' : 'sweep') : moving ? 'dropkick' : 'kick'); tutMark('kick'); return; }
      if (hit.KeyD && f.cd <= 0) { use('KeyD'); special(f); tutMark('special'); return; }
      if (hit.KeyF && f.pw >= 100 && held.ArrowDown) { use('KeyF'); crusher(f); return; }
      if (hit.KeyF && f.pw >= 100) { use('KeyF'); superMove(f); tutMark('super'); return; }
      if (held.KeyF && f.pw < 100) { if (f.st !== 'charge') begin(f, 'charge'); tutMark('charge'); return; }
      if (held.ArrowDown) { if (f.st !== 'block') { begin(f, 'block'); f.blockAt = now; } tutMark('block'); return; }
      if (use('ArrowUp') && f.y === 0) {
        if (held[awayKey]) { backflip(f); tutMark('jump'); return; }
        f.vy = 440; f.vx = held.ArrowLeft ? -170 : held.ArrowRight ? 170 : 0; f.flip = f.vx !== 0 && Math.random() < 0.5 ? 1 : 0; f.flipDir = 1; begin(f, 'air'); snd('jump'); tutMark('jump'); return;
      }
      ['ArrowLeft', 'ArrowRight'].forEach(function (k) {
        if (use(k)) { if (now - (lastTap[k] || 0) < 0.25) { begin(f, 'dashstep'); f.vx = (k === 'ArrowLeft' ? -1 : 1) * 400; dust(f.x, 5); snd('whoosh'); } lastTap[k] = now; }
      });
      if (f.st === 'dashstep') return;
      if (held.ArrowLeft || held.ArrowRight) { f.st = 'walk'; f.vx = held.ArrowLeft ? -150 : 150; f.walkAt = now; }
      else if (f.st === 'walk') begin(f, 'idle');
    }

    // ---- the computer: reads your attacks, blocks, steps away, hits back, breaks combos and learns your habits
    function computer(f, dt) {
      var o = g.p, dist = Math.abs(o.x - f.x);
      if (g.tut >= 0) { if (free(f)) { if (dist > 60) { f.st = 'walk'; f.vx = (o.x > f.x ? 1 : -1) * 60; } else begin(f, 'idle'); } return; }
      var L = f.L, skill = Math.min(1, (0.22 + 0.085 * L) * DIFF[g.diff]);
      var react = Math.max(0.05, 0.42 - 0.34 * skill), aggr = 0.3 + 0.55 * skill;
      f.ai = f.ai || { t: 0.4, dir: 0 };
      f.ai.t -= dt;
      // chains its own combos
      if (f.st === 'atk' && ATK[f.atk].next && f.t > ATK[f.atk].start && !f.queue && Math.random() < (0.15 + 0.7 * skill) * dt * 12) f.queue = ATK[f.atk].next;
      // combo breaker: caught in a combo with power to spare, it bursts free
      if (f.st === 'hit' && (f.hitCount || 0) >= 2 && f.pw >= 25 && Math.random() < skill * 0.6 * dt * 10) {
        f.pw -= 25; begin(f, 'idle'); f.inv = 0.4; o.kx = (o.x < f.x ? -1 : 1) * 260; begin(o, 'hit'); o.kx = (o.x < f.x ? -1 : 1) * 260;
        burst(f.x, f.y + 45, f.def.color, 1.8); pops.push({ x: f.x, y: f.y + 95, t: 0.9, s: gw('BREAK!'), c: f.def.color, size: 11, word: 1 }); g.shake = 6; snd('heavy');
        return;
      }
      if (f.st === 'block') {
        f.blockT -= dt;
        var still = (o.st === 'atk' && f.t < 1.2) || o.st === 'super' || shots.some(function (s) { return s.owner === o && Math.abs(s.x - f.x) < 90; });
        if (f.blockT <= 0 && !still) { begin(f, 'idle'); if (f.punish > 0 && dist < 50 && Math.random() < 0.4 + 0.6 * skill) attack(f, Math.random() < 0.5 ? 'jab' : 'upper'); }
        return;
      }
      if (f.st === 'charge') { f.chargeT -= dt; if (f.chargeT <= 0 || dist < 100) begin(f, 'idle'); return; }
      // in the air: finish the leap with a dive kick, chase a launched opponent with air hits, kick off the edge
      if (f.st === 'air') {
        var ddx = o.x - f.x;
        if (f.airChase && Math.abs(ddx) < 34 && Math.abs(o.y - f.y) < 40) { f.airChase = 0; attack(f, 'airpunch'); return; }
        if (f.divePlan && f.vy < 0 && Math.abs(ddx) < 120 && ddx * f.dir > 0 && o.y < 10) { f.divePlan = 0; attack(f, Math.random() < 0.3 ? 'tornado' : 'divekick'); return; }
        if ((f.x < 22 || f.x > AW() - 22) && f.vy < 100 && Math.random() < skill * 0.6) { wallJump(f); return; }
        return;
      }
      if (f.st === 'atk' && f.atk === 'airpunch' && f.done && f.t > 0.2 && Math.random() < skill) { attack(f, 'airkick'); return; }
      if (!free(f)) return;
      // he jumps at it: a flying knee to meet him
      if (o.st === 'air' && o.y > 10 && dist < 60 && f.y === 0 && Math.random() < skill * 0.5) { f.vy = 430; begin(f, 'air'); attack(f, 'risingknee'); return; }
      // someone on the floor: drop an elbow on him
      if (o.st === 'down' && !o.ko && o.y < 6 && dist < 46 && Math.random() < skill * 0.7) { attack(f, 'elbowdrop'); return; }
      // just launched him: jump after him
      if (o.st === 'down' && !o.ko && o.y > 24 && dist < 140 && Math.random() < skill * 0.75) { superJump(f, o); return; }
      // a missed move leaves a gap: punish it
      if (o.st === 'atk' && ATK[o.atk] && !o.done && o.t > ATK[o.atk].start + ATK[o.atk].act && dist < 46 && Math.random() < skill * 0.8) { attack(f, Math.random() < 0.5 ? 'upper' : 'jab'); return; }
      // you keep blocking: it throws you
      if (o.st === 'block' && dist < 30 && Math.random() < skill * 0.5 * dt * 10) { attack(f, 'grab'); return; }
      // what is coming at it?
      var threat = null;
      if (o.st === 'atk' && ATK[o.atk] && f.y === 0) { var a = ATK[o.atk], front = (f.x - o.x) * o.dir; if (front > -6 && front < 20 + a.reach) threat = a.low ? 'low' : 'high'; }
      if (o.st === 'super' || (o.st === 'special' && dist < 260)) threat = threat || 'big';
      if (shots.some(function (s) { return s.owner === o && (f.x - s.x) * Math.sign(s.vx || 1) > 0 && Math.abs(s.x - f.x) < 120; })) threat = threat || 'shot';
      if (threat && !f.react) f.react = { t: react * (0.7 + Math.random() * 0.6), what: threat };
      if (f.react) {
        f.react.t -= dt;
        if (f.react.t <= 0) {
          var w = f.react.what, r = Math.random(); f.react = null;
          if (r < 0.2 + 0.75 * skill) {
            var cornered = f.x < 50 || f.x > AW() - 50, habit = (f.seen.kick || 0) + (f.seen.sweep || 0) > (f.seen.jab || 0);
            if (w === 'low' || (w === 'shot' && Math.random() < 0.5)) { f.vy = 440; f.vx = (cornered ? 1 : -1) * f.dir * 120; begin(f, 'air'); return; }
            if (w === 'big' && !cornered && Math.random() < 0.5) { if (Math.random() < 0.5) backflip(f); else { begin(f, 'dashstep'); f.vx = -f.dir * 400; dust(f.x, 5); } return; }
            if (w === 'high' && !cornered && Math.random() < 0.25 * skill) { backflip(f); return; }
            if (o.st === 'atk' && ATK[o.atk] && ATK[o.atk].start > 0.09 && dist < 34 && Math.random() < 0.35 * skill) { attack(f, 'jab'); return; }   // hits first, through a slow move
            if (habit && Math.random() < 0.3) { f.vy = 440; f.vx = f.dir * 140; begin(f, 'air'); return; }    // it knows you love kicks: jumps in
            begin(f, 'block'); f.blockAt = now - (Math.random() < skill * 0.35 ? 0 : 0.2); f.blockT = 0.25 + Math.random() * 0.2; f.punish = 0;
            return;
          }
        }
      }
      // under the bar and in a corner: get out
      if (f.hp < f.max * 0.3 && (f.x < 40 || f.x > AW() - 40) && dist < 60 && Math.random() < skill * dt * 6) { f.vy = 480; f.vx = f.dir * 220; begin(f, 'air'); return; }
      if (f.ai.t > 0) { if (f.st === 'walk') f.vx = f.ai.dir * 150; return; }
      f.ai.t = react * (0.8 + Math.random() * 0.8);
      if (f.pw >= 100 && dist < 40 && Math.random() < 0.4) { crusher(f); return; }
      if (f.pw >= 100 && dist < 300) { superMove(f); return; }
      var ranged = ['spool', 'laser', 'pillars', 'resin', 'whip'].indexOf(f.def.move) >= 0;
      if (f.cd <= 0 && Math.random() < 0.15 + 0.25 * skill && (ranged ? dist < 320 : dist < 90)) { special(f); return; }
      var want = ranged && f.hp > f.max * 0.4 ? 120 : 34;
      if (dist > 190 && Math.random() < 0.18 + 0.3 * skill && !ranged) {   // a long flipping leap in, ready to dive
        f.vy = 470; f.vx = f.dir * Math.min(390, dist * 1.3); f.flip = 1; f.flipDir = 1; f.divePlan = 1; begin(f, 'air'); snd('jump'); dust(f.x, 6); return;
      }
      if (dist > 55 && dist < 120 && Math.random() < 0.12 + 0.12 * skill) { var rr = Math.random(); attack(f, rr < 0.4 ? 'dropkick' : rr < 0.7 ? 'charge' : 'slide'); return; }
      if (dist > want + 6) {
        if (Math.random() < aggr) { f.st = 'walk'; f.ai.dir = o.x > f.x ? 1 : -1; f.vx = f.ai.dir * 150; }
        else if (f.pw < 100 && dist > 170 && Math.random() < 0.5) { begin(f, 'charge'); f.chargeT = 0.8; }
        else { f.st = 'walk'; f.ai.dir = o.x > f.x ? -1 : 1; f.vx = f.ai.dir * 150; f.ai.t = 0.25; }
      } else if (dist < 30 && ranged && Math.random() < 0.4) { begin(f, 'dashstep'); f.vx = -f.dir * 380; }
      else {
        var r2 = Math.random();
        if (r2 < 0.08 + 0.1 * skill) { f.vy = 440; f.vx = f.dir * 120; begin(f, 'air'); return; }
        if (o.st === 'block' && Math.random() < skill) { attack(f, 'sweep'); return; }   // you block high: it goes low
        if (r2 < 0.05) f.kneeGrab = 1;
        attack(f, r2 < 0.1 ? 'grab' : r2 < 0.18 ? 'backfist' : r2 < 0.25 ? 'headbutt' : r2 < 0.58 ? 'jab' : r2 < 0.84 ? 'kick' : 'sweep');
      }
    }

    // ---- the lesson in the first fight
    var TUT = [
      ['punch', 'Press A to punch'], ['combo', 'Press A three times fast: a 3-hit combo with an uppercut'], ['kick', 'Press S to kick (↓+S sweeps his legs)'],
      ['block', 'Hold ↓ to block'], ['jump', 'Press ↑ to jump (S in the air: flying kick)'], ['special', 'Press D for your special'],
      ['charge', 'Hold F to power up'], ['super', 'Bar full? Press F for your SUPER']
    ];
    function tutMark(what) {
      if (g.tut < 0) return;
      g.tutDone[what] = 1;
      g.tut = 0; while (g.tut < TUT.length && g.tutDone[TUT[g.tut][0]]) g.tut++;
      if (TUT[g.tut] && TUT[g.tut][0] === 'super') g.p.pw = Math.max(g.p.pw, 100);
      if (g.tut >= TUT.length) endTut();
    }
    function endTut() { g.tut = -1; tutDone = true; try { localStorage.setItem('erp_fight_tut', '1'); } catch (e) {} pops.push({ x: AW() / 2, y: 70, t: 1.4, s: gw('Now fight!'), c: '#ef4444', size: 14, word: 1 }); }

    // ---- flow: story (best of 3 per level) or endless (one round each, health carries on)
    function startRun() {
      var me = roster[g.pick];
      g.opps = roster.filter(function (d) { return d !== me; });
      for (var i = g.opps.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), t = g.opps[i]; g.opps[i] = g.opps[j]; g.opps[j] = t; }
      g.opps.push(BOSS);
      g.level = 1; g.streak = 0; g.carry = null;
      intro(true);
    }
    function opponent() {
      if (!g.endless) return g.opps[g.level - 1];
      var me = roster[g.pick], pool = roster.filter(function (d) { return d !== me; });
      return g.level % 6 === 0 ? BOSS : pool[Math.floor(Math.random() * pool.length)];
    }
    function intro(newLevel) {
      var me = roster[g.pick], L = g.level;
      if (newLevel) { g.round = 1; g.pW = 0; g.cW = 0; g.them = opponent(); }
      var keepPw = g.p ? g.p.pw : 0;
      g.p = make(me, AW() * 0.3, 1); g.c = make(g.them, AW() * 0.7, -1, L);
      if (g.endless && g.carry !== null && g.carry !== undefined) g.p.hp = g.p.ghost = Math.min(g.p.max, g.carry + 35);
      if (!newLevel) g.p.pw = keepPw;
      g.c.mul = (0.75 + 0.08 * (Math.min(L, 14) - 1) + (g.them.boss ? 0.25 : 0)) * (0.8 + 0.2 * DIFF[g.diff]);
      if (g.endless && L > 14) g.c.mul += (L - 14) * 0.05;
      shots = []; walls = []; puddles = []; pend = []; beams = []; waves = []; fx = []; pops = []; g.cracks = [];
      g.tut = !tutDone && L === 1 && !g.endless ? 0 : -1; g.tutDone = {};
      g.mode = 'intro'; g.t = 0; g.slow = 1; g.timer = 60; g.banner = null; g.dim = 0; g.zoom = 1; g.koChecked = 0; g.fin = null;
      snd('round'); run();
    }
    var FIN = { whip: 'wrap', spool: 'spools', dash: 'launch', resin: 'tomb', wall: 'printover', pillars: 'launch', laser: 'engrave', slam: 'printover', flurry: 'wrap' };
    var FIN_SEQ = [['D', 'F', 'A'], ['B', 'F', 'S'], ['D', 'D', 'A'], ['F', 'D', 'S'], ['B', 'D', 'A'], ['F', 'F', 'W']];
    var FIN_EXTRA = ['bedflip', 'lasso', 'shrink', 'cube', 'cage', 'meltdown'];
    var FIN_NAME = { bedflip: 'BED FLIP', lasso: 'FILAMENT LASSO', shrink: 'SCALE 10%', cube: 'CALIBRATION CUBE', cage: 'SUPPORT CAGE', meltdown: 'THERMAL RUNAWAY', wrap: 'SPAGHETTI WRAP', spools: 'SPOOL STORM', launch: 'PILLAR LAUNCH', tomb: 'RESIN TOMB', printover: 'PRINT OVER', engrave: 'LASER ENGRAVE' };
    function startFinishHim(win, vic) {
      vic.rag = null; vic.ko = false; vic.y = 0; vic.vy = 0; vic.vx = 0; vic.kx = 0; begin(vic, 'dazed'); vic.hp = 0.0005;
      vic.x = Math.max(30, Math.min(AW() - 30, win.x + (vic.x >= win.x ? 1 : -1) * 46));
      win.y = 0; win.vy = 0; win.vx = 0; begin(win, 'idle'); win.dir = vic.x >= win.x ? 1 : -1; vic.dir = -win.dir;
      var seq = FIN_SEQ[Math.floor(Math.random() * FIN_SEQ.length)];
      var own = win.def.boss ? 'wrap' : (FIN[win.def.move] || 'printover');
      g.fin = { win: win, vic: vic, seq: seq, i: 0, kind: Math.random() < 0.45 ? own : FIN_EXTRA[Math.floor(Math.random() * FIN_EXTRA.length)], items: [] };
      vic.sc = 1; vic.hide = 0; vic.soot = 0;
      g.mode = 'finishhim'; g.t = 0; g.slow = 1; g.dim = 0.45; shots = []; beams = []; waves = []; pend = []; pops = [];
      snd('finish'); musicOn(false);
    }
    function finishKey(code) {
      var F = g.fin; if (!F || F.win !== g.p) return;
      var d = F.win.dir, sym = code === 'ArrowUp' ? 'U' : code === 'ArrowDown' ? 'D' : code === 'KeyA' ? 'A' : code === 'KeyS' ? 'S' : code === 'KeyW' ? 'W' :
        code === 'ArrowRight' ? (d > 0 ? 'F' : 'B') : code === 'ArrowLeft' ? (d > 0 ? 'B' : 'F') : '';
      if (!sym) return;
      if (sym === F.seq[F.i]) { F.i++; snd('pick'); if (F.i >= F.seq.length) doFinisher(); }
      else { F.i = sym === F.seq[0] ? 1 : 0; snd('block'); }
    }
    function doFinisher() {
      var F = g.fin; g.mode = 'finisher'; g.t = 0; g.dim = 0.55; F.items = [];
      begin(F.win, 'idle'); snd('super');
      if (F.kind === 'engrave') { begin(F.vic, 'down'); F.vic.vy = 120; F.vic.kx = F.win.dir * 60; F.vic.downT = 0; F.vic.ko = true; }
    }
    function missFinish() {
      var F = g.fin; F.vic.sc = 1; F.vic.hide = 0; F.vic.soot = 0; g.mode = 'ko'; g.t = 1.0; g.koChecked = 1; F.vic.hp = 0; knock(F.vic, F.win, 260, true); snd('ko');
    }
    function stepFinish(dt) {
      var F = g.fin; if (!F) return;
      if (g.mode === 'finishhim') {
        if (F.win === g.c && g.t > 1.1) { if (Math.random() < 0.65) doFinisher(); else missFinish(); return; }
        if (g.t > 3.6) { missFinish(); return; }
        return;
      }
      // g.mode === 'finisher'
      var v = F.vic, w = F.win, t = g.t;
      if (F.kind === 'spools') {
        if (t < 1.8 && Math.random() < 0.5) F.items.push({ x: v.x + (Math.random() - 0.5) * 34, y: 160 + Math.random() * 40, vy: -200, c: FIL[F.items.length % FIL.length], rest: 0 });
        F.items.forEach(function (it, i) { if (it.rest) return; it.vy -= 900 * dt; it.y += it.vy * dt; var floor = 8 + Math.floor(i / 4) * 13; if (it.y <= floor) { it.y = floor; it.rest = 1; if (i % 3 === 0) { dust(it.x, 3); snd('hit'); } } });
      } else if (F.kind === 'launch') {
        if (t > 0.35 && !F.launched) { F.launched = 1; g.shake = 12; snd('slam'); dust(v.x, 14); v.vy = 1100; begin(v, 'air'); }
        if (t > 2.4 && !F.landed) { F.landed = 1; v.x = Math.max(30, Math.min(AW() - 30, v.x)); v.y = 140; v.vy = -700; knock(v, w, -700, true); v.rag = ragOf(v, P.hit, 0, -700); v.rag.owner = v; v.ko = true; }
      } else if (F.kind === 'wrap') {
        if (t > 1.7) { v.x += w.dir * 260 * dt * Math.min(1, (t - 1.7) * 2); }
      } else if (F.kind === 'tomb') {
        if (t > 2.4 && !F.shattered) { F.shattered = 1; for (var i2 = 0; i2 < 40; i2++) fx.push({ kind: 'dot', x: v.x + (Math.random() - 0.5) * 30, y: Math.random() * 90, vx: (Math.random() - 0.5) * 400, vy: Math.random() * 300, t: 0.8, T: 0.8, c: Math.random() < 0.5 ? '#22c55e' : '#bbf7d0' }); g.shake = 10; snd('crack'); knock(v, w, 200, true); }
      } else if (F.kind === 'engrave') {
        if (Math.random() < 0.6 && t < 2.2) fx.push({ kind: 'dot', x: v.x - 40 + Math.min(1, t / 2) * 80, y: 1, vx: (Math.random() - 0.5) * 60, vy: 80, t: 0.3, T: 0.3, c: '#67e8f9' });
      }
      else if (F.kind === 'bedflip') {
        if (t > 0.9 && !F.flipped) { F.flipped = 1; v.vy = 1000; v.vx = w.dir * 260; v.flip = 1; v.flipDir = 1; begin(v, 'air'); g.shake = 10; snd('slam'); dust(v.x, 12); }
      } else if (F.kind === 'lasso') {
        if (t > 0.4 && t < 2.2) { var an = (t - 0.4) * 7, rad2 = 52; v.x = w.x + Math.cos(an) * rad2; v.y = 46 + Math.sin(an) * 34; v.vy = 0; v.vx = 0; v.flip = 1; if (v.st !== 'air') begin(v, 'air'); if (Math.random() < 0.3) snd('whoosh'); }
        if (t > 2.2 && !F.hurled) { F.hurled = 1; v.vy = 1100; v.vx = w.dir * 520; snd('whoosh'); }
        if (t > 3.0 && !F.twinkle) { F.twinkle = 1; snd('pick'); }
      } else if (F.kind === 'shrink') {
        v.sc = Math.max(0.22, 1 - Math.min(1, t / 1.2) * 0.78);
        if (t > 1.5 && !F.flicked) { F.flicked = 1; attack(w, 'kick'); }
        if (t > 1.62 && !F.flown) { F.flown = 1; v.vy = 800; v.vx = w.dir * 640; v.flip = 1; begin(v, 'air'); snd('hit'); }
      } else if (F.kind === 'cube') {
        if (t > 1.3) v.hide = 1;
        if (t > 2.0 && !F.kicked) { F.kicked = 1; attack(w, 'kick'); F.cubeVx = w.dir * 420; snd('slam'); }
        if (F.kicked) { F.cubeX = (F.cubeX === undefined ? v.x : F.cubeX) + F.cubeVx * dt; F.cubeVx *= 0.985; F.cubeRot = (F.cubeRot || 0) + F.cubeVx * dt * 0.05; }
      } else if (F.kind === 'cage') {
        if (t > 1.6) { var lift2 = (t - 1.6) * 90; v.y = lift2; v.vy = 0; F.cageY = lift2; }
      } else if (F.kind === 'meltdown') {
        if (t < 2.2 && Math.random() < 0.8) fx.push({ kind: 'fire', x: v.x + (Math.random() - 0.5) * 30, y: Math.random() * 50, vx: (Math.random() - 0.5) * 40, vy: 80 + Math.random() * 80, t: 0.5, T: 0.5 });
        if (t > 1.0) v.soot = 1;
        if (t > 2.3 && !F.fell) { F.fell = 1; begin(v, 'down'); v.vy = 60; v.kx = 0; v.downT = 0; v.ko = true; }
        if (t > 2.3 && Math.random() < 0.15) dust(v.x, 2);
      }
      if (t > 3.3 && w.st !== 'win') begin(w, 'win');
      if (t > 4.6) { v.hp = 0; v.sc = 1; v.hide = 0; v.soot = 0; g.fin = null; roundOver(v === g.c); }
    }
    function drawFinish() {
      var F = g.fin; if (!F || g.mode !== 'finisher') return;
      var v = F.vic, w = F.win, t = g.t, s = g.s;
      if (F.kind === 'spools') F.items.forEach(function (it) { ctx.fillStyle = it.c; ctx.beginPath(); ctx.arc(sx(it.x), sy(it.y), 7 * s, 0, 7); ctx.fill(); ctx.strokeStyle = OUT; ctx.lineWidth = 1.5; ctx.stroke(); ctx.fillStyle = '#e5e7eb'; ctx.beginPath(); ctx.arc(sx(it.x), sy(it.y), 2.6 * s, 0, 7); ctx.fill(); });
      if (F.kind === 'tomb' && !F.shattered) {
        var hh = Math.min(1, t / 1.0) * 100; ctx.fillStyle = 'rgba(34,197,94,.42)'; ctx.fillRect(sx(v.x - 22), sy(hh), 44 * s, hh * s);
        ctx.strokeStyle = 'rgba(187,247,208,.9)'; ctx.lineWidth = 2; ctx.strokeRect(sx(v.x - 22), sy(hh), 44 * s, hh * s);
        if (t > 1.5) { ctx.strokeStyle = '#f0fdf4'; ctx.lineWidth = 1.5; var n = Math.floor((t - 1.5) * 10); for (var i = 0; i < n && i < 9; i++) { var cx2 = v.x - 18 + (i * 37 % 36), cy2 = 10 + (i * 53 % 85); ctx.beginPath(); ctx.moveTo(sx(cx2), sy(cy2)); ctx.lineTo(sx(cx2 + 8), sy(cy2 + 10)); ctx.lineTo(sx(cx2 + 3), sy(cy2 + 18)); ctx.stroke(); } }
      }
      if (F.kind === 'printover') {
        var top = Math.min(100, t / 2.4 * 100), nzX = v.x + Math.sin(t * 9) * 26;
        for (var l = 0; l < top; l += 3) { ctx.fillStyle = FIL[Math.floor(l / 9) % FIL.length]; ctx.globalAlpha = 0.93; ctx.fillRect(sx(v.x - 26), sy(l + 3), 52 * s, 3 * s - 1); } ctx.globalAlpha = 1;
        if (t < 2.6) { ctx.fillStyle = '#9ca3af'; ctx.fillRect(sx(nzX - 10), sy(top + 26), 20 * s, 14 * s); ctx.fillStyle = '#d4a017'; ctx.beginPath(); ctx.moveTo(sx(nzX - 5), sy(top + 12)); ctx.lineTo(sx(nzX + 5), sy(top + 12)); ctx.lineTo(sx(nzX), sy(top + 4)); ctx.fill(); ctx.strokeStyle = '#6b7280'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, sy(top + 34)); ctx.lineTo(g.W, sy(top + 34)); ctx.stroke(); }
      }
      if (F.kind === 'wrap') {
        var nW = Math.min(22, Math.floor(t * 14));
        for (var q = 0; q < nW; q++) { ctx.strokeStyle = FIL[q % FIL.length]; ctx.lineWidth = 2.2 * s; ctx.beginPath(); var yy = 6 + (q * 37 % 80); ctx.moveTo(sx(v.x - 16), sy(yy)); ctx.quadraticCurveTo(sx(v.x), sy(yy + 14), sx(v.x + 16), sy(yy + 4)); ctx.stroke(); }
        if (t < 1.7) { ctx.strokeStyle = w.def.color; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(sx(w.x + w.dir * 20), sy(w.y + 48)); ctx.lineTo(sx(v.x), sy(50)); ctx.stroke(); }
      }
      if (F.kind === 'engrave') {
        var k = Math.min(1, t / 2.2), word = 'LOSER', fs2 = 16 * s;
        ctx.save(); ctx.font = '900 ' + Math.round(fs2) + 'px system-ui, sans-serif'; ctx.textAlign = 'center';
        var full = ctx.measureText(word).width, x0 = sx(v.x) - full / 2;
        ctx.beginPath(); ctx.rect(x0 - 4, sy(30), full * k + 8, 40 * s); ctx.clip();
        ctx.shadowColor = '#22d3ee'; ctx.shadowBlur = 12; ctx.fillStyle = '#a5f3fc'; ctx.fillText(word, sx(v.x), sy(3)); ctx.restore();
        if (t < 2.3) { var lx = x0 + full * k, J = joints(poseOf(w)); ctx.strokeStyle = '#06b6d4'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(sx(w.x + w.dir * (J.aF[2].x + 4)), sy(w.y + J.aF[2].y)); ctx.lineTo(lx, sy(6)); ctx.stroke(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 0.8; ctx.stroke(); }
      }
      if (F.kind === 'bedflip') {   // a giant print bed slides in under him and flips like a pancake turner
        var bx0 = v.x - 40, inX = Math.min(1, t / 0.6), ang3 = t > 0.8 ? -Math.min(1, (t - 0.8) * 5) * 1.1 * w.dir : 0;
        ctx.save(); ctx.translate(sx(v.x - w.dir * 40 + (1 - inX) * -w.dir * 200), sy(0)); ctx.rotate(ang3);
        ctx.fillStyle = '#b45309'; ctx.fillRect(0, -6 * s, w.dir * 80 * s, 6 * s); ctx.fillStyle = '#facc15'; ctx.globalAlpha = 0.6; ctx.fillRect(0, -7 * s, w.dir * 80 * s, 1.5 * s); ctx.globalAlpha = 1; ctx.restore();
      }
      if (F.kind === 'lasso' && t > 0.3 && t < 2.25) { ctx.strokeStyle = w.def.color; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.moveTo(sx(w.x), sy(w.y + 60)); ctx.lineTo(sx(v.x), sy(v.y + 50)); ctx.stroke(); }
      if (F.kind === 'lasso' && t > 3.0 && t < 3.6) { var tw = Math.sin((t - 3) * 20); ctx.fillStyle = '#fff'; ctx.save(); ctx.translate(g.W * 0.75, 18 * s); ctx.rotate(t * 4); ctx.fillRect(-1.5, -8 * Math.abs(tw) - 2, 3, 16 * Math.abs(tw) + 4); ctx.fillRect(-8 * Math.abs(tw) - 2, -1.5, 16 * Math.abs(tw) + 4, 3); ctx.restore(); }
      if (F.kind === 'cube') {   // printed into a 20 mm calibration cube
        var ch = Math.min(1, t / 1.3) * 46, cx3 = F.cubeX === undefined ? v.x : F.cubeX;
        ctx.save(); ctx.translate(sx(cx3), sy(ch / 2)); ctx.rotate(F.cubeRot || 0);
        ctx.fillStyle = '#9ca3af'; ctx.fillRect(-23 * s, -ch / 2 * s, 46 * s, ch * s); ctx.strokeStyle = '#4b5563'; ctx.lineWidth = 2; ctx.strokeRect(-23 * s, -ch / 2 * s, 46 * s, ch * s);
        for (var l3 = 0; l3 < ch; l3 += 3) { ctx.fillStyle = 'rgba(0,0,0,.08)'; ctx.fillRect(-23 * s, (ch / 2 - l3) * s, 46 * s, 1); }
        if (ch >= 46) { ctx.font = '900 ' + Math.round(16 * s) + 'px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#374151'; ctx.fillText('X', -9 * s, 2 * s); ctx.fillText('Y', 9 * s, 2 * s); ctx.font = '900 ' + Math.round(9 * s) + 'px system-ui'; ctx.fillText('Z', 0, -12 * s); }
        ctx.restore();
      }
      if (F.kind === 'cage') {   // support pillars grow round him, a roof prints on, then the whole cage is lifted away
        var bars = Math.min(1, t / 1.2) * 96, cy0 = F.cageY || 0;
        [-24, -14, -4, 6, 16, 26].forEach(function (o3) { for (var l4 = 0; l4 < bars; l4 += 3) { ctx.fillStyle = l4 % 6 ? '#a855f7' : '#c084fc'; ctx.fillRect(sx(v.x + o3) - 1.6 * s, sy(cy0 + l4 + 3), 3.2 * s, 3 * s - 1); } });
        if (t > 1.2) { ctx.fillStyle = '#7e22ce'; ctx.fillRect(sx(v.x - 28), sy(cy0 + 100), 56 * s, 4 * s); }
        if (t > 1.6) { ctx.strokeStyle = '#6b7280'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(sx(v.x), sy(cy0 + 104)); ctx.lineTo(sx(v.x), 0); ctx.stroke(); }
      }
      if (F.kind === 'meltdown' && t < 2.4) { ctx.fillStyle = 'rgba(249,115,22,' + (0.18 * Math.min(1, t * 2)) + ')'; ctx.fillRect(0, 0, g.W, g.H); }
      if (F.kind === 'launch' && t > 0.3 && t < 1.2) { var hp2 = Math.min(1, (t - 0.3) * 6) * 120; for (var l2 = 0; l2 < hp2; l2 += 3) { ctx.fillStyle = l2 % 6 ? '#a855f7' : '#c084fc'; ctx.fillRect(sx(v.x - 12), sy(l2 + 3), 24 * s, 3 * s - 1); } }
    }
    function levels() { return g.endless ? 0 : g.opps.length; }
    function roundOver(pWon) {
      if (pWon) g.pW++; else g.cW++;
      var need = g.endless ? 1 : 2;
      if (g.pW >= need) {
        if (g.endless) { g.streak++; g.carry = g.p.hp; if (g.streak > bestEndless) { bestEndless = g.streak; try { localStorage.setItem('erp_fight_endless', String(bestEndless)); } catch (e) {} } g.level++; intro(true); return; }
        if (g.level > best) { best = g.level; if (opts.bestSet) opts.bestSet(best); }
        if (g.level >= levels()) { g.mode = 'champion'; snd('win'); musicOn(false); stopLoop(); draw(); startConfetti(); return; }
        g.level++; intro(true); return;
      }
      if (g.cW >= need) { g.mode = 'lost'; musicOn(false); stopLoop(); draw(); return; }
      g.round++; intro(false);
    }
    function step(dt) {
      now += dt;
      if (g.freeze > 0) { g.freeze -= dt; return; }   // key presses wait for the freeze to end
      if (g.mode === 'fight' && g.slow < 1 && !(g.p && g.p.atk === 'crusher' && g.p.st === 'atk') && !(g.c && g.c.atk === 'crusher' && g.c.st === 'atk') && now - (g.slowAt || 0) > 0.9) g.slow = 1;
      dt *= g.slow;
      g.t += dt; g.shake = Math.max(0, g.shake - 30 * dt); g.flash = Math.max(0, g.flash - dt); g.zoom = 1 + (g.zoom - 1) * Math.pow(0.02, dt);
      if (g.banner) { g.banner.t -= dt; if (g.banner.t <= 0) g.banner = null; }
      if (!g.banner) g.dim = Math.max(0, g.dim - dt * 3);
      g.cracks.forEach(function (c) { c.t -= dt; }); g.cracks = g.cracks.filter(function (c) { return c.t > 0; });
      if (g.mode === 'intro') { if (g.t > 2.3) { g.mode = 'fight'; g.t = 0; musicOn(true); } }
      if (g.mode === 'finishhim' || g.mode === 'finisher') { stepFighter(g.p, dt); stepFighter(g.c, dt); stepFinish(dt); }
      if (g.mode === 'fight' || g.mode === 'ko') {
        if (g.mode === 'fight') {
          // the build-up of a super stops the other fighter for a moment
          var sup = g.p.st === 'super' && g.p.t < 0.55 ? g.p : g.c.st === 'super' && g.c.t < 0.55 ? g.c : null;
          if (!sup || sup === g.c) player(g.p);
          if (!sup || sup === g.p ? !sup : true) computer(g.c, dt);
          if (g.tut >= 0) g.tutT += dt;
          if (g.tut < 0) { g.timer -= dt; if (g.timer <= 0) { g.timer = 0; var pr = g.p.hp / g.p.max, cr = g.c.hp / g.c.max; g.mode = 'ko'; g.t = 0; g.timeUp = true; var loser = pr >= cr ? g.c : g.p; loser.hp = Math.min(loser.hp, 0.0001); knock(loser, opp(loser), 200, true); snd('ko'); musicOn(false); } }
          if (sup && sup !== g.p) { g.p.vx = 0; }
          stepFighter(g.p, sup && sup !== g.p ? dt * 0.15 : dt); stepFighter(g.c, sup && sup !== g.c ? dt * 0.15 : dt);
        } else { stepFighter(g.p, dt); stepFighter(g.c, dt); }
        stepThings(dt);
        if (g.mode === 'ko' && !g.koChecked && !g.timeUp && g.tut < 0) {
          g.koChecked = 1;
          var vicK = g.c.hp <= 0.001 ? g.c : g.p, winK = opp(vicK), needK = g.endless ? 1 : 2, winsK = (winK === g.p ? g.pW : g.cW) + 1;
          if (winsK >= needK && (!g.endless || Math.random() < 0.5)) { startFinishHim(winK, vicK); return; }
        }
        if (g.mode === 'ko') {
          if (g.t > 0.6) g.slow = 1;
          var w = g.c.hp <= 0.001 ? g.p : g.c;
          if (g.t > 1.3 && w.st !== 'win' && free(w)) { begin(w, 'win'); if (w === g.p) snd('win'); }
          if (g.t > 2.8) { var pWon = g.c.hp <= 0.001; g.perfect = false; g.timeUp = false; roundOver(pWon); return; }
        }
      }
      fx.forEach(function (p) { p.t -= dt; if (p.vx !== undefined) { p.x += p.vx * dt; p.y += p.vy * dt; if (p.kind === 'dot' || p.kind === 'drop' || p.kind === 'conf' || p.kind === 'blood') p.vy -= (p.kind === 'conf' ? 120 : 700) * dt; } }); fx = fx.filter(function (p) { return p.t > 0; });
      pops.forEach(function (p) { p.t -= dt; p.y += 22 * dt; }); pops = pops.filter(function (p) { return p.t > 0; });
      for (var hk in hit) if (now - (hitT[hk] || 0) > 0.15) delete hit[hk];   // the input buffer
    }
    function stepThings(dt) {
      shots = shots.filter(function (s) {
        var o = opp(s.owner);
        s.x += s.vx * dt; s.spin = (s.spin || 0) + dt * 14; s.trail.push({ x: s.x, y: s.y }); if (s.trail.length > 10) s.trail.shift();
        if (s.rain || (s.kind === 'resin' && s.vx === 0)) { s.y += s.vy * dt; if (s.y <= 9) { if (s.kind === 'resin') { burst(s.x, 4, '#22c55e', 0.8, true); return false; } s.y = 9; s.vy = 0; s.vx = (o.x > s.x ? 1 : -1) * 260; s.rain = 0; dust(s.x, 3); } }
        else if (s.kind === 'resin') { s.vy -= 700 * dt; s.y += s.vy * dt; if (s.y <= 0) { puddles.push({ owner: s.owner, x: s.x, w: 70, t: 3.2 }); burst(s.x, 4, '#22c55e', 0.8, true); return false; } }
        if (walls.some(function (w) { return w.owner !== s.owner && w.h > 20 && Math.abs(s.x - w.x) < 10; })) { burst(s.x, s.y, '#eab308', 0.8); return false; }
        if (Math.abs(s.x - o.x) < 16 && s.y > o.y - 10 && s.y < o.y + 80) { if (hurt(s.owner, o, s.dmg, 110, { heavy: 1, at: { x: s.x, y: s.y + 6 } })) return false; }
        return s.x > -20 && s.x < AW() + 20;
      });
      walls.forEach(function (w) {
        w.t -= dt; w.h = Math.min(62, w.h + 200 * dt);
        if (w.crush && w.h >= 62 && w.t < 1) { w.x += w.crush * 120 * dt; }
      }); walls = walls.filter(function (w) { return w.t > 0; });
      puddles.forEach(function (p) { p.t -= dt; }); puddles = puddles.filter(function (p) { return p.t > 0; });
      pend = pend.filter(function (p) {
        p.t -= dt; var o = opp(p.owner);
        if (p.t <= 0 && !p.fired) {
          p.fired = true; g.shake = Math.max(g.shake, p.mega ? 11 : 5); snd('heavy');
          if (Math.abs(o.x - p.x) < 26 * p.w && o.y < (p.mega ? 60 : 30)) hurt(p.owner, o, p.dmg, 20, { lift: p.lift, heavy: 1, knock: 1, at: { x: o.x, y: 20 } });
          if (p.mega) crack(p.x);
        }
        if (p.fired) p.up += dt;
        return p.up < (p.mega ? 0.9 : 0.6);
      });
      beams = beams.filter(function (b) {
        b.t -= dt; var f = b.owner, o = opp(f);
        if (b.kind === 'sweep') {
          var ang = 60 - (1 - b.t / b.T) * 75, front = (o.x - f.x) * f.dir;   // from the sky down to the floor
          var yAt = f.y + 50 + Math.tan(ang * Math.PI / 180) * front;
          if (!b.hit && front > 0 && yAt < o.y + 80 && yAt > o.y - 10) { b.hit = 1; hurt(f, o, b.dmg, 200, { heavy: 1, knock: 1, at: { x: o.x, y: Math.max(10, yAt) } }); }
          if (Math.random() < 0.6) fx.push({ kind: 'dot', x: f.x + f.dir * 200, y: 2, vx: (Math.random() - 0.5) * 100, vy: 120, t: 0.3, T: 0.3, c: '#67e8f9' });
        } else if (!b.hit && (o.x - f.x) * f.dir > 0 && o.y < (b.kind === 'super' ? 75 : 36)) { b.hit = 1; hurt(f, o, b.dmg, b.kind === 'super' ? 240 : 90, { heavy: 1, knock: b.kind === 'super', at: { x: o.x - f.dir * 8, y: o.y + b.y } }); }
        return b.t > 0;
      });
      waves = waves.filter(function (w) {
        w.t += dt; var o = opp(w.owner), r = 26 + w.t * 380;
        if (!w.hit && o.y === 0 && Math.abs(o.x - w.x) < r && Math.abs(o.x - w.x) > r - 60) { w.hit = 1; hurt(w.owner, o, w.dmg || 11, w.soft ? 60 : 140, { knock: !w.soft, heavy: 1, at: { x: o.x, y: 12 } }); }
        return w.t < 0.4;
      });
    }
    function startConfetti() {
      for (var i = 0; i < 120; i++) fx.push({ kind: 'conf', x: Math.random() * AW(), y: 130 + Math.random() * 60, vx: (Math.random() - 0.5) * 60, vy: -40 - Math.random() * 60, t: 3 + Math.random() * 2, T: 5, c: FIL[i % FIL.length] });
      var n = 0, iv = setInterval(function () { if (dead || g.mode !== 'champion' || ++n > 60) { clearInterval(iv); return; } now += 0.08; fx.forEach(function (p) { p.t -= 0.08; p.x += p.vx * 0.08; p.y += p.vy * 0.08; }); fx = fx.filter(function (p) { return p.t > 0; }); draw(); }, 80);
    }

    // ---- loop
    function loopOn() { return g.mode === 'intro' || g.mode === 'fight' || g.mode === 'ko' || g.mode === 'finishhim' || g.mode === 'finisher'; }
    function tick(t) {
      if (dead || g.paused || !loopOn()) return;
      var dt = Math.min(0.05, (t - last) / 1000 || 0); last = t;
      step(dt); draw();
      if (loopOn() && !g.paused) raf = requestAnimationFrame(tick);
    }
    function run() { g.paused = false; last = performance.now(); cancelAnimationFrame(raf); raf = requestAnimationFrame(tick); if (g.mode === 'fight') musicOn(true); }
    function stopLoop() { cancelAnimationFrame(raf); }

    // ---- the body: pose -> joints
    function poseOf(f) {
      var k = f.def.move, b = now * 4;
      switch (f.st) {
        case 'walk': var ph = f.walkPh, sn = Math.sin(ph);
          return { L: 8, hy: 29 + Math.abs(Math.sin(ph)) * 1.5, sF: 36 + sn * 10, eF: 104, sB: 16 - sn * 10, eB: 116, hF: 10 + 28 * sn, kF: -18 - 22 * Math.max(0, -sn), hB: 6 - 28 * sn, kB: -18 - 22 * Math.max(0, sn) };
        case 'block': return P.block;
        case 'air': return P.air;
        case 'hit': return mix(P.hit, I, ease(f.t / 0.32));
        case 'dazed': return over(P.dizzy, { L: -10 + Math.sin(now * 3) * 12, hy: 26 + Math.sin(now * 6) });
        case 'throwing': return f.t < 0.3 ? mix(over(I, { sF: 80, eF: 20, sB: 70, eB: 30, L: 20 }), { L: -14, hy: 30, sF: 170, eF: 10, sB: 165, eB: 10, hF: 22, kF: -18, hB: -20, kB: -10 }, ease(f.t / 0.3)) : f.t < 0.42 ? { L: -14, hy: 30, sF: 170, eF: 10, sB: 165, eB: 10, hF: 22, kF: -18, hB: -20, kB: -10 } : mix({ L: -14, hy: 30, sF: 170, eF: 10, sB: 165, eB: 10, hF: 22, kF: -18, hB: -20, kB: -10 }, over(I, { sF: 120, eF: 10, sB: 110, eB: 10, L: 30 }), ease((f.t - 0.42) / 0.1));
        case 'thrown': return P.hit;
        case 'kneeing': var kn = (f.t * 6.6) % 1 < 0.5; return over(I, kn ? { hF: 100, kF: -150, L: -6, sF: 80, eF: 40, sB: 70, eB: 50 } : { sF: 80, eF: 40, sB: 70, eB: 50, L: 10 });
        case 'dizzy': return over(P.dizzy, { L: -8 + Math.sin(now * 5) * 8 });
        case 'charge': return over(P.charge, { sF: 28 + Math.sin(b * 3) * 4, sB: 30 - Math.sin(b * 3) * 4 });
        case 'win': return over(P.win, { hy: 30 + Math.abs(Math.sin(b)) * 2 });
        case 'dashstep': return over(I, { L: 18 });
        case 'atk':
          var a = ATK[f.atk];
          if (f.atk === 'flurry' || f.atk === 'flurry1000') { var ph2 = Math.floor(f.t * (f.atk === 'flurry1000' ? 40 : 30)) % 2; return over(I, ph2 ? { sF: 90, eF: 0, sB: 20, eB: 120, L: 16 } : { sB: 90, eB: 0, sF: 30, eF: 120, L: 18 }); }
          if (f.atk === 'whipstorm') { var ph3 = (f.t * 6) % 1; return over(I, { sF: -40 + ph3 * 150, eF: 0, L: 10 }); }
          if (f.atk === 'inferno') return keys(Math.min(0.3, f.t), ATK.dash.fr);
          return a.fr ? keys(f.t, a.fr) : I;
        case 'special': return k === 'slam' ? (f.y > 0 ? keys(f.t, SLAM) : LAND) : keys(f.t, CAST);
        case 'super': return k === 'slam' && f.t > 0.55 ? (f.y > 0 ? keys(0, SLAM) : LAND) : keys(Math.min(f.t * 0.6, 0.9), CAST);
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
        return [o, m, e, a1 + a2, a1];
      }
      return { hip: hip, neck: neck, sh: sh, L: p.L,
        aF: limb({ x: sh.x + 2.5, y: sh.y }, p.sF, p.eF, 12, 12), aB: limb({ x: sh.x - 2.5, y: sh.y }, p.sB, p.eB, 12, 12),
        lF: limb({ x: hip.x + 2.5, y: hip.y }, p.hF, p.kF, 15, 15), lB: limb({ x: hip.x - 2.5, y: hip.y }, p.hB, p.kB, 15, 15) };
    }
    function drawFighter(f, ghost) {
      var s = g.s, d = f.def, p = poseOf(f), J = joints(p);
      var rot = 0;
      if (f.st === 'down') rot = -Math.min(1, (f.downT > 0 ? 1 : f.t * 3)) * 82;
      if (f.st === 'thrown') rot = -Math.min(1, f.t / 0.3) * 160;
      if (f.st === 'rise') rot = -82 * (1 - ease(f.t / 0.35));
      var lying = !!rot, piv = 0;
      if (f.y > 0 && f.flip && (f.st === 'air' || f.st === 'atk')) { rot = (f.spin || 0); piv = 30; }
      var cr = Math.cos(rad(rot)), sr = Math.sin(rad(rot));
      var shk = f.flash > 0 ? (Math.random() - 0.5) * 2 : 0;
      var scl = f.sc || 1;
      function X(pt) { var x = (pt.x * cr - (pt.y - piv) * sr) * scl; return sx(f.x + f.dir * x + shk); }
      function Y(pt) { var y = (pt.x * sr + (pt.y - piv) * cr + piv) * scl; return sy(f.y + Math.max(lying ? 3 : -99, y)); }
      function seg(a, b, w, c) { ctx.strokeStyle = c; ctx.lineWidth = w * s; ctx.beginPath(); ctx.moveTo(X(a), Y(a)); ctx.lineTo(X(b), Y(b)); ctx.stroke(); }
      function off(a, k) { return { x: a.x + k, y: a.y + k * 0.4 }; }
      var fl = f.flash > 0, o = d.outfit;
      var sh = fl ? '#ffffff' : d.color, shD = fl ? '#e5e7eb' : shade(d.color, -0.35), shL = fl ? '#fff' : shade(d.color, 0.35);
      var sk = fl ? '#ffffff' : d.skin, skD = fl ? '#e5e7eb' : shade(d.skin.charAt(0) === '#' ? d.skin : '#b07a5a', -0.25);
      if (f.soot) { sh = shD = shL = '#2a2a2a'; sk = skD = '#333'; }
      var pants = f.soot ? '#1f1f1f' : o === 'tracksuit' ? shD : o === 'suit' ? '#1f2433' : o === 'panjabi' ? '#e7e2d6' : PANTS;
      var sleeve = o === 'suit' ? '#1f2433' : o === 'vest' ? shL : sh, sleeveD = o === 'suit' ? '#11141d' : o === 'vest' ? shade(d.color, 0.1) : shD;
      // limbs: outline, colour, a highlight; muscle on the upper arm; real fists and shoes
      function mid(a, b, t) { return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; }
      function bulge(a, b, t, w, c, oc) { var m2 = mid(a, b, t), m3 = mid(a, b, Math.min(1, t + 0.22)); seg(m2, m3, w + 2, oc || OUT); seg(m2, m3, w, c); }
      function arm(l, front) {
        var c1 = sleeve, c2 = front ? sk : skD;
        seg(l[0], l[1], 10.5, OUT); seg(l[1], l[2], 9.5, OUT);
        seg(l[0], l[1], 8.5, front ? c1 : sleeveD); seg(l[1], l[2], 7.4, c2);
        bulge(l[0], l[1], 0.35, 10.5, front ? c1 : sleeveD);                         // biceps
        bulge(l[1], l[2], 0.12, 8.6, c2);                                           // forearm
        ctx.fillStyle = OUT; ctx.beginPath(); ctx.arc(X(l[0]), Y(l[0]), 6.2 * s, 0, 7); ctx.fill();   // deltoid
        ctx.fillStyle = front ? c1 : sleeveD; ctx.beginPath(); ctx.arc(X(l[0]), Y(l[0]), 5.2 * s, 0, 7); ctx.fill();
        seg(off(l[0], 0.8), off(l[1], 0.8), 1.6, 'rgba(255,255,255,.25)');
        if (o === 'tracksuit') seg(off(l[0], -1.6), off(l[1], -1.6), 1.2, '#fff');
        var e = l[2]; ctx.fillStyle = OUT; ctx.beginPath(); ctx.arc(X(e), Y(e), 5.4 * s, 0, 7); ctx.fill();
        ctx.fillStyle = c2; ctx.beginPath(); ctx.arc(X(e), Y(e), 4.3 * s, 0, 7); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 0.8 * s; ctx.beginPath(); ctx.arc(X(e), Y(e), 2.6 * s, -0.5, 1.2); ctx.stroke();
      }
      function leg(l, front) {
        var c = front ? pants : shade(pants.charAt(0) === '#' ? pants : '#2b3044', -0.3);
        seg(l[0], l[1], 11.5, OUT); seg(l[1], l[2], 10, OUT);
        seg(l[0], l[1], 9.6, c); seg(l[1], l[2], 8.1, c);
        bulge(l[0], l[1], 0.25, 12, c);                                             // thigh
        bulge(l[1], l[2], 0.15, 9.6, c);                                            // calf
        if (o === 'tracksuit') seg(off(l[0], 1.6), off(l[2], 1.6), 1.3, '#fff');
        var e = l[2], a = rad(l[3] + 90), t = { x: e.x + Math.sin(a) * 7, y: e.y - Math.cos(a) * 7 };
        seg(e, t, 8, OUT); seg(e, t, 6, BOOT); seg({ x: e.x, y: e.y - 0.5 }, { x: t.x, y: t.y - 0.5 }, 1.4, '#e5e7eb');
      }
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      if (ghost) ctx.globalAlpha = ghost;
      leg(J.lB, false);
      arm(J.aB, false);
      // torso: broad shoulders, narrow waist, shaded side
      var L = rad(J.L), ux = Math.sin(L), uy = Math.cos(L), px = uy, py = -ux;
      var hipC = J.hip, nk = J.neck, low = o === 'panjabi' ? -16 : 0;
      var poly = [
        { x: hipC.x + px * 7.5 + ux * low, y: hipC.y + py * 7.5 + uy * low }, { x: nk.x + px * 13 - ux * 2.5, y: nk.y + py * 13 - uy * 2.5 },
        { x: nk.x - px * 13 - ux * 2.5, y: nk.y - py * 13 - uy * 2.5 }, { x: hipC.x - px * 7.5 + ux * low, y: hipC.y - py * 7.5 + uy * low }];
      function fillPoly(pts, c, w) { ctx.beginPath(); pts.forEach(function (q, i) { if (i) ctx.lineTo(X(q), Y(q)); else ctx.moveTo(X(q), Y(q)); }); ctx.closePath(); if (w) { ctx.lineWidth = w * s; ctx.strokeStyle = OUT; ctx.stroke(); } ctx.fillStyle = c; ctx.fill(); }
      fillPoly(poly, o === 'suit' ? '#1f2433' : sh, 2);
      var half = [poly[0], poly[1], { x: (poly[1].x + poly[2].x) / 2, y: (poly[1].y + poly[2].y) / 2 }, { x: (poly[0].x + poly[3].x) / 2, y: (poly[0].y + poly[3].y) / 2 }];
      fillPoly(half, o === 'suit' ? '#11141d' : shD);
      if (o === 'vest') fillPoly([poly[0], { x: nk.x + px * 8, y: nk.y + py * 8 - 3 }, { x: nk.x - px * 8, y: nk.y - py * 8 - 3 }, poly[3]], shade(d.color, -0.55));
      if (o === 'suit') {   // white shirt, tie in his colour
        fillPoly([{ x: nk.x - ux * 2 + px * 3, y: nk.y - uy * 2 + py * 3 }, { x: nk.x - ux * 2 - px * 3, y: nk.y - uy * 2 - py * 3 }, { x: nk.x - ux * 12, y: nk.y - uy * 12 }], '#f8fafc');
        seg({ x: nk.x - ux * 3, y: nk.y - uy * 3 }, { x: nk.x - ux * 13, y: nk.y - uy * 13 }, 2.4, d.color);
      }
      if (o === 'panjabi') { seg({ x: nk.x - ux * 2, y: nk.y - uy * 2 }, { x: nk.x - ux * 11, y: nk.y - uy * 11 }, 1.2, shL); [3, 6, 9].forEach(function (q) { var bt = { x: nk.x - ux * q, y: nk.y - uy * q }; ctx.fillStyle = '#fde68a'; ctx.beginPath(); ctx.arc(X(bt), Y(bt), 0.9 * s, 0, 7); ctx.fill(); }); }
      if (o === 'tshirt' || o === 'tracksuit' || o === 'vest') {   // the chest and the abs under the cloth
        var pc = 'rgba(0,0,0,.28)';
        seg({ x: nk.x - ux * 7 + px * 1, y: nk.y - uy * 7 + py * 1 }, { x: nk.x - ux * 6 + px * 8, y: nk.y - uy * 6 + py * 8 }, 1.2, pc);
        seg({ x: nk.x - ux * 7 - px * 1, y: nk.y - uy * 7 - py * 1 }, { x: nk.x - ux * 6 - px * 8, y: nk.y - uy * 6 - py * 8 }, 1.2, pc);
        seg({ x: nk.x - ux * 9, y: nk.y - uy * 9 }, { x: hipC.x + ux * 4, y: hipC.y + uy * 4 }, 0.9, pc);
        [12, 15, 18].forEach(function (q) { seg({ x: nk.x - ux * q - px * 3, y: nk.y - uy * q - py * 3 }, { x: nk.x - ux * q + px * 3, y: nk.y - uy * q + py * 3 }, 0.8, pc); });
      }
      if (o === 'tshirt' || o === 'tracksuit') seg({ x: nk.x - px * 4 - ux * 1.5, y: nk.y - py * 4 - uy * 1.5 }, { x: nk.x + px * 4 - ux * 1.5, y: nk.y + py * 4 - uy * 1.5 }, 2, shD);   // the collar
      if (o !== 'panjabi') { ctx.lineCap = 'butt'; seg({ x: hipC.x + ux * 0.5, y: hipC.y + uy * 0.5 }, { x: hipC.x + ux * 3, y: hipC.y + uy * 3 }, 14, '#3b2a20'); ctx.lineCap = 'round'; var bk = { x: hipC.x + ux * 1.7 + px * 3, y: hipC.y + uy * 1.7 + py * 3 }; ctx.fillStyle = '#d4a017'; ctx.fillRect(X(bk) - 1.2 * s, Y(bk) - 1.2 * s, 2.4 * s, 2.4 * s); }
      leg(J.lF, true);
      // head
      ctx.save();
      ctx.translate(X({ x: J.neck.x, y: J.neck.y + 14 }), Y({ x: J.neck.x, y: J.neck.y + 14 }));
      ctx.rotate(rad(-(rot + J.L * 0.4) * f.dir) + (f.st === 'dizzy' ? Math.sin(now * 5) * 0.15 : 0));
      ctx.scale(f.dir, 1);
      if (f.soot) ctx.filter = 'brightness(0.25)';
      ctx.drawImage(d.img, -13 * s * scl, -17.5 * s * scl, 26 * s * scl, 32 * s * scl);
      ctx.filter = 'none';
      if (fl) { ctx.globalAlpha = 0.6 * (ghost || 1); ctx.drawImage(d.white, -13 * s, -17.5 * s, 26 * s, 32 * s); }
      ctx.restore();
      if (ghost) ctx.globalAlpha = ghost;
      arm(J.aF, true);
      ctx.globalAlpha = 1;
      if (f.st === 'dizzy' || f.st === 'dazed') for (var q = 0; q < 3; q++) { var an = now * 6 + q * 2.1, hx = f.x + Math.cos(an) * 12, hy = f.y + 92 + Math.sin(an) * 3; text('★', sx(hx), sy(hy), 7 * s, '#facc15', 'center', true, true); }
    }
    function drawBoss(f) {
      var s = g.s, t = now * 3, attack = f.st === 'atk' || f.st === 'special' || f.st === 'super';
      var rot = f.st === 'down' ? -Math.min(1, f.t * 3) * 1.3 * f.dir : 0;
      ctx.save(); ctx.translate(sx(f.x), sy(f.y)); ctx.rotate(rot); ctx.scale(f.dir * s * 1.15, s * 1.15);
      ctx.lineCap = 'round';
      for (var i = 0; i < 13; i++) {
        ctx.strokeStyle = f.flash ? '#fff' : FIL[i % FIL.length]; ctx.lineWidth = 3.4;
        var a = i * 0.7 + t * (i % 2 ? 1 : -1);
        ctx.beginPath(); ctx.ellipse(Math.sin(a) * 6, -40 + Math.cos(a * 1.3) * 6, 19 + (i % 3) * 4, 30 + (i % 4) * 3, a * 0.3, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.strokeStyle = FIL[0]; ctx.lineWidth = 4.5;
      var reachX = attack ? (f.atk === 'whip' || f.st === 'special' ? 104 : f.atk === 'kick' || f.atk === 'sweep' ? 48 : 36) : 18 + Math.sin(t) * 3;
      ctx.beginPath(); ctx.moveTo(10, -44); ctx.quadraticCurveTo(reachX * 0.6, -64 + Math.sin(t * 3) * 6, reachX, -46); ctx.stroke();
      ctx.strokeStyle = FIL[3]; ctx.beginPath(); ctx.moveTo(10, -30); ctx.quadraticCurveTo(reachX * 0.5, -10, reachX * 0.8, -26); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(-4, -56, 6, 0, Math.PI * 2); ctx.arc(9, -56, 6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#b91c1c'; ctx.beginPath(); ctx.arc(-2, -55, 2.8, 0, Math.PI * 2); ctx.arc(11, -55, 2.8, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#111'; ctx.lineWidth = 2.4; ctx.beginPath(); ctx.moveTo(-12, -66); ctx.lineTo(0, -61); ctx.moveTo(17, -66); ctx.lineTo(5, -61); ctx.stroke();
      ctx.fillStyle = '#111'; ctx.beginPath(); ctx.moveTo(-6, -45); ctx.lineTo(12, -45); ctx.lineTo(3, -38 - (attack ? 4 : 0)); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#fff'; [-3, 1, 5, 9].forEach(function (x) { ctx.fillRect(x, -45, 1.6, 2.4); });
      ctx.restore();
    }

    // ---- the workshop behind the fight (drawn once per size)
    function background() {
      var c = document.createElement('canvas'); c.width = Math.max(1, Math.round(g.W)); c.height = Math.max(1, Math.round(g.H));
      var x = c.getContext('2d'), s = g.s, lt = light(), W = g.W, H = g.H;
      var top = lt ? '#e9eef5' : '#1d2230', bot = lt ? '#d5dde8' : '#141822';
      var gr = x.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, top); gr.addColorStop(1, bot); x.fillStyle = gr; x.fillRect(0, 0, W, H);
      // windows with a little evening light
      for (var wv = 0; wv < Math.ceil(W / (180 * s)); wv++) { var wx = wv * 180 * s + 90 * s; var wg = x.createLinearGradient(0, 6 * s, 0, 40 * s); wg.addColorStop(0, lt ? '#bfdbfe' : '#312e81'); wg.addColorStop(1, lt ? '#fde68a' : '#7c2d12'); x.fillStyle = wg; x.globalAlpha = 0.35; x.fillRect(wx, 8 * s, 40 * s, 30 * s); x.globalAlpha = 1; x.strokeStyle = lt ? '#94a3b8' : '#2a3142'; x.lineWidth = 2; x.strokeRect(wx, 8 * s, 40 * s, 30 * s); x.beginPath(); x.moveTo(wx + 20 * s, 8 * s); x.lineTo(wx + 20 * s, 38 * s); x.stroke(); }
      // night: a dark red sky, a red moon
      var sky = x.createLinearGradient(0, 0, 0, H * 0.6); sky.addColorStop(0, lt ? 'rgba(60,10,20,.25)' : 'rgba(40,0,10,.55)'); sky.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = sky; x.fillRect(0, 0, W, H);
      x.fillStyle = 'rgba(220,60,50,.55)'; x.beginPath(); x.arc(W * 0.82, 20 * s, 11 * s, 0, 7); x.fill();
      x.fillStyle = 'rgba(255,120,100,.25)'; x.beginPath(); x.arc(W * 0.82, 20 * s, 16 * s, 0, 7); x.fill();
      var shelfY = (120 - 66) * s;
      x.fillStyle = lt ? '#c7cfdb' : '#2a3142'; x.fillRect(0, shelfY, W, 3 * s);
      for (var i = 0; i < Math.ceil(W / (60 * s)); i++) {
        var px = i * 60 * s + 10 * s;
        if (i % 3 === 1) {
          [0, 1, 2].forEach(function (j) { x.fillStyle = FIL[(i + j) % FIL.length]; x.globalAlpha = 0.6; x.beginPath(); x.arc(px + j * 13 * s + 6 * s, shelfY - 7 * s, 6 * s, 0, Math.PI * 2); x.fill(); x.globalAlpha = 1; x.fillStyle = bot; x.beginPath(); x.arc(px + j * 13 * s + 6 * s, shelfY - 7 * s, 2 * s, 0, Math.PI * 2); x.fill(); });
        } else {
          x.strokeStyle = lt ? '#9aa6b8' : '#3b4458'; x.lineWidth = Math.max(1, s);
          x.strokeRect(px, shelfY - 30 * s, 30 * s, 30 * s); x.fillStyle = lt ? '#b8c2d1' : '#323a4c'; x.fillRect(px + 3 * s, shelfY - 5 * s, 24 * s, 3 * s);
          x.fillStyle = FIL[i % FIL.length]; x.globalAlpha = 0.7; x.fillRect(px + 12 * s, shelfY - 9 * s, 6 * s, 4 * s); x.globalAlpha = 1;
        }
      }
      var fy = sy(0);
      x.fillStyle = lt ? '#cfb48a' : '#3a2f25'; x.fillRect(0, fy, W, H - fy);
      x.strokeStyle = lt ? 'rgba(0,0,0,.12)' : 'rgba(255,255,255,.06)'; x.lineWidth = 1;
      for (var k = -20; k < 30; k++) { var bx = W / 2 + k * 40 * s; x.beginPath(); x.moveTo(bx, fy); x.lineTo(W / 2 + k * 60 * s, H); x.stroke(); }
      x.strokeStyle = lt ? '#a07a3d' : '#c9973f'; x.beginPath(); x.moveTo(0, fy + 0.5); x.lineTo(W, fy + 0.5); x.stroke();
      var fog = x.createLinearGradient(0, fy - 18 * s, 0, fy + 4 * s); fog.addColorStop(0, 'rgba(180,170,190,0)'); fog.addColorStop(1, 'rgba(180,170,190,.16)'); x.fillStyle = fog; x.fillRect(0, fy - 18 * s, W, 22 * s);
      return c;
    }
    function bar(x, y, w, h, v, ghost, c, back, rightToLeft) {
      ctx.fillStyle = back; ctx.fillRect(x, y, w, h);
      var gw2 = (w - 2) * ghost, vw = (w - 2) * v;
      ctx.fillStyle = '#fde68a'; ctx.fillRect(rightToLeft ? x + 1 + (w - 2 - gw2) : x + 1, y + 1, gw2, h - 2);
      var gr = ctx.createLinearGradient(0, y, 0, y + h); gr.addColorStop(0, shade(c, 0.3)); gr.addColorStop(1, shade(c, -0.2));
      ctx.fillStyle = gr; ctx.fillRect(rightToLeft ? x + 1 + (w - 2 - vw) : x + 1, y + 1, vw, h - 2);
      ctx.strokeStyle = OUT; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    }
    function metal(t, x, y, size, tint) {   // big carved-metal letters
      ctx.save(); ctx.font = '900 ' + Math.round(size) + 'px Impact, "Arial Black", system-ui, sans-serif'; ctx.textAlign = 'center';
      var gr = ctx.createLinearGradient(0, y - size, 0, y + size * 0.15);
      if (tint === 'red') { gr.addColorStop(0, '#fecaca'); gr.addColorStop(0.45, '#ef4444'); gr.addColorStop(0.55, '#991b1b'); gr.addColorStop(1, '#ef4444'); }
      else { gr.addColorStop(0, '#fefce8'); gr.addColorStop(0.45, '#facc15'); gr.addColorStop(0.55, '#a16207'); gr.addColorStop(1, '#fde047'); }
      ctx.lineWidth = Math.max(3, size / 7); ctx.strokeStyle = '#0b0b0f'; ctx.lineJoin = 'round'; ctx.strokeText(t, x, y);
      ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowOffsetY = 3; ctx.fillStyle = gr; ctx.fillText(t, x, y); ctx.restore();
    }
    function text(t, x, y, size, color, align, bold, stroke) {
      ctx.font = (bold ? '800 ' : '600 ') + Math.round(size) + 'px system-ui, sans-serif'; ctx.textAlign = align || 'left';
      if (stroke) { ctx.lineWidth = Math.max(2, size / 6); ctx.strokeStyle = OUT; ctx.strokeText(t, x, y); }
      ctx.fillStyle = color; ctx.fillText(t, x, y);
    }
    var soundBtn = null;
    function draw() {
      var W = g.W, H = g.H, s = g.s; if (!W || !H) return;
      var ink = css('--ink', '#ddd'), mute = css('--muted', '#888'), ring = css('--ring', '#333');
      var dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      if (!bg) bg = background();
      var shx = g.shake ? (Math.random() - 0.5) * g.shake * 2 : 0, shy = g.shake ? (Math.random() - 0.5) * g.shake * 2 : 0;
      ctx.save(); ctx.translate(shx, shy);
      if (g.p && g.c && g.mode !== 'select') {
        var dist = Math.abs(g.p.x - g.c.x), cz = Math.max(1, Math.min(1.14, 1 + (1 - dist / Math.max(200, AW() * 0.75)) * 0.16)), cxw = (g.p.x + g.c.x) / 2;
        g.camZ = (g.camZ || 1) + (cz - (g.camZ || 1)) * 0.08; g.camX = (g.camX === undefined ? cxw : g.camX + (cxw - g.camX) * 0.1);
        var z0 = g.camZ, px0 = Math.max(W / (2 * z0), Math.min(W - W / (2 * z0), sx(g.camX))), py0 = sy(42);
        ctx.translate(W / 2, py0); ctx.scale(z0, z0); ctx.translate(-px0, -py0);
      }
      if (g.zoom > 1.005 && g.p) { var zx = sx(g.zx), zy = sy(g.zy); ctx.translate(zx, zy); ctx.scale(g.zoom, g.zoom); ctx.translate(-zx, -zy); }
      ctx.drawImage(bg, 0, 0, W, H);
      for (var i = 0; i < Math.ceil(W / (60 * s)); i++) if (i % 3 !== 1) { ctx.fillStyle = Math.floor(now * 2 + i) % 2 ? '#22c55e' : '#16a34a'; ctx.fillRect(i * 60 * s + 34 * s, (120 - 66) * s - 27 * s, 2 * s, 2 * s); var nz = i * 60 * s + 10 * s + (15 + Math.sin(now * 2 + i) * 11) * s; ctx.fillStyle = '#d4a017'; ctx.fillRect(nz - 2 * s, (120 - 66) * s - 20 * s, 4 * s, 4 * s); }
      if (g.mode === 'select') { ctx.restore(); return drawSelect(); }
      if (!g.p) { ctx.restore(); return; }
      // cracks in the floor
      g.cracks.forEach(function (c) { ctx.strokeStyle = 'rgba(0,0,0,' + Math.min(0.6, c.t / 2) + ')'; ctx.lineWidth = 1.5; for (var q = 0; q < 5; q++) { var a = -Math.PI + q * Math.PI / 4 + c.seed; ctx.beginPath(); ctx.moveTo(sx(c.x), sy(0) + 2); ctx.lineTo(sx(c.x + Math.cos(a) * 14), sy(0) + 2 + Math.abs(Math.sin(a)) * 6 * s); ctx.lineTo(sx(c.x + Math.cos(a) * 26), sy(0) + 2 + Math.abs(Math.sin(a + 0.4)) * 9 * s); ctx.stroke(); } });
      puddles.forEach(function (p) { ctx.fillStyle = '#22c55e'; ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.ellipse(sx(p.x), sy(0) + 2 * s, p.w / 2 * s, 3.5 * s, 0, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 0.8; ctx.strokeStyle = '#86efac'; for (var b = 0; b < 3; b++) { ctx.beginPath(); ctx.arc(sx(p.x + Math.sin(now * 3 + b * 2) * p.w * 0.35), sy(0) + 1 * s, (1 + (now * 2 + b) % 1.5) * s, 0, Math.PI * 2); ctx.stroke(); } ctx.globalAlpha = 1; });
      [g.c, g.p].forEach(function (f) { ctx.fillStyle = 'rgba(0,0,0,.3)'; var w = Math.max(6, 17 - f.y * 0.08); ctx.beginPath(); ctx.ellipse(sx(f.x), sy(0) + 2 * s, w * s, 2.8 * s, 0, 0, Math.PI * 2); ctx.fill(); });
      walls.forEach(function (w) {
        for (var l = 0; l < w.h; l += 3) { ctx.fillStyle = FIL[Math.floor(l / 9) % 5]; ctx.fillRect(sx(w.x) - 6 * s, sy(l + 3), 12 * s, 3 * s - 1); }
        if (w.h < 62) { ctx.fillStyle = '#d4a017'; ctx.fillRect(sx(w.x + Math.sin(now * 30) * 6) - 2 * s, sy(w.h + 7), 4 * s, 4 * s); }
      });
      pend.forEach(function (p) {
        var pw = 22 * p.w;
        if (!p.fired) { ctx.strokeStyle = p.tendril ? '#f59e0b' : '#a855f7'; ctx.lineWidth = 2; ctx.globalAlpha = 0.5 + 0.5 * Math.sin(now * 30); ctx.beginPath(); ctx.ellipse(sx(p.x), sy(0) + s, pw * s, 4 * s, 0, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1; }
        else {
          var hh = Math.min(1, p.up * 5) * (p.mega ? 110 : 50), fade = p.up > (p.mega ? 0.7 : 0.4) ? 1 - (p.up - (p.mega ? 0.7 : 0.4)) / 0.2 : 1; ctx.globalAlpha = Math.max(0, fade);
          if (p.tendril) { ctx.strokeStyle = FIL[Math.floor(p.x) % FIL.length]; ctx.lineWidth = 4 * s; ctx.beginPath(); ctx.moveTo(sx(p.x), sy(0)); ctx.quadraticCurveTo(sx(p.x + 10), sy(hh * 0.5), sx(p.x - 4), sy(hh)); ctx.stroke(); }
          else (p.mega ? [-30, -18, -6, 6, 18, 30] : [-16, -5, 6, 16]).forEach(function (o, j) { for (var l = 0; l < hh - (j % 3) * 6; l += 3) { ctx.fillStyle = l % 6 ? '#a855f7' : '#c084fc'; ctx.fillRect(sx(p.x + o) - (p.mega ? 5 : 2.5) * s, sy(l + 3), (p.mega ? 10 : 5) * s, 3 * s - 1); } });
          ctx.globalAlpha = 1;
        }
      });
      // draw the fighters into a small canvas, then blow it up without smoothing: chunky pixels like the faces
      var PX = Math.max(2, Math.round(g.s * 1.25)), mainCtx = ctx;
      if (!pcv) { pcv = document.createElement('canvas'); pctx = pcv.getContext('2d'); }
      var pw = Math.ceil(W / PX), ph = Math.ceil(H / PX); if (pcv.width !== pw || pcv.height !== ph) { pcv.width = pw; pcv.height = ph; }
      var m0 = ctx.getTransform(), dv = (window.devicePixelRatio || 1) * PX;
      pctx.setTransform(1, 0, 0, 1, 0, 0); pctx.clearRect(0, 0, pw, ph); pctx.imageSmoothingEnabled = false;
      pctx.setTransform(m0.a / dv, m0.b / dv, m0.c / dv, m0.d / dv, m0.e / dv, m0.f / dv);
      ctx = pctx;
      [g.c, g.p].forEach(function (f) {
        if (f.hide) return;
        if (f.def.boss) { drawBoss(f); return; }
        if (f.rag && f.st === 'down') { drawRag(f); return; }
        // a smear of the body on the active frames of heavy moves
        if (f.st === 'atk' && ATK[f.atk] && ATK[f.atk].heavy && f.t > ATK[f.atk].start - 0.03 && f.t < ATK[f.atk].start + ATK[f.atk].act) { var sx0 = f.x; f.x = sx0 - f.dir * 9; drawFighter(f, 0.22); f.x = sx0 - f.dir * 4; drawFighter(f, 0.35); f.x = sx0; }
        if ((f.st === 'atk' && (f.atk === 'dash' || f.atk === 'flurry' || f.atk === 'inferno' || f.atk === 'flurry1000')) || f.st === 'dashstep') {
          var ox = f.x; [3, 2, 1].forEach(function (n) { f.x = ox - f.dir * n * 9; drawFighter(f, 0.12 * (4 - n)); }); f.x = ox;
        }
        if (f.st === 'charge' || (f.st === 'super' && f.t < 0.7) || f.pw >= 100) {
          var fl = f.st === 'charge' || f.st === 'super' ? 0.32 + 0.14 * Math.sin(now * 25) : 0.1 + 0.05 * Math.sin(now * 6);
          ctx.globalAlpha = fl; ctx.fillStyle = f.def.color;
          ctx.beginPath(); ctx.ellipse(sx(f.x), sy(f.y + 42), 30 * s, 56 * s, 0, 0, Math.PI * 2); ctx.fill();
          ctx.globalAlpha = fl * 0.6; ctx.beginPath(); ctx.ellipse(sx(f.x), sy(f.y + 44), 38 * s, 66 * s, 0, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
          if (f.st === 'charge' || f.st === 'super') for (var q = 0; q < 3; q++) { ctx.strokeStyle = '#fff'; ctx.globalAlpha = 0.5; ctx.lineWidth = 1.5; var lx = sx(f.x + (Math.random() - 0.5) * 50); ctx.beginPath(); ctx.moveTo(lx, sy(f.y)); ctx.lineTo(lx + (Math.random() - 0.5) * 8, sy(f.y + 40 + Math.random() * 50)); ctx.stroke(); ctx.globalAlpha = 1; }
        }
        drawFighter(f);
        if (f.trail.length > 1) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 3 * s; ctx.globalAlpha = 0.45; ctx.beginPath(); f.trail.forEach(function (t2, j) { if (j) ctx.lineTo(sx(t2.x), sy(t2.y)); else ctx.moveTo(sx(t2.x), sy(t2.y)); }); ctx.stroke(); ctx.globalAlpha = 1; }
        if (f.st === 'atk' && (f.atk === 'whip' || f.atk === 'whipstorm') && f.t > 0.1) {
          var J = joints(poseOf(f)), hx = f.x + f.dir * J.aF[2].x, hy = f.y + J.aF[2].y, ln = f.atk === 'whipstorm' ? 130 * (0.6 + 0.4 * Math.sin(now * 30)) : Math.min(1, (f.t - 0.12) / 0.08) * 92;
          if (f.atk === 'whip' && f.t > 0.36) ln = 0;
          if (ln) { ctx.strokeStyle = f.def.color; ctx.lineWidth = 3.4 * s; ctx.beginPath(); ctx.moveTo(sx(hx), sy(hy));
            ctx.quadraticCurveTo(sx(hx + f.dir * ln * 0.5), sy(hy + 14 + Math.sin(now * 40) * 8), sx(hx + f.dir * ln), sy(hy - 2)); ctx.stroke();
            ctx.strokeStyle = '#fff'; ctx.lineWidth = 1 * s; ctx.stroke(); }
        }
        if ((f.st === 'super' && f.t < 0.62) || (f.st === 'special' && f.def.move === 'laser' && f.t < 0.34)) {
          var J2 = joints(poseOf(f)), bx = sx(f.x + f.dir * (J2.aF[2].x + 6)), by = sy(f.y + J2.aF[2].y), rr = (f.st === 'super' ? 4 + f.t * 18 : 3 + f.t * 10) * s;
          for (var q2 = 0; q2 < 4; q2++) { ctx.strokeStyle = q2 % 2 ? f.def.color : '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(bx, by, rr, rr * 0.5, now * 8 + q2, 0, Math.PI * 2); ctx.stroke(); }
        }
      });
      ctx = mainCtx;
      ctx.save(); ctx.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0); ctx.imageSmoothingEnabled = false; ctx.drawImage(pcv, 0, 0, pw * PX, ph * PX); ctx.restore();
      drawFinish();
      shots.forEach(function (sh) {
        sh.trail.forEach(function (t2, j) { ctx.globalAlpha = j / sh.trail.length * 0.5; ctx.fillStyle = sh.kind === 'spool' ? sh.owner.def.color : '#22c55e'; ctx.fillRect(sx(t2.x) - 1.5 * s, sy(t2.y) - 1.5 * s, 3 * s, 3 * s); }); ctx.globalAlpha = 1;
        if (sh.kind === 'spool') {
          ctx.save(); ctx.translate(sx(sh.x), sy(sh.y)); ctx.rotate(sh.spin * sh.owner.dir);
          ctx.fillStyle = sh.owner.def.color; ctx.beginPath(); ctx.arc(0, 0, 9 * s, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = OUT; ctx.lineWidth = 1.5; ctx.stroke();
          ctx.fillStyle = '#e5e7eb'; ctx.beginPath(); ctx.arc(0, 0, 3.4 * s, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = '#e5e7eb'; ctx.lineWidth = s; ctx.beginPath(); ctx.moveTo(-8 * s, 0); ctx.lineTo(8 * s, 0); ctx.moveTo(0, -8 * s); ctx.lineTo(0, 8 * s); ctx.stroke();
          ctx.restore();
        } else { ctx.fillStyle = '#22c55e'; ctx.beginPath(); ctx.arc(sx(sh.x), sy(sh.y), 5.5 * s, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#86efac'; ctx.beginPath(); ctx.arc(sx(sh.x) - s, sy(sh.y) - s, 2 * s, 0, Math.PI * 2); ctx.fill(); }
      });
      waves.forEach(function (w) {
        var r = 26 + w.t * 380, a = 1 - w.t / 0.4;
        [-1, 1].forEach(function (side) { ctx.globalAlpha = a; ctx.fillStyle = '#ec4899'; for (var j = 0; j < 4; j++) { var hx2 = w.x + side * (r - j * 10); ctx.fillRect(sx(hx2) - 2 * s, sy(16 - j * 3), 4 * s, (16 - j * 3) * s); } });
        ctx.globalAlpha = 1;
      });
      beams.forEach(function (b) {
        var f = b.owner, J = joints(poseOf(f)), x0 = sx(f.x + f.dir * (J.aF[2].x + 4)), x1 = f.dir > 0 ? W + 20 : -20, y = sy(f.y + b.y), life = b.t / b.T;
        if (b.kind === 'laser' || b.kind === 'sweep') {
          var y1 = y;
          if (b.kind === 'sweep') y1 = sy(f.y + b.y + Math.tan(rad(60 - (1 - life) * 75)) * Math.abs(x1 - x0) / g.s);
          ctx.globalAlpha = 0.35; ctx.strokeStyle = '#06b6d4'; ctx.lineWidth = (b.kind === 'sweep' ? 10 : 7) * s; ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y1); ctx.stroke();
          ctx.globalAlpha = 1; ctx.lineWidth = 2.6 * s; ctx.stroke(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1 * s; ctx.stroke();
        } else {
          var hh = 12 * s * (0.6 + 0.4 * Math.min(1, (b.T - b.t) * 8)) * (life < 0.25 ? life * 4 : 1);
          ctx.globalAlpha = 0.3; ctx.fillStyle = f.def.color; ctx.fillRect(Math.min(x0, x1), y - hh * 1.8, Math.abs(x1 - x0), hh * 3.6);
          for (var l = -5; l <= 5; l++) { ctx.globalAlpha = 0.95 - Math.abs(l) * 0.08; ctx.fillStyle = (l + Math.floor(now * 20)) % 2 ? f.def.color : '#ffffff'; ctx.fillRect(Math.min(x0, x1), y + l * hh / 5.5 - hh / 11, Math.abs(x1 - x0), hh / 5.5); }
          ctx.globalAlpha = 1;
        }
      });
      fx.forEach(function (p) {
        var a = p.t / p.T; ctx.globalAlpha = Math.max(0, Math.min(1, a));
        if (p.kind === 'ring') { ctx.strokeStyle = p.c; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(sx(p.x), sy(p.y), (p.r + (1 - a) * 18) * s, 0, Math.PI * 2); ctx.stroke(); }
        else if (p.kind === 'star') { ctx.strokeStyle = p.c; ctx.lineWidth = 3; for (var k2 = 0; k2 < 8; k2++) { var an = k2 * Math.PI / 4 + 0.3; ctx.beginPath(); ctx.moveTo(sx(p.x + Math.cos(an) * 4), sy(p.y + Math.sin(an) * 4)); ctx.lineTo(sx(p.x + Math.cos(an) * p.r * (k2 % 2 ? 0.6 : 1)), sy(p.y + Math.sin(an) * p.r * (k2 % 2 ? 0.6 : 1))); ctx.stroke(); } }
        else if (p.kind === 'flashball') { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(sx(p.x), sy(p.y), p.r * s, 0, Math.PI * 2); ctx.fill(); }
        else if (p.kind === 'dust') { ctx.fillStyle = 'rgba(180,170,150,.7)'; ctx.beginPath(); ctx.arc(sx(p.x), sy(p.y), p.r * (1.6 - a) * s, 0, Math.PI * 2); ctx.fill(); }
        else if (p.kind === 'drop') { ctx.fillStyle = '#bae6fd'; ctx.beginPath(); ctx.ellipse(sx(p.x), sy(p.y), 1.2 * s, 2 * s, 0, 0, Math.PI * 2); ctx.fill(); }
        else if (p.kind === 'fire') { ctx.fillStyle = a > 0.6 ? '#fde047' : a > 0.3 ? '#f97316' : '#ef4444'; ctx.fillRect(sx(p.x) - 2 * s, sy(p.y) - 2 * s, 5 * s * a + 1, 5 * s * a + 1); }
        else if (p.kind === 'blood') { ctx.fillStyle = '#b91c1c'; ctx.fillRect(sx(p.x) - 1.4 * s, sy(p.y) - 1.4 * s, 2.8 * s, 2.8 * s); }
        else if (p.kind === 'conf') { ctx.fillStyle = p.c; ctx.fillRect(sx(p.x), sy(p.y), 3 * s, 1.6 * s); }
        else { ctx.fillStyle = p.c; ctx.fillRect(sx(p.x) - 1.3 * s, sy(p.y) - 1.3 * s, 2.6 * s, 2.6 * s); }
      });
      ctx.globalAlpha = 1;
      pops.forEach(function (p) { var a = Math.min(1, p.t * 3); ctx.globalAlpha = a; var sc = p.word ? 1 + Math.max(0, p.t - 0.5) * 0.8 : 1; text(p.s, sx(p.x), sy(p.y), p.size * s * 0.7 * sc, p.c, 'center', true, true); });
      ctx.globalAlpha = 1;
      ctx.restore();
      if (g.dim > 0) { ctx.globalAlpha = g.dim * 0.6; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; if (g.banner) { var bf = g.banner.f; drawFighter(bf); } }
      if (g.flash > 0) { ctx.globalAlpha = Math.min(0.6, g.flash * 3); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
      if (g.p && g.mode === 'fight' && g.p.hp < g.p.max * 0.3) {   // low health: the screen edges glow red
        var vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.65), pa = 0.22 + 0.12 * Math.sin(now * 6);
        vg.addColorStop(0, 'rgba(160,0,0,0)'); vg.addColorStop(1, 'rgba(160,0,0,' + pa + ')'); ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
      }
      if (g.banner) {
        var bk = Math.min(1, (1.1 - g.banner.t) * 6), by = H * 0.42;
        ctx.fillStyle = g.banner.f.def.color; ctx.globalAlpha = 0.85; ctx.fillRect(0, by - 13 * s, W * bk, 20 * s); ctx.globalAlpha = 1;
        text(g.banner.f.def.name + ' — ' + g.banner.name + '!', W / 2, by + 2 * s, Math.max(16, 11 * s), '#fff', 'center', true, true);
      }
      hud();
    }
    function hud() {
      var W = g.W, H = g.H, s = g.s, bw = Math.min(300, W * 0.32), fs = Math.max(11, 6.5 * s), ph = Math.max(22, 13 * s), pw2 = ph * 28 / 34;
      [[g.p, 10, 1], [g.c, W - 10 - pw2, -1]].forEach(function (o) {
        var f = o[0], x = o[1];
        ctx.fillStyle = OUT; ctx.fillRect(x - 1, 7, pw2 + 2, ph + 2);
        ctx.fillStyle = f.def.color; ctx.fillRect(x, 8, pw2, ph);
        if (f.def.boss) { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x + pw2 * 0.35, 8 + ph * 0.45, pw2 * 0.12, 0, 7); ctx.arc(x + pw2 * 0.65, 8 + ph * 0.45, pw2 * 0.12, 0, 7); ctx.fill(); }
        else { ctx.save(); ctx.translate(x + pw2 / 2, 8); ctx.scale(o[2], 1); ctx.drawImage(f.def.img, -pw2 / 2, 0, pw2, ph); ctx.restore(); }
      });
      var lx = 14 + pw2, rx = W - 14 - pw2 - bw, bh = Math.max(9, 4.8 * s);
      text(g.p.def.name, lx, 7 + fs, fs, '#fff', 'left', true, true);
      bar(lx, 10 + fs, bw, bh, g.p.hp / g.p.max, g.p.ghost / g.p.max, g.p.hp < 30 ? '#ef4444' : '#22c55e', 'rgba(0,0,0,.45)', false);
      text(g.c.def.name, W - 14 - pw2, 7 + fs, fs, '#fff', 'right', true, true);
      bar(rx, 10 + fs, bw, bh, g.c.hp / g.c.max, g.c.ghost / g.c.max, g.c.hp < 30 ? '#ef4444' : '#22c55e', 'rgba(0,0,0,.45)', true);
      var py = 12 + fs + bh;
      [[g.p, lx, false], [g.c, rx + bw * 0.45, true]].forEach(function (o) {
        var f = o[0], full = f.pw >= 100, x = o[1], w = bw * 0.55;
        ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(x, py, w, 5);
        for (var q = 0; q < 4; q++) { var seg = Math.max(0, Math.min(1, f.pw / 25 - q)); ctx.fillStyle = full ? (Math.floor(now * 8) % 2 ? '#facc15' : '#fff') : f.def.color; var sw = w / 4 - 2; ctx.fillRect(o[2] ? x + w - (q + 1) * (w / 4) + 1 + (sw - sw * seg) : x + q * (w / 4) + 1, py + 1, sw * seg, 3); }
        if (full) text('MAX', o[2] ? x - 4 : x + w + 4, py + 6, Math.max(9, 5 * s), '#facc15', o[2] ? 'right' : 'left', true, true);
      });
      // round dots, timer, level
      if (!g.endless) [[g.pW, lx + bw - 30, 1], [g.cW, rx + 30, -1]].forEach(function (o) { for (var q = 0; q < 2; q++) { ctx.fillStyle = q < o[0] ? '#facc15' : 'rgba(0,0,0,.4)'; ctx.beginPath(); ctx.arc(o[1] + o[2] * q * 10, py + 12, 3.5, 0, 7); ctx.fill(); ctx.strokeStyle = OUT; ctx.stroke(); } });
      text(String(Math.ceil(g.timer)), W / 2, 9 + fs * 1.8, fs * 1.8, g.timer < 10 ? '#ef4444' : '#fff', 'center', true, true);
      text(g.endless ? gw('Endless') + ' · ' + gw('wins') + ' ' + g.streak + (bestEndless ? ' · ' + gw('best') + ' ' + bestEndless : '') : gw('Level') + ' ' + g.level + '/' + levels() + ' · ' + gw('Round') + ' ' + g.round, W / 2, 9 + fs * 2.9, fs * 0.8, '#e5e7eb', 'center', true, true);
      if (g.c.def.boss) text(gw('BOSS'), W / 2, 9 + fs * 3.9, fs * 0.8, '#ef4444', 'center', true, true);
      // sound switch
      var sbx = W / 2 + Math.max(30, fs * 2.4), sby = 4;
      soundBtn = [sbx, sby, 22, 18];
      ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(sbx, sby, 22, 18);
      text(soundOn ? '🔊' : '🔇', sbx + 11, sby + 14, 12, '#fff', 'center');
      text(gw('A punch ×3 · ←A backfist · S kick · →S dropkick · ↓S sweep · ↓A elbow drop · W throw (↓W knee bash) · →A headbutt · dash+A charge · run ↓S slide · D special · F super · ↓F crusher · ↓ block/PARRY · ↑ jump (←↑ backflip, air: A/knee S ↑S tornado ↓S dive, wall ↑) · B blood · M sound'), W / 2, H - 6, Math.max(10, 4.6 * s), 'rgba(255,255,255,.8)', 'center', true, true);
      if (g.tut >= 0 && g.mode === 'fight' && TUT[g.tut]) {
        var msg = gw(TUT[g.tut][1]) + (TUT[g.tut][0] === 'special' ? ' (' + gw(MOVES[g.p.def.move][0]) + ')' : TUT[g.tut][0] === 'super' ? ' (' + MOVES[g.p.def.move][2] + ')' : '');
        var bw2 = Math.min(W - 40, msg.length * fs * 0.62 + 60), by = H * 0.3;
        ctx.fillStyle = 'rgba(0,0,0,.65)'; ctx.fillRect((W - bw2) / 2, by - fs * 1.6, bw2, fs * 2.4);
        var doneN = Object.keys(g.tutDone).filter(function (k) { return TUT.some(function (t) { return t[0] === k; }); }).length;
        text(gw('Lesson') + ' ' + (doneN + 1) + '/' + TUT.length + ':  ' + msg, W / 2, by, fs * 1.1, '#fde047', 'center', true);
        text(gw('Esc: skip the lesson'), W / 2, by + fs * 1.2 + 4, fs * 0.8, '#e5e7eb', 'center');
      }
      if (g.mode === 'intro') {
        var k = Math.min(1, g.t * 2.5), y0 = H * 0.4;
        ctx.fillStyle = 'rgba(0,0,0,' + (0.35 * (1 - Math.max(0, g.t - 1.8) * 2)) + ')'; ctx.fillRect(0, 0, W, H);
        text(g.endless ? gw('Endless') + ' · ' + gw('fight') + ' ' + (g.streak + 1) : gw('Level') + ' ' + g.level + ' · ' + gw('Round') + ' ' + g.round, W / 2, y0 - 14 * s * (1 - k) - 8 * s, Math.max(16, 9 * s), '#fde047', 'center', true, true);
        text(g.p.def.name + '  VS  ' + g.c.def.name, W / 2, y0 + 3 * s, Math.max(15, 9 * s), '#fff', 'center', true, true);
        if (g.t > 0.5 && g.t < 1.6 && g.round === 1) text('“' + (g.c.def.taunt || '') + '” — ' + g.c.def.name, W / 2, y0 + 13 * s, Math.max(12, 6.5 * s), '#e5e7eb', 'center', true, true);
        if (g.t > 1.6) { var z = 1 + Math.max(0, 2 - g.t) * 2; metal(gw('FIGHT!'), W / 2, y0 + 20 * s, Math.max(22, 15 * s * z), 'red'); }
      }
      if (g.mode === 'ko') {
        var z2 = 1 + Math.max(0, 0.4 - g.t) * 4, won = g.c.hp <= 0.001;
        metal(g.timeUp ? gw('TIME!') : 'K.O.', W / 2, H * 0.46, Math.max(28, 22 * s * z2), 'red');
        if (g.t > 1.2) metal((won ? g.p : g.c).def.name.toUpperCase() + ' ' + gw('WINS'), W / 2, H * 0.46 + 16 * s, Math.max(16, 9 * s));
        if (g.t > 1.2 && false) text((won ? g.p : g.c).def.name + ' ' + gw('wins the round') + ((won ? g.p : g.c).hp >= (won ? g.p : g.c).max ? '  ·  ' + gw('PERFECT!') : ''), W / 2, H * 0.46 + 14 * s, Math.max(13, 7 * s), '#fde047', 'center', true, true);
      }
      if (g.mode === 'finishhim' && g.fin) {
        var Fz = g.fin, pul = 1 + Math.sin(now * 10) * 0.04;
        metal(gw('FINISH HIM!'), W / 2, H * 0.36, Math.max(26, 18 * s * pul), 'red');
        if (Fz.win === g.p) {
          var dd = Fz.win.dir, lab = Fz.seq.map(function (k) { return k === 'F' ? (dd > 0 ? '\u2192' : '\u2190') : k === 'B' ? (dd > 0 ? '\u2190' : '\u2192') : k === 'U' ? '\u2191' : k === 'D' ? '\u2193' : k; });
          var bx = W / 2 - lab.length * 18;
          lab.forEach(function (l, i) { ctx.fillStyle = i < Fz.i ? '#22c55e' : 'rgba(0,0,0,.6)'; ctx.fillRect(bx + i * 36, H * 0.36 + 10 * s, 30, 26); ctx.strokeStyle = '#fde047'; ctx.lineWidth = 1.5; ctx.strokeRect(bx + i * 36, H * 0.36 + 10 * s, 30, 26); text(l, bx + i * 36 + 15, H * 0.36 + 10 * s + 19, 16, '#fff', 'center', true); });
          ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(W / 2 - 80, H * 0.36 + 10 * s + 32, 160, 5); ctx.fillStyle = '#ef4444'; ctx.fillRect(W / 2 - 80, H * 0.36 + 10 * s + 32, 160 * Math.max(0, 1 - g.t / 3.6), 5);
        }
      }
      if (g.mode === 'finisher' && g.fin) {
        if (g.t < 1.2) metal(gw(FIN_NAME[g.fin.kind] || ''), W / 2, H * 0.3, Math.max(16, 10 * s), 'red');
        if (g.t > 3.0) { var zz = 1 + Math.max(0, 3.4 - g.t) * 2; metal(gw('PRINT-ALITY!'), W / 2, H * 0.42, Math.max(26, 18 * s * zz), 'red'); }
      }
      if (g.paused) text(gw('Paused — click to carry on'), W / 2, H * 0.48, Math.max(13, 8 * s), '#fff', 'center', true, true);
      if (g.mode === 'lost') {
        ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(0, 0, W, H);
        text(g.c.def.name + ' ' + gw('wins.'), W / 2, H * 0.36, Math.max(16, 10 * s), '#fff', 'center', true, true);
        text(g.endless ? gw('Endless') + ': ' + g.streak + ' ' + gw('wins') + ' · ' + gw('best') + ' ' + bestEndless : gw('You reached level') + ' ' + g.level + '.', W / 2, H * 0.36 + 11 * s, Math.max(12, 7 * s), '#e5e7eb', 'center', true);
        text(g.endless ? gw('Enter or click: start again · Esc: choose another fighter') : gw('Enter or click: try this level again · Esc: choose another fighter'), W / 2, H * 0.36 + 21 * s, Math.max(11, 6 * s), '#e5e7eb', 'center');
      }
      if (g.mode === 'champion') {
        ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.fillRect(0, 0, W, H);
        text(g.p.def.name + ' ' + gw('is the champion!'), W / 2, H * 0.36, Math.max(18, 12 * s), '#facc15', 'center', true, true);
        text(gw('Now try Endless: it never stops.'), W / 2, H * 0.36 + 12 * s, Math.max(12, 7 * s), '#fff', 'center', true, true);
        text(gw('Enter or click: back to the fighters'), W / 2, H * 0.36 + 21 * s, Math.max(11, 6.5 * s), '#e5e7eb', 'center');
      }
    }
    var cells = [], modeBtns = [];
    function drawSelect() {
      var W = g.W, H = g.H, n = roster.length, cw = Math.min(96, (W - 40) / n), hh = Math.min(H * 0.38, cw * 1.2), x0 = (W - cw * n) / 2, y0 = H * 0.22;
      ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.fillRect(0, 0, W, H);
      text(gw('Costareen Brawl — choose your fighter'), W / 2, Math.max(16, H * 0.1), Math.max(14, H * 0.065), '#fff', 'center', true, true);
      // mode and difficulty buttons
      modeBtns = [];
      var opt = [['story', gw('Story')], ['endless', gw('Endless')], ['|', ''], ['easy', gw('Easy')], ['normal', gw('Normal')], ['hard', gw('Hard')]], bx = W / 2 - 3 * 64, btnY = Math.max(22, H * 0.13);
      opt.forEach(function (o2, i) {
        if (o2[0] === '|') return;
        var on = o2[0] === 'story' ? !g.endless : o2[0] === 'endless' ? g.endless : g.diff === o2[0], x = bx + i * 64;
        ctx.fillStyle = on ? '#facc15' : 'rgba(255,255,255,.12)'; ctx.fillRect(x, btnY, 58, 15);
        text(o2[1], x + 29, btnY + 11, 10, on ? '#111' : '#e5e7eb', 'center', true);
        modeBtns.push([x, btnY, 58, 15, o2[0]]);
      });
      cells = [];
      roster.forEach(function (d, i) {
        var x = x0 + i * cw, sel = i === g.pick, iw = hh / 34 * 28, bob = sel ? Math.sin(now * 6) * 2 : 0;
        ctx.fillStyle = sel ? d.color : 'rgba(255,255,255,.08)'; ctx.globalAlpha = sel ? 0.35 : 1; ctx.fillRect(x + 2, y0 - 4, cw - 4, hh + 26); ctx.globalAlpha = 1;
        if (sel) { ctx.strokeStyle = d.color; ctx.lineWidth = 3; ctx.strokeRect(x + 2, y0 - 4, cw - 4, hh + 26); }
        ctx.drawImage(d.img, x + (cw - iw) / 2, y0 + bob, iw, hh);
        text(d.name, x + cw / 2, y0 + hh + 15, Math.max(9, Math.min(12, cw / 8)), sel ? '#fff' : '#cbd5e1', 'center', sel, sel);
        cells.push([x, y0 - 4, cw, hh + 26]);
      });
      var d = roster[g.pick], m = MOVES[d.move];
      text(gw('Special') + ': ' + gw(m[0]) + '  ·  ' + gw('Super') + ': ' + m[2] + '  ·  ' + d.outfit + (best ? '  ·  ' + gw('Best') + ': ' + gw('level') + ' ' + best : '') + (bestEndless ? '  ·  ' + gw('Endless best') + ' ' + bestEndless : ''), W / 2, y0 + hh + 36, Math.max(11, H * 0.048), '#fde047', 'center', true, true);
      text('“' + d.taunt + '”', W / 2, y0 + hh + 52, Math.max(10, H * 0.042), '#e5e7eb', 'center', true);
      text(gw('← → choose · Enter or click again: fight · M: sound ') + (soundOn ? gw('on') : gw('off')), W / 2, Math.min(H - 6, y0 + hh + 68), Math.max(10, H * 0.04), '#cbd5e1', 'center');
    }

    // ---- input: only while the canvas has focus
    var KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyW', 'Enter', 'Space', 'KeyM', 'KeyB'];
    function toggleSound() { soundOn = !soundOn; try { localStorage.setItem('erp_fight_sound', soundOn ? '1' : '0'); } catch (e) {} if (soundOn) { ac(); snd('pick'); } musicOn(soundOn && g.mode === 'fight' && !g.paused); draw(); }
    cv.addEventListener('keydown', function (ev) {
      var c = ev.code; if (KEYS.indexOf(c) < 0 && c !== 'Escape') return;
      ev.preventDefault();
      if (c === 'KeyM') { toggleSound(); return; }
      if (c === 'KeyB') { g.blood = !g.blood; try { localStorage.setItem('erp_fight_blood', g.blood ? '1' : '0'); } catch (e) {} pops.push({ x: g.p ? g.p.x : 100, y: 100, t: 0.8, s: gw(g.blood ? 'Blood on' : 'Blood off'), c: '#fff', size: 8 }); draw(); return; }
      if (g.paused) { g.paused = false; run(); return; }
      if (g.mode === 'select') {
        if (c === 'ArrowLeft') { g.pick = (g.pick + roster.length - 1) % roster.length; snd('pick'); }
        if (c === 'ArrowRight') { g.pick = (g.pick + 1) % roster.length; snd('pick'); }
        if (c === 'Enter' || c === 'Space' || c === 'KeyA') { startRun(); return; }
        draw(); return;
      }
      if (g.mode === 'lost') { if (c === 'Escape') { g.mode = 'select'; draw(); } else if (c === 'Enter' || c === 'Space') { if (g.endless) startRun(); else intro(true); } return; }
      if (g.mode === 'champion') { if (c === 'Enter' || c === 'Space') { g.mode = 'select'; draw(); } return; }
      if (g.mode === 'finishhim') { finishKey(c); return; }
      if (g.mode === 'finisher') return;
      if (c === 'Escape') { if (g.tut >= 0) { endTut(); return; } api.pause(); cv.blur(); return; }
      if (!ev.repeat) { hit[c] = true; hitT[c] = now; }
      held[c] = true;
    });
    cv.addEventListener('keyup', function (ev) { held[ev.code] = false; });
    cv.addEventListener('blur', function () { held = {}; api.pause(); });
    function inBox(b, x, y) { return b && x >= b[0] && x <= b[0] + b[2] && y >= b[1] && y <= b[1] + b[3]; }
    cv.addEventListener('mousedown', function (ev) {
      ev.preventDefault(); cv.focus({ preventScroll: true });
      var r = cv.getBoundingClientRect(), x = ev.clientX - r.left, y = ev.clientY - r.top;
      if (g.mode !== 'select' && inBox(soundBtn, x, y)) { toggleSound(); return; }
      if (g.paused) { g.paused = false; run(); return; }
      if (g.mode === 'select') {
        for (var m = 0; m < modeBtns.length; m++) if (inBox(modeBtns[m], x, y)) {
          var k = modeBtns[m][4];
          if (k === 'story' || k === 'endless') { g.endless = k === 'endless'; try { localStorage.setItem('erp_fight_mode', k); } catch (e) {} }
          else { g.diff = k; try { localStorage.setItem('erp_fight_diff', k); } catch (e) {} }
          snd('pick'); draw(); return;
        }
        for (var i = 0; i < cells.length; i++) { if (inBox(cells[i], x, y)) { if (g.pick === i) startRun(); else { g.pick = i; snd('pick'); draw(); } return; } }
        return;
      }
      if (g.mode === 'lost') { if (g.endless) startRun(); else intro(true); return; }
      if (g.mode === 'champion') { g.mode = 'select'; draw(); }
    });
    var idleT = setInterval(function () { if (dead) { clearInterval(idleT); return; } if (g.mode === 'select' && document.body.contains(cv)) { now += 0.1; draw(); } }, 100);

    var api = {
      size: g.size,
      pause: function () { if (loopOn() && !g.paused) { g.paused = true; stopLoop(); held = {}; musicOn(false); draw(); } },
      stop: function () { dead = true; stopLoop(); clearInterval(idleT); musicOn(false); },
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
      '<p>' + gw('Click the game first. Choose Story or Endless and Easy, Normal or Hard at the top, then a fighter with ← → and Enter. Story: beat everyone, best of 3 rounds each; the last one is the Spaghetti Monster. Endless: one fight after another, your health carries on, how many can you win? The first fight starts with a short lesson.') + '</p>' +
      '<table><tbody>' +
      '<tr><td>' + k('←') + ' ' + k('→') + '</td><td>' + gw('move (tap twice fast: a quick dash)') + '</td></tr>' +
      '<tr><td>' + k('↑') + '</td><td>' + gw('jump') + '</td></tr>' +
      '<tr><td>' + k('↓') + '</td><td>' + gw('hold to block') + '</td></tr>' +
      '<tr><td>' + k('A') + '</td><td>' + gw('punch — press 3 times fast for a combo that ends in an uppercut') + '</td></tr>' +
      '<tr><td>' + k('S') + '</td><td>' + gw('kick · with ↓: sweep (knocks him down) · in the air: flying kick') + '</td></tr>' +
      '<tr><td>' + k('D') + '</td><td>' + gw('your special move (wait a moment between two)') + '</td></tr>' +
      '<tr><td>' + k('F') + '</td><td>' + gw('hold to power up; when the bar says MAX, press F for your SUPER') + '</td></tr>' +
      '<tr><td>' + k('\u2190') + ' ' + k('A') + '</td><td>' + gw('spinning backfist (hold away from him)') + '</td></tr>' +
      '<tr><td>' + k('\u2192') + ' ' + k('S') + '</td><td>' + gw('running dropkick (while walking or dashing at him)') + '</td></tr>' +
      '<tr><td>' + k('\u2193') + ' ' + k('A') + '</td><td>' + gw('elbow drop on someone lying on the floor') + '</td></tr>' +
      '<tr><td>' + k('\u2190') + ' ' + k('\u2191') + '</td><td>' + gw('backflip: jump away, can\u2019t be hit for a moment') + '</td></tr>' +
      '<tr><td>' + gw('in the air') + '</td><td>' + gw('A air punch (then S air kick), \u2193+S dive kick, \u2191 at the edge of the floor: wall jump') + '</td></tr>' +
      '<tr><td>' + gw('after an uppercut') + '</td><td>' + gw('\u2191 jumps after him for an air combo; he can be hit again while flying') + '</td></tr>' +
      '<tr><td>' + k('\u2192') + ' ' + k('A') + ' ' + gw('up close') + '</td><td>' + gw('headbutt: he is left dizzy') + '</td></tr>' +
      '<tr><td>' + gw('dash') + ' + ' + k('A') + '</td><td>' + gw('shoulder charge') + '</td></tr>' +
      '<tr><td>' + gw('running at him') + ' ' + k('\u2193') + ' ' + k('S') + '</td><td>' + gw('slide tackle (low: knocks him off his feet)') + '</td></tr>' +
      '<tr><td>' + gw('jump close +') + ' ' + k('A') + '</td><td>' + gw('flying knee') + '</td></tr>' +
      '<tr><td>' + gw('in the air') + ' ' + k('\u2191') + ' ' + k('S') + '</td><td>' + gw('tornado kick (four spinning hits)') + '</td></tr>' +
      '<tr><td>' + k('\u2193') + ' ' + k('W') + '</td><td>' + gw('knee bash grab: three knees, then a shove') + '</td></tr>' +
      '<tr><td>' + k('\u2193') + ' ' + k('F') + '</td><td>' + gw('CRUSHER (full power bar): three bone-cracking blows in slow motion') + '</td></tr>' +
      '<tr><td>' + gw('FINISH HIM!') + '</td><td>' + gw('when the winning round ends, type the keys shown on screen within 3 seconds: your PRINT-ALITY finisher (12 of them: spool storm, resin tomb, print over, spaghetti wrap, laser engrave, pillar launch, bed flip, filament lasso, scale 10%, calibration cube, support cage, thermal runaway)') + '</td></tr>' +
      '<tr><td>' + gw('5-hit combo') + '</td><td>' + gw('the next heavy hit is BRUTAL!: slow motion and a big launch') + '</td></tr>' +
      '<tr><td>' + k('B') + '</td><td>' + gw('cartoon blood on / off') + '</td></tr>' +
      '<tr><td>' + k('W') + '</td><td>' + gw('throw: grab and hurl him (can\u2019t be blocked; press W when he grabs you to break free; hold \u2190 or \u2192 to throw that way)') + '</td></tr>' +
      '<tr><td>' + k('\u2193') + ' ' + gw('just before a hit') + '</td><td>' + gw('PARRY: no damage, he staggers, you gain power') + '</td></tr>' +
      '<tr><td>' + gw('a hit that lands') + '</td><td>' + gw('press D or F straight away to cancel into the special or the super') + '</td></tr>' +
      '<tr><td>' + k('M') + '</td><td>' + gw('sound on / off (or the speaker at the top)') + '</td></tr>' +
      '<tr><td>' + k('Esc') + '</td><td>' + gw('pause / skip the lesson') + '</td></tr>' +
      '</tbody></table>' +
      '<h4>' + gw('Fighters') + '</h4><table><tbody>' +
      list.map(function (d) { var m = MOVES[d.move] || ['', '', '', '']; return '<tr><td><b>' + esc(d.name) + '</b></td><td>' + gw(m[0]) + ' — ' + gw(m[1]) + '<br><span style="opacity:.8">' + gw('Super') + ': ' + m[2] + ' — ' + gw(m[3]) + '</span></td></tr>'; }).join('') +
      '</tbody></table>' +
      '<p>' + gw('Tips: the computer blocks and hits back now - block, then punish. Mix high and low: it blocks punches, so sweep. Three heavy hits make him dizzy. Knock him into the edge for a wall splat, hit him again in the air. With power to spare he can break your combo.') + '</p>';
  };
})();
