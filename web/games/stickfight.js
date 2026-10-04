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
 * v8: always two blue men (one team) against the ninja; three-man written fights first, where each side reads the
 * other's next move (parry, slip, a blow behind without looking, a split kick into both); nobody runs backwards.
 * v9 (parkour): no more giant leaps. They get about by free-running: short running hops (150 across, 50 up at most),
 * a jump to the edge of a higher box then hang and pull up, a run up the side of a box, lowering from an edge and
 * dropping, a roll after a hard landing and a slide after a fast one. A route finder picks the quickest chain of
 * moves, so a chase goes button to button across the page; a "pursuit" scene has one run and the other follow.
 * v10: the ninja's grappling hook. When there is no way to climb to the enemy (or only a very long one) he spots him,
 * fires a rope to the edge of that floor, climbs it, pulls over and attacks. The blue men have no hook: when they
 * cannot reach him they wait as close as they can, point at him and taunt. Two blue men never stand in one spot.
 * v11: the ninja always senses where they are: with no way to climb there he fires the rope within about two seconds,
 * to their floor or to the object that leads on to it (the rope reaches almost the whole screen), then free-runs on.
 * The blue men only sense him when he is near (about 380) or after he hits them; until then they patrol.
 * v11.1: the ninja's sense works everywhere: far from the enemy he looks about for 2-5 s, then "!" and he goes by
 * free-running, rope up or rope down - he never waits for an enemy who has not noticed him.
 * v12 (story): the blue men smash the page (cracks, bits, a shake - drawn on this layer only, the real buttons are never
 * touched) while the ninja leans on a button smoking; he flicks the cigarette away and walks in. A blue man who is hit
 * shouts and his mate joins. When one dies the cracks he made mend with a sparkle. The rope is shot with the bow.
 * Moves are earned: he starts with the basics and learns more with every enemy beaten (kept on this computer).
 * v13 (weapons): he picks by distance and rage. Close: fists, and the katana once he is angry. Medium: the bow, or two
 * pistols. Long, same level: a rifle burst. Far or high above: the sniper - he finds a clear line, kneels, a red line
 * settles on the head, one sure shot (Blood on: the head comes off with a short fountain; Blood off: the hat flies and he
 * drops). Rage rises with smashing near him, hits he takes and long fights, and cools between waves. Calm: no guns.
 */
(function () {
  'use strict';
  var G = 1900, ZONE = 95, M = 96;   // M: about an inch kept clear at the left, right and bottom
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
  P.split = { L: 0, hy: 15, sF: 95, eF: 0, sB: 95, eB: 0, hF: 95, kF: 0, hB: -95, kB: 0 };
  P.lie = { L: 0, hy: 21, sF: 165, eF: 15, sB: 150, eB: 25, hF: 8, kF: -6, hB: -8, kB: -14 };
  P.hang = { L: -4, hy: 21, sF: 172, eF: 6, sB: 166, eB: 12, hF: 12, kF: -14, hB: -4, kB: -24 };       // hands 50 above the feet, on an edge
  P.slide = { L: -28, hy: 13, sF: -35, eF: 40, sB: -55, eB: 30, hF: 78, kF: -6, hB: 25, kB: -70 };
  P.smoke = { L: 2, hy: 21, sF: 30, eF: 140, sB: -35, eB: 110, hF: 12, kF: -14, hB: -12, kB: -16 };   // hand at the mouth, the other on the hip
  P.bowup = { L: -8, hy: 20, sF: 140, eF: 0, sB: 128, eB: 62, hF: 30, kF: -30, hB: -22, kB: -18 };     // the bow raised, string drawn
  P.slash = { L: 22, hy: 19, sF: 40, eF: 8, sB: 20, eB: 110, hF: 42, kF: -42, hB: -30, kB: -20 };      // the katana swung down
  P.slash2 = { L: -6, hy: 20, sF: 155, eF: 0, sB: 30, eB: 100, hF: 30, kF: -36, hB: -26, kB: -22 };    // and back up
  P.slash3 = { L: 28, hy: 16, sF: 80, eF: 0, sB: -40, eB: 60, hF: 70, kF: -70, hB: -40, kB: -40 };     // the lunging thrust
  P.pistols = { L: 4, hy: 20, sF: 90, eF: 0, sB: 86, eB: 4, hF: 26, kF: -36, hB: -22, kB: -26 };
  P.rifle = { L: 6, hy: 20, sF: 86, eF: 14, sB: 100, eB: 64, hF: 28, kF: -38, hB: -24, kB: -26 };
  P.kneel = { L: 6, hy: 12, sF: 86, eF: 14, sB: 100, eB: 64, hF: 88, kF: -96, hB: -40, kB: -112 };
  P.point = { L: 2, hy: 21, sF: 118, eF: 4, sB: 18, eB: 40, hF: 14, kF: -16, hB: -14, kB: -20 };       // "there he is"
  P.hookaim = { L: -10, hy: 20, sF: 150, eF: 8, sB: 120, eB: 30, hF: 22, kF: -30, hB: -20, kB: -24 };   // looking up, the hook gun raised
  // moves in a written fight: pose, length, the moment it lands, the distance it lands from
  var MV = {
    jab: { p: 'jab', d: 0.24, hit: 0.08, r: 28 }, cross: { p: 'cross', d: 0.28, hit: 0.1, r: 28 }, hook: { p: 'hook', d: 0.32, hit: 0.13, r: 24 },
    upper: { p: 'upper', d: 0.38, hit: 0.13, r: 20 }, knee: { p: 'knee', d: 0.34, hit: 0.13, r: 18 }, elbow: { p: 'elbow', d: 0.3, hit: 0.11, r: 18 },
    headbutt: { p: 'headbutt', d: 0.32, hit: 0.13, r: 16 }, kick: { p: 'kick', d: 0.36, hit: 0.13, r: 32 }, spin: { p: 'kick', d: 0.48, hit: 0.24, r: 32, spin: 1 },
    round: { p: 'kick', d: 0.44, hit: 0.2, r: 33, spin: 0.6 }, sweep: { p: 'sweep', d: 0.42, hit: 0.15, r: 30 }, stomp: { p: 'stomp', d: 0.36, hit: 0.18, r: 12 },
    axe: { p: 'axe', d: 0.6, hit: 0.38, r: 22, hop: 34 }, flykick: { p: 'flykick', d: 0.55, hit: 0.3, r: 28, hop: 30 }, slam: { p: 'grab', d: 0.75, hit: 0.12, r: 18 },
    backflip: { p: 'air', d: 0.5, back: 52 }, split: { p: 'split', d: 0.55, hit: 0.24, r: 30, hop: 26 }, taunt: { p: 'taunt', d: 0.7 }, step: { p: 'walk', d: 0.32 }
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
    [['b', 'jab', 'a', 'parry'], ['a', 'cross', 'b', 'parry'], ['b', 'hook', 'a', 'duck'], ['a', 'elbow', 'c', 'gut', { with: 1, off: 0.12 }], ['a', 'upper', 'b', 'head'], ['c', 'kick', 'a', 'block'], ['b', 'kick', 'a', 'block', { with: 1, off: 0.06 }], ['a', 'split', 'b', 'head', { also: 'c', slow: 0.5 }], ['b', 'cross', 'a', 'parry'], ['a', 'knee', 'b', 'gut'], ['a', 'spin', 'b', 'fling', { slow: 0.6 }], ['c', 'hook', 'a', 'duck'], ['a', 'sweep', 'c', 'down'], ['a', 'stomp', 'c', 'onground']],
    [['b', 'jab', 'a', 'block'], ['c', 'jab', 'a', 'block', { with: 1 }], ['b', 'cross', 'a', 'parry'], ['c', 'cross', 'a', 'parry', { with: 1 }], ['b', 'kick', 'a', 'duck'], ['c', 'kick', 'b', 'gut', { with: 1, off: 0.02 }], ['a', 'sweep', 'c', 'down'], ['a', 'headbutt', 'b', 'head'], ['b', 'hook', 'a', 'parry'], ['a', 'slam', 'b', 'slam', { slow: 0.45 }], ['a', 'stomp', 'b', 'onground', { gap: 0.1 }], ['a', 'taunt', null, null, { gap: 0.3 }]],
    [['c', 'hook', 'a', 'hit'], ['b', 'knee', 'a', 'gut'], ['c', 'cross', 'a', 'hit'], ['b', 'kick', 'a', 'lean'], ['a', 'taunt'], ['b', 'jab', 'a', 'parry'], ['c', 'jab', 'a', 'parry', { with: 1, off: 0.08 }], ['a', 'split', 'b', 'head', { also: 'c', slow: 0.6 }], ['a', 'flykick', 'b', 'down'], ['c', 'hook', 'a', 'duck'], ['a', 'upper', 'c', 'head'], ['a', 'round', 'c', 'fling', { slow: 0.6 }]],
    [['a', 'jab', 'b', 'block'], ['b', 'cross', 'a', 'parry'], ['c', 'kick', 'a', 'duck', { with: 1, off: 0.1 }], ['a', 'sweep', 'c', 'block'], ['c', 'hook', 'a', 'parry'], ['b', 'kick', 'a', 'block', { with: 1, off: 0.1 }], ['a', 'backflip'], ['b', 'step'], ['c', 'step', null, null, { with: 1 }], ['a', 'split', 'b', 'gut', { also: 'c' }], ['a', 'elbow', 'b', 'head'], ['a', 'knee', 'c', 'gut'], ['a', 'axe', 'b', 'down', { slow: 0.55 }], ['c', 'cross', 'a', 'parry'], ['a', 'spin', 'c', 'fling', { slow: 0.6 }]],
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
    grab: { hit: 0.08, act: 0.12, end: 0.45, reach: 30, dmg: 0, grab: 1 },
    slash: { hit: 0.07, act: 0.09, end: 0.24, reach: 34, dmg: 14, kb: 220, up: 0, blade: 1, next: 'slash2' },
    slash2: { hit: 0.07, act: 0.09, end: 0.26, reach: 34, dmg: 14, kb: 240, up: 0, blade: 1, next: 'slash3' },
    slash3: { hit: 0.1, act: 0.1, end: 0.36, reach: 40, dmg: 22, kb: 620, up: 300, heavy: 1, blade: 1 }
  };

  window.ERP_STICK = function (o) {
    o = o || {};
    var cv = document.createElement('canvas'); cv.id = 'stickfx';
    cv.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;pointer-events:none;z-index:45';
    document.body.appendChild(cv);
    var ctx = cv.getContext('2d'), W = 0, H = 0, dpr = 1;
    var mode = o.mode || 'on', blood = o.blood !== false, on = false, raf = 0, last = 0, acc = 0;
    var plats = [], boxes = [], hero = null, foe = null, third = null, fx = [], decals = [], rags = [];
    var mx = -999, my = -999, mouseT = -99, scanT = 0, now = 0, nextFoeT = 1, kills = 0;
    var cho = null, choCd = 3, slowT = 0, thirdT = -1, lastCho = '';
    // moves he learns: the basics from the start, the rest one by one as enemies are beaten (kept on this computer)
    var UNLOCK = { round: 3, katana: 4, backflip: 5, slide: 7, flykick: 9, pistols: 10, counter: 12, spin: 14, slam: 17, rifle: 18, axe: 20, sniper: 22, ropepull: 24, split: 28 };
    var XP = (function () { try { return Number(localStorage.getItem('erp_stick_kills')) || 0; } catch (e) { return 0; } })();
    function can(mv) { return (UNLOCK[mv] || 0) <= XP; }
    function learnt() { XP++; try { localStorage.setItem('erp_stick_kills', String(XP)); } catch (e) {} }
    var cracks = [];

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
        if (x1 - x0 >= 24) np.push({ el: e, x0: x0, x1: x1, y: r.top, yb: r.bottom });
        if (r.height < 60 && r.width < 500 && e.matches('button, .btn, .pill, .cchip, input, select')) nb.push({ el: e, x0: r.left, x1: r.right, y0: r.top, y1: r.bottom });
      }
      np.push({ el: null, x0: M, x1: W - M, y: H - M, ground: 1 });   // a last-resort floor an inch above the bottom
      var same = function (q) { return !q ? null : q.ground ? np[np.length - 1] : (q.el ? np.filter(function (p) { return p.el === q.el; })[0] || null : null); };
      [hero, foe, third].forEach(function (m) {
        if (!m) return;
        ['trip', 'fleeTo', 'actP', 'upTo'].forEach(function (k) { if (m[k]) m[k] = same(m[k]); });
        if (m.act && !m.actP) m.act = null;
        if (m.seqEnd) { if (m.seqEnd.land) { var L2 = same(m.seqEnd.land); if (L2) m.seqEnd.land = L2; else m.seqEnd = { fall: { vx: 0, aim: null } }; } if (m.seqEnd.fall && m.seqEnd.fall.aim) m.seqEnd.fall.aim = same(m.seqEnd.fall.aim); }
      });
      [hero, foe, third].forEach(function (m) {
        if (m && m.aim) { m.aim = m.aim.el ? np.filter(function (p) { return p.el === m.aim.el; })[0] || null : null; }
        if (!m || !m.on) return;
        var q = m.on.el ? np.filter(function (p) { return p.el === m.on.el; })[0] : np[np.length - 1];
        if (q) { m.x = q.x0 + (m.x - m.on.x0); m.y = q.y; m.on = q; if (m.x < q.x0 - 2 || m.x > q.x1 + 2) m.on = null; } else m.on = null;
      });
      decals.forEach(function (d) { if (!d.on) return; var q = d.on.el ? np.filter(function (p) { return p.el === d.on.el; })[0] : np[np.length - 1]; if (q) { d.x = q.x0 + (d.x - d.on.x0); d.y = q.y; d.on = q; } else d.t = 0; });
      plats = np; boxes = nb; pcache = {};
      buildEdges();
    }
    function spot(a, b, fromX) { return Math.max(b.x0 + 8, Math.min(b.x1 - 8, fromX)); }
    function idx(p) { return plats.indexOf(p); }
    function cl(v, a, b) { return Math.max(a, Math.min(b, v)); }
    // ---- parkour: what a person can really do. A running hop (150 across, 50 up), a jump to the edge of a higher
    //   box then hang and pull up (105 up), a run up the side of a box then hang and pull up (170 up), stepping off
    //   an edge, or lowering from it, hanging and letting go (down to 380). Nothing bigger.
    var edges = [], pcache = {}, HOP_X = 150, HOP_UP = 50, CLIMB_UP = 105, WALL_UP = 170, DROP_MAX = 380, HANG = 50, RUN = 220;
    function moveOf(a, b) {
      if (a === b || b.x1 - b.x0 < 20) return null;
      var rise = a.y - b.y, gap = b.x0 > a.x1 ? b.x0 - a.x1 : a.x0 > b.x1 ? a.x0 - b.x1 : 0, best = null;
      if (gap > 300 || rise > WALL_UP || -rise > DROP_MAX) return null;
      function keep(mv) { if (mv && (!best || mv.cost < best.cost)) best = mv; }
      if (rise <= 8) {                                            // level, or down
        var d = -rise;
        if (gap > 0 && gap <= HOP_X + (d > 20 ? 40 : 0)) {
          var right = b.x0 > a.x1;
          keep({ k: 'hop', s: right ? a.x1 - 4 : a.x0 + 4, lx: right ? Math.min(b.x1 - 8, b.x0 + 14) : Math.max(b.x0 + 8, b.x1 - 14), side: right ? 1 : -1, cost: 0.3 + gap / 400 + d / 900 });
        }
        if (d > 12) [a.x0, a.x1].forEach(function (e, i) {      // off one of my edges and down onto b
          var side = i ? 1 : -1, sy = d > 70 ? a.y + HANG : a.y, t = Math.sqrt(2 * Math.max(4, b.y - sy) / G);
          var lx = cl(e + side * 6, b.x0 + 8, b.x1 - 8);
          if (Math.abs(lx - e) / t > 260) return;
          keep({ k: d > 70 ? 'drop' : 'off', s: e - side * 4, e: e, lx: lx, side: side, vx: (lx - e) / t, cost: 0.3 + t + (d > 70 ? 0.45 : 0) });
        });
        return best;
      }
      [b.x0, b.x1].forEach(function (E, i) {
        var side = i ? -1 : 1, s0 = cl(E - side * 10, a.x0 + 4, a.x1 - 4), reach = (E - s0) * side, wall = b.yb !== undefined && a.y - b.yb <= 40;
        // up from outside, beside one of b's edges: hop, jump to the edge and pull up, or run up its side
        if (reach >= 2) {
          if (rise <= HOP_UP && reach <= 120) keep({ k: 'hop', s: s0, lx: E + side * 12, side: side, cost: 0.35 + reach / 400 });
          else if (rise <= CLIMB_UP && reach <= 60) keep({ k: 'climb', s: s0, hx: E - side * 3, fx: E + side * 10, face: side, cost: 1.0 + reach / 400 });
          else if (reach <= 26 && wall) keep({ k: 'wall', s: s0, hx: E - side * 3, fx: E + side * 10, face: side, cost: 1.3 });
        }
        // up from inside b (a row in a table, a button in a card): to its edge, hang there and climb over the top
        var si = E + side * 12;
        if (si > a.x0 + 3 && si < a.x1 - 3 && E > a.x0 - 40 && E < a.x1 + 40) {
          if (rise <= CLIMB_UP) keep({ k: 'climb', s: si, hx: E + side * 3, fx: E + side * 14, face: -side, cost: 1.1 });
          else if (wall) keep({ k: 'wall', s: si, hx: E + side * 3, fx: E + side * 14, face: -side, cost: 1.4 });
        }
      });
      return best;
    }
    function buildEdges() {
      // the bottom of the screen is a last resort: routes keep off it unless the other man is down there
      edges = plats.map(function (a) { var out = []; plats.forEach(function (b, j) { var mv = moveOf(a, b); if (mv) { mv.to = j; if (b.ground) mv.cost += 3; out.push(mv); } }); return out; });
    }
    function landX(e) { return e.lx !== undefined ? e.lx : e.fx; }
    // the quickest chain of moves from here to every ledge (running time on each ledge plus each move)
    function paths(from, fromX) {
      var a = idx(from); if (a < 0) return null;
      var key = a + ':' + Math.round(fromX / 40), hit = pcache[key]; if (hit && now - hit.t < 0.4) return hit.P;
      var n = plats.length, dist = [], prev = [], pe = [], xs = [], done = [];
      for (var i = 0; i < n; i++) dist[i] = 1e9;
      dist[a] = 0; xs[a] = fromX;
      for (;;) {
        var u = -1, bd = 1e9; for (var k = 0; k < n; k++) if (!done[k] && dist[k] < bd) { bd = dist[k]; u = k; }
        if (u < 0) break; done[u] = 1;
        var es = edges[u] || [];
        for (var q = 0; q < es.length; q++) { var e = es[q], c = dist[u] + Math.abs(e.s - xs[u]) / RUN + e.cost; if (c < dist[e.to]) { dist[e.to] = c; prev[e.to] = u; pe[e.to] = e; xs[e.to] = landX(e); } }
      }
      var P2 = { dist: dist, prev: prev, pe: pe, from: a }; pcache[key] = { t: now, P: P2 }; return P2;
    }
    function firstMove(P2, to) {
      var b = idx(to); if (!P2 || b < 0 || b === P2.from || !(P2.dist[b] < 1e9)) return null;
      var n = b; while (P2.prev[n] !== P2.from) n = P2.prev[n];
      return P2.pe[n];
    }
    function nearestReach(P2, x, y) {   // no way to him: the ledge I can reach that is closest to him
      var best = null, bd = 1e9; if (!P2) return null;
      plats.forEach(function (p, i) { if (!(P2.dist[i] < 1e9)) return; var d = Math.hypot(cl(x, p.x0, p.x1) - x, p.y - y) + P2.dist[i] * 15; if (d < bd) { bd = d; best = p; } });
      return best;
    }
    function badKey(e) { var b = plats[e.to]; return e.k + Math.round(e.s) + ':' + (b ? Math.round(b.y) : 0); }
    function isBad(m, e) { return m.bad && m.bad[badKey(e)] > now; }
    function badMove(m, e) { m.bad = m.bad || {}; m.bad[badKey(e)] = now + 3; }
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
    function begin(m, st, atk) { m.st = st; m.t = 0; m.done = 0; m.atk = atk || null; m.queue = null; m.act = null; m.smashing = 0; if (st !== 'seq') { m.seq = null; m.rope = null; } }
    // a blue man smashing the page: the crack sits on the element he kicks (drawn here only - the page itself is untouched)
    function crack(m, A) {
      var el = m.on && m.on.el; if (!el) return;
      if (Math.random() < 0.5) { dust(m.x + m.dir * 14, m.y, 2); return; }   // not every blow leaves a mark
      var r = el.getBoundingClientRect(); if (!r.width) return;
      var px = m.x + m.dir * (A && A.low ? 12 : 18), py = r.top + 2 + Math.random() * Math.max(1, Math.min(10, r.height - 4));
      var rx = cl(px - r.left, 3, r.width - 3), ry = cl(py - r.top, 2, Math.max(3, r.height - 3)), segs = [];
      for (var i = 0, n = 2 + Math.floor(Math.random() * 2); i < n; i++) {
        var a = Math.random() * Math.PI * 2, len = 4 + Math.random() * 4, x = 0, y = 0, pts = [];
        for (var k = 0; k < 3; k++) { a += (Math.random() - 0.5) * 0.9; x += Math.cos(a) * len / 3; y += Math.sin(a) * len / 3; pts.push([x, y]); }
        segs.push(pts);
      }
      var onEl = cracks.filter(function (c) { return c.el === el && !c.mend; });
      if (onEl.length >= 2) onEl[0].mend = 0.001;                 // at most two marks on one thing; the oldest fades
      cracks.push({ el: el, rx: rx, ry: ry, segs: segs, t: 0, by: m, mend: 0 }); if (cracks.length > 12) cracks.shift();
      var gx = r.left + rx, gy = r.top + ry;
      for (var b = 0; b < 3; b++) fx.push({ k: 'bit', x: gx, y: gy, vx: (Math.random() - 0.5) * 160, vy: -60 - Math.random() * 160, t: 0.6, T: 0.6 });
      dust(gx, gy, 3); shake(1.2);
      if (hero && Math.hypot(gx - hero.x, gy - hero.y) < 420) hero.rage = Math.min(100, (hero.rage || 0) + 3);   // smashing in front of him makes him angry
    }
    function mendBy(m) {   // he is beaten: what he broke mends, with a sparkle
      cracks.forEach(function (c) {
        if (c.by !== m || c.mend) return; c.mend = 0.001;
        try { var r = c.el.getBoundingClientRect(); spark(r.left + c.rx, r.top + c.ry, 5, '#fde68a'); } catch (e) {}
      });
    }
    function smashAbout(m) {   // not aware of the ninja yet: kick and punch whatever he stands on, then move to the next thing
      if (!m.on) return;
      if (!m.on.el || m.on.ground || (m.smashN || 0) > (m.smashMax || 8)) {
        m.smashN = 0; m.smashMax = 6 + Math.floor(Math.random() * 6);
        if (m.trip && m.trip !== m.on && moveTo(m, m.trip)) return;
        var c = (edges[idx(m.on)] || []).map(function (e) { return plats[e.to]; }).filter(function (p) { return p.el && !p.ground; });
        if (c.length) { m.trip = c[Math.floor(Math.random() * c.length)]; if (moveTo(m, m.trip)) return; }
        roam(m); return;
      }
      if (Math.random() < 0.22) { m.st = 'walk'; m.vx = (Math.random() < 0.5 ? 1 : -1) * 45; m.dir = m.vx > 0 ? 1 : -1; m.think = 0.4; return; }
      begin(m, 'atk', ['kick', 'jab', 'sweep', 'kick', 'cross'][Math.floor(Math.random() * 5)]); m.vx = 0; m.smashing = 1;
      m.smashN = (m.smashN || 0) + 1; m.think = 0.45 + Math.random() * 0.6;
    }
    function enemyOf(m) {
      if (m !== hero) return hero;
      var a = foe && !foe.dying ? foe : null, b = third && !third.dying ? third : null;
      if (!a || !b) return a || b;
      return Math.hypot(a.x - hero.x, a.y - hero.y) <= Math.hypot(b.x - hero.x, b.y - hero.y) ? a : b;
    }
    function hurt(a, b, A) {
      if (!b || b.cho || b.st === 'dead' || b.st === 'flung' || b.st === 'held' || b.st === 'seq') return;
      var dir = b.x >= a.x ? 1 : -1;
      // the ninja reads almost everything: he blocks or slips away and hits back
      if (b === hero && can('counter') && a.on && a.on === hero.on && free2(hero) && Math.random() < 0.3) {   // reads it and throws him
        hero.dir = a.x >= hero.x ? 1 : -1; begin(hero, 'atk', 'toss'); begin(a, 'held'); hero.holding = a; a.heldBy = hero; a.on = null; return;
      }
      if (b === hero && Math.random() < 0.55) {
        if (Math.random() < 0.5 && hero.on) { spark(b.x - dir * 6, b.y - 28, 6); begin(hero, 'block'); hero.counter = 1; }
        else { var Av = a.on ? planArc(hero, cl(a.x - dir * 40, a.on.x0 + 4, a.on.x1 - 4), a.on.y, a.on, 55) : null; if (Av) { jumpTo(hero, cl(a.x - dir * 40, a.on.x0 + 4, a.on.x1 - 4), a.on.y, true, a.on, Av); hero.ambush = 1; } else { begin(hero, 'block'); hero.counter = 1; } }
        return;
      }
      if (b.st === 'block' && b.dir === -dir) { spark(b.x - dir * 6, b.y - 28, 6); b.vx = dir * A.kb * 0.3; return; }
      if (b !== hero) b.hp -= A.dmg; else { b.sta -= A.dmg * 1.4; b.rage = Math.min(100, (b.rage || 0) + 10); }
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
      if (r.fountain > 0 && blood) { r.fountain -= dt; r.fT = (r.fT || 0) - dt; if (r.fT <= 0) { r.fT = 0.03; var nk = r.pts.neck; fx.push({ k: 'blood', x: nk.x, y: nk.y, vx: (Math.random() - 0.5) * 70, vy: -170 - Math.random() * 150, t: 1.2, T: 1.2, r: 1.2 }); } }
      if (blood && r.t < 0.6) { r.bleedT -= dt; if (r.bleedT <= 0) { r.bleedT = 0.18; var n = r.pts.neck; fx.push({ k: 'blood', x: n.x, y: n.y, vx: (Math.random() - 0.5) * 70, vy: -50, t: 1.2, T: 1.2, r: 1.3 }); } }
    }

    // ---- moving
    // a jump that rises only a little above the higher of the two floors (no more flying over the page)
    function arcFor(m, x, y, extra) {
      var dx = x - m.x, rise = m.y - y, h = Math.max(0, rise) + extra, vy = -Math.sqrt(2 * G * h), tu = -vy / G, td = Math.sqrt(2 * Math.max(1, h - rise) / G), T = tu + td;
      return { vx: dx / T, vy: vy, T: T };
    }
    function clearArc(m, A, plat) {
      var vx = A.vx, vy = A.vy, T = A.T;
      for (var k = 1; k < 12; k++) {
        var t = T * k / 12, px = m.x + vx * t, py = m.y + vy * t + 0.5 * G * t * t;
        if (py < 0) continue;
        for (var i = 0; i < boxes.length; i++) {
          var b = boxes[i];
          if (m.on && b.el === m.on.el) continue;
          if (plat && b.el === plat.el) continue;                // the box he lands on: he goes up beside it and onto it
          if (px + 5 > b.x0 && px - 5 < b.x1 && py > b.y0 + 2 && py - 40 < b.y1) return false;
        }
      }
      return true;
    }
    function planArc(m, x, y, plat, extra0) {   // the lowest of three arcs that clears the boxes on the way, or null
      var base = extra0 !== undefined ? extra0 : 16 + Math.min(26, Math.abs(x - m.x) * 0.12), tries = [base, base + 14, base + 30];
      for (var i = 0; i < tries.length; i++) { var A = arcFor(m, x, y, tries[i]); if (clearArc(m, A, plat)) return A; }
      return null;
    }
    function jumpTo(m, x, y, flip, plat, A) {
      A = A || arcFor(m, x, y, 16 + Math.min(26, Math.abs(x - m.x) * 0.12));
      m.vx = A.vx; m.vy = A.vy; m.on = null; if (Math.abs(A.vx) > 5) m.dir = A.vx > 0 ? 1 : -1;
      begin(m, 'air'); m.flip = flip ? 1 : 0; m.spin = 0; m.aim = plat || null; m.vault = 0; dust(m.x, m.y, 4);
    }
    // carry out one move: run to the take-off point, then do it
    function doMove(m, e) {
      if (!m.on || !e) return false;
      var b = plats[e.to]; if (!b) return false;
      if (Math.abs(m.x - e.s) > 6) { m.act = e; m.actP = b; m.st = 'run'; m.dir = e.s > m.x ? 1 : -1; m.vx = m.dir * RUN * (mode === 'calm' ? 0.7 : 1); return true; }
      return execMove(m, e, b);
    }
    function execMove(m, e, b) {
      m.act = null; m.actP = null;
      if (e.k === 'hop') {
        var A = planArc(m, e.lx, b.y, b);
        if (!A && m.y - b.y > 10) {   // no clean hop up: climb it instead (jump to the edge, hang, pull up)
          var E2 = e.lx - e.side * 12;
          return execMove(m, { k: 'climb', s: e.s, hx: E2 - e.side * 3, fx: E2 + e.side * 10, face: e.side }, b);
        }
        if (!A) { badMove(m, e); begin(m, 'guard'); m.vx = 0; return false; }
        var gap = Math.abs(e.lx - m.x);
        jumpTo(m, e.lx, b.y, gap > 120 && Math.random() < 0.5, b, A);   // a flip only over a long gap
        if (m.y - b.y > 15) m.vault = 1;
        return true;
      }
      if (e.k === 'climb' || e.k === 'wall') {
        var hx = e.hx, hy = b.y + HANG, seq = [];
        m.dir = e.face;
        if (e.k === 'climb') seq.push({ p: 'air', d: Math.max(0.22, Math.sqrt(2 * (Math.max(10, m.y - hy) + 10) / G)), x0: m.x, y0: m.y, x1: hx, y1: hy, arc: 10 });
        else seq.push({ p: 'wall', d: Math.max(0.25, (m.y - hy) / 330), x0: m.x, y0: m.y, x1: hx, y1: hy });
        seq.push({ p: 'hang', d: 0.1 + Math.random() * 0.15, x0: hx, y0: hy, x1: hx, y1: hy, face: e.face });
        seq.push({ p: 'pull', d: 0.4, x0: hx, y0: hy, x1: e.fx, y1: b.y, face: e.fx >= hx ? 1 : -1 });
        dust(m.x, m.y, 3); runSeq(m, seq, { land: b });
        return true;
      }
      m.dir = e.side;
      if (e.k === 'rappel') {   // hook the edge, lower down and slide down the rope
        var rx = e.e + e.side * 3, top = m.y;
        runSeq(m, [{ p: 'lower', d: 0.28, x0: m.x, y0: m.y, x1: rx, y1: top + HANG, face: -e.side },
                   { p: 'rope', d: Math.max(0.4, (b.y - top - HANG) / 420), x0: rx, y0: top + HANG, x1: rx, y1: b.y, face: -e.side }], { land: b });
        m.rope = { ax: e.e, ay: top };
        return true;
      }
      if (e.k === 'off') { m.on = null; begin(m, 'air'); m.x = e.e + e.side * 2; m.vx = e.vx; m.vy = 0; m.aim = b; return true; }
      // drop: turn to face the ledge, lower down, hang, let go
      var ex = e.e + e.side * 3;
      runSeq(m, [{ p: 'lower', d: 0.28, x0: m.x, y0: m.y, x1: ex, y1: m.y + HANG, face: -e.side }, { p: 'hang', d: 0.12 + Math.random() * 0.12, x0: ex, y0: m.y + HANG, x1: ex, y1: m.y + HANG, face: -e.side }],
        { fall: { vx: e.vx, aim: b } });
      return true;
    }
    function runSeq(m, seq, end) { begin(m, 'seq'); m.seq = seq; m.seqI = 0; m.seqT = 0; m.seqEnd = end; m.on = null; m.vx = m.vy = 0; m.flip = 0; m.spin = 0; m.aim = null; }
    function stepSeq(m, dt) {
      var q = m.seq && m.seq[m.seqI]; if (!q) { endSeq(m); return; }
      m.seqT += dt; var k = Math.min(1, m.seqT / q.d), ke = q.p === 'wall' ? k : ease(k), ox = m.x, oy = m.y;
      if (q.face) m.dir = q.face;
      m.x = q.x0 + (q.x1 - q.x0) * ke; m.y = q.y0 + (q.y1 - q.y0) * ke - (q.arc ? Math.sin(Math.PI * k) * q.arc : 0);
      m.x = cl(m.x, M, W - M); m.y = Math.min(m.y, H - M);       // an inch clear of the sides and the bottom
      if (q.p === 'wall') m.ph += dt * 18;
      m.vx = (m.x - ox) / Math.max(dt, 0.001); m.vy = (m.y - oy) / Math.max(dt, 0.001);
      if (k >= 1) { m.seqI++; m.seqT = 0; if (m.seqI >= m.seq.length) endSeq(m); }
    }
    function endSeq(m) {
      var e = m.seqEnd || {}; m.seq = null; m.seqEnd = null;
      var yt = e.yank;
      if (m.rope) { if (!yt) m.hookHit = now; m.rope = null; }
      if (e.land && idx(e.land) >= 0) {
        m.on = e.land; m.y = e.land.y; m.x = cl(m.x, e.land.x0, e.land.x1); m.vx = m.vy = 0; begin(m, 'land'); m.lastLand = now; dust(m.x, m.y, 4);
        if (yt && yt.on === m.on && !yt.dying && !yt.cho && yt.st !== 'flung' && yt.st !== 'held') { yt.yank = { x0: yt.x, x1: m.x + m.dir * 24 }; begin(yt, 'yank'); m.pulling = yt; begin(m, 'guard'); }
        return;
      }
      m.on = null; begin(m, 'air'); m.vx = e.fall ? e.fall.vx : 0; m.vy = 0; m.aim = e.fall && e.fall.aim && idx(e.fall.aim) >= 0 ? e.fall.aim : null;
      if (e.fall) m.dir = e.fall.vx >= 0 ? 1 : -1;
    }
    function escape(m) {   // the mouse came close: the move that takes me away from it
      var away = m.x >= mx ? 1 : -1, best = null, bs = -1e9;
      (edges[idx(m.on)] || []).forEach(function (e) {
        var p = plats[e.to], tx = landX(e); if (nearBlock(tx, p.y) || isBad(m, e)) return;
        var sc = (tx - m.x) * away - Math.abs(e.s - m.x) * 0.5 - Math.abs(m.y - p.y) * 0.2;
        if (sc > bs) { bs = sc; best = e; }
      });
      if (best) doMove(m, best); else { m.st = 'run'; m.vx = away * 300; m.dir = away; }
    }
    function roam(m) {   // somewhere else on the screen, often far, by a chain of moves
      if (!m.on) return;
      var P2 = paths(m.on, m.x), c = [];
      plats.forEach(function (p, i) { if (p !== m.on && !p.ground && P2 && P2.dist[i] < 8 && !nearBlock((p.x0 + p.x1) / 2, p.y)) c.push(p); });
      if (!c.length) return;
      var far = function (p) { return Math.abs((p.x0 + p.x1) / 2 - m.x) + Math.abs(p.y - m.y); };
      c.sort(function (a, b) { return far(b) - far(a); });
      m.trip = c[Math.floor(Math.random() * Math.min(6, c.length))];
      moveTo(m, m.trip);
    }

    // ---- minds: a "director" picks the scene so the fight is never the same loop
    //   duel (guard, step in, exchange, step back), stand-off (circle and taunt), ambush (the ninja hides, the other searches),
    //   breather (both pant), chase (a beaten enemy runs, the ninja follows; 1 in 3 chases he takes out the bow),
    //   retreat (the ninja is worn out - hidden stamina - runs off and catches his breath, the enemy hunts him)
    var scene = { name: 'standoff', t: 3, last: '', n: 0, bow: false, arrows: 0, runner: null };
    function setScene(name, t) { scene.last = scene.name; scene.name = name; scene.t = t; scene.n++; if (hero) { hero.guardT = 0; hero.goHide = 0; if (hero.st === 'hide' && name !== 'ambush') hero.st = 'guard'; } if (foe) foe.guardT = 0; }
    function pickScene() {
      var opts = ['duel', 'duel', 'duel', 'pursuit', 'pursuit', 'standoff', 'ambush'].filter(function (n) { return n !== scene.name; });
      var n = opts[Math.floor(Math.random() * opts.length)];
      if (hero && hero.noWaySince) n = 'duel';                  // he is on his way up to them: no hiding or running scenes now
      setScene(n, n === 'duel' ? 6 + Math.random() * 5 : n === 'pursuit' ? 7 + Math.random() * 4 : n === 'standoff' ? 1.8 + Math.random() * 1.2 : n === 'ambush' ? 7 : 2 + Math.random());
      if (n === 'pursuit') { scene.runner = Math.random() < 0.5 ? hero : foe; if (scene.runner) { scene.runner.fleeTo = null; } }
    }
    function direct(dt) {
      if (!hero || !foe || foe.dying) return;
      scene.t -= dt;
      if (foe.hp < 24 && !foe.fled && foe.on && scene.name !== 'chase') { foe.fled = 1; setScene('chase', 9); scene.bow = Math.random() < 1 / 3; scene.arrows = 0; return; }

      if (scene.name === 'retreat' && hero.sta > 88 && hero.st !== 'pant') { setScene('duel', 7); return; }
      if (scene.name === 'pursuit' && (!scene.runner || scene.runner.dying || (scene.runner !== hero && scene.runner !== foe))) { setScene('duel', 6); return; }
      if (scene.t <= 0) { if (scene.name === 'chase') setScene('duel', 8); else if (scene.name !== 'retreat') pickScene(); }
    }
    function attackChoice(m) {
      var r = Math.random();
      if (m === hero && brutal(m) && can('katana') && r < 0.75) return 'slash';
      if (m === hero) { var a2 = r < 0.3 ? 'grab' : r < 0.48 ? 'jab' : r < 0.62 ? 'round' : r < 0.78 ? 'kick' : r < 0.9 ? 'upper' : 'sweep'; return a2 === 'round' && !can('round') ? 'kick' : a2; }
      return r < 0.15 ? 'grab' : r < 0.47 ? 'jab' : r < 0.67 ? 'kick' : r < 0.78 ? 'round' : r < 0.9 ? 'sweep' : 'upper';
    }
    // getting about: the first move of the quickest chain to a ledge
    function moveTo(m, p) {
      if (!m.on || !p || p === m.on) return false;
      var e = firstMove(paths(m.on, m.x), p);
      return e && !isBad(m, e) && !nearBlock(landX(e), plats[e.to].y) ? doMove(m, e) : false;
    }
    function farFrom(m, from) {   // a ledge a few moves away, as far from "from" as it gets
      var P2 = paths(m.on, m.x), best = null, bs = -1e9;
      if (!P2) return null;
      plats.forEach(function (p, i) { if (p === m.on || p.ground || !(P2.dist[i] < 4) || nearBlock((p.x0 + p.x1) / 2, p.y)) return; var d = Math.hypot((p.x0 + p.x1) / 2 - from.x, p.y - from.y) - P2.dist[i] * 40 + Math.random() * 60; if (d > bs) { bs = d; best = p; } });
      return best;
    }
    function upFrom(m, near) {   // off the bottom of the screen: the quickest ledge back up (near "near" if given)
      var P2 = paths(m.on, m.x), best = null, bs = 1e9; if (!P2) return null;
      plats.forEach(function (p, i) { if (p.ground || !(P2.dist[i] < 1e9) || nearBlock((p.x0 + p.x1) / 2, p.y)) return; var sc = P2.dist[i] + (near ? Math.hypot(cl(near.x, p.x0, p.x1) - near.x, p.y - near.y) / 150 : 0); if (sc < bs) { bs = sc; best = p; } });
      return best;
    }
    function goToward(m, tg) {   // chase him by the quickest chain of moves; no way at all: get as close as I can
      if (!m.on || !tg.on) return false;
      if (tg.on.ground && !m.on.ground && m !== hero) { var up0 = upFrom(m, tg); if (up0 === m.on) return false; if (up0) return moveTo(m, up0); }   // he is at the bottom: wait for him up here (the ninja goes down if they cannot come up)
      var P2 = paths(m.on, m.x), e = firstMove(P2, tg.on), ti = idx(tg.on);
      if (m === hero) {
        if (!e || isBad(m, e) || (P2 && P2.dist[ti] > 5)) {   // no way up (or a long one): the rope - to him, or after a moment to whatever leads on
          if (!m.noWaySince) m.noWaySince = now;
          if (hookTo(m, tg.on, tg) || (now - m.noWaySince > 1.5 && hookPlan(m, tg))) { m.noWaySince = 0; return true; }
          if (tg.y - m.y > 60 && !e && rappel(m, tg)) { m.noWaySince = 0; return true; }      // he is far below: down the rope
        } else m.noWaySince = 0;
      }
      if (e && !isBad(m, e) && !nearBlock(landX(e), plats[e.to].y)) return doMove(m, e);
      var b = nearestReach(P2, tg.x, tg.y);
      if (b && b !== m.on) { e = firstMove(P2, b); if (e && !isBad(m, e)) return doMove(m, e); }
      return false;
    }
    function lost(m) {
      var tg = enemyOf(m);
      if (m !== hero && tg) {   // can't get to him: point at him now and then, otherwise look about or taunt
        m.dir = tg.x >= m.x ? 1 : -1; m.vx = 0;
        if (now - (m.pointAt || -9) > 4.5) { m.pointAt = now; begin(m, 'point'); }
        else if (Math.random() < 0.25) begin(m, 'taunt');
        else if (Math.random() < 0.5) { begin(m, 'look'); }
        else { m.st = 'walk'; m.vx = (Math.random() < 0.5 ? 1 : -1) * 50; }
        return;
      }
      if (Math.random() < 0.5) { begin(m, 'look'); m.vx = 0; } else { m.st = 'walk'; m.vx = m.dir * 70; }
    }
    // ---- the ninja's grappling hook: a rope to the edge of the enemy's floor when he cannot climb there
    function ropeClear(x0, y0, x1, y1, b, from) {
      for (var k = 1; k < 14; k++) {
        var t = k / 14, px = x0 + (x1 - x0) * t, py = y0 + (y1 - y0) * t;
        for (var i = 0; i < boxes.length; i++) { var q = boxes[i]; if ((b && q.el === b.el) || (from && q.el === from.el)) continue; if (px > q.x0 && px < q.x1 && py > q.y0 && py < q.y1) return false; }
      }
      return true;
    }
    function ropeMax() { return Math.max(200, H - 2 * M); }
    function hookTo(m, b, tg) {
      if (m !== hero || !m.on || !b || b.ground || (m.hookCd || 0) > now || nearBlock(m.x, m.y)) return false;
      var rise = m.y - b.y; if (rise < 60 || rise > ropeMax()) return false;
      var xs = m.x >= b.x0 + 8 && m.x <= b.x1 - 8 ? [m.x] : [];        // straight above me, else the nearer edge of his floor
      xs.push(b.x0 + 4, b.x1 - 4);
      xs.sort(function (a, c) { return Math.abs(a - m.x) - Math.abs(c - m.x); });
      for (var i = 0; i < xs.length; i++) {
        var ax = cl(xs[i], M + 4, W - M - 4), lean = Math.abs(ax - m.x);
        if (lean > rise * 1.1 + 80 || nearBlock(ax, b.y) || !ropeClear(m.x, m.y - 34, ax, b.y, b, m.on)) continue;
        var side = ax <= b.x0 + 6 ? 1 : ax >= b.x1 - 6 ? -1 : (tg && tg.x < ax ? -1 : 1);
        var hy = b.y + HANG, len = Math.hypot(ax - m.x, hy - m.y), face = ax >= m.x ? 1 : -1;
        m.dir = face; m.hookCd = now + 8;
        runSeq(m, [
          { p: 'hookaim', d: 0.45, x0: m.x, y0: m.y, x1: m.x, y1: m.y, face: face },
          { p: 'hookfire', d: 0.16 + rise / 1600, x0: m.x, y0: m.y, x1: m.x, y1: m.y, face: face },
          { p: 'rope', d: Math.max(0.35, len / (len > 260 ? 520 : 260)), x0: m.x, y0: m.y, x1: ax, y1: hy, face: face },
          { p: 'hang', d: 0.08, x0: ax, y0: hy, x1: ax, y1: hy },
          { p: 'pull', d: 0.36, x0: ax, y0: hy, x1: cl(ax + side * 12, b.x0 + 4, b.x1 - 4), y1: b.y, face: side }
        ], { land: b });
        m.rope = { ax: ax, ay: b.y };
        return true;
      }
      return false;
    }
    function rappel(m, tg) {
      if (m !== hero || !m.on || m.on.ground) return false;
      var b = tg.on, G2 = plats[plats.length - 1];
      var edgesX = [m.on.x0, m.on.x1].sort(function (a, c) { return Math.abs(a - tg.x) - Math.abs(c - tg.x); });
      for (var i = 0; i < 2; i++) {
        var ex = edgesX[i], side = ex === m.on.x0 ? -1 : 1, under = b && ex + side * 3 >= b.x0 && ex + side * 3 <= b.x1 && b.y > m.y + 60 ? b : G2;
        if (!under || under.y - m.y < 60 || nearBlock(ex, m.y) || !ropeClear(ex + side * 3, m.y + 10, ex + side * 3, under.y - 10, under, m.on)) continue;
        return doMove(m, { k: 'rappel', s: ex - side * 4, e: ex, side: side, to: idx(under), lx: ex + side * 3 });
      }
      return false;
    }
    // ---- weapons (v13)
    function guns() { return mode !== 'calm'; }
    function brutal(m) { return (m.rage || 0) >= 50; }
    function losTo(m, tg) { return ropeClear(m.x, m.y - 34, tg.x, tg.y - 30, tg.on, m.on); }
    function fireAt(m, tg, hand, p, A) {   // one bullet: a tracer to him (or past him when it misses)
      var J = joints(m, pose(m)), h = J[hand] || J.hF, tx = tg.x, ty = tg.y - 30, ang = Math.atan2(ty - h.y, tx - h.x);
      var mx0 = h.x + Math.cos(ang) * 8, my0 = h.y + Math.sin(ang) * 8;
      fx.push({ k: 'flash', x: mx0, y: my0, t: 0.06, T: 0.06 });
      if (Math.random() < p && !tg.dying && tg.st !== 'flung' && !tg.cho) { fx.push({ k: 'tracer', x: mx0, y: my0, x2: tx, y2: ty, t: 0.08, T: 0.08 }); hurt(m, tg, A); }
      else { var ex = tx + (Math.random() - 0.5) * 50, ey = ty + (Math.random() - 0.5) * 40; fx.push({ k: 'tracer', x: mx0, y: my0, x2: ex, y2: ey, t: 0.08, T: 0.08 }); spark(ex, ey, 3, '#fde68a'); }
    }
    function snipeSpot(m, tg) {   // a place on my ledge with a clear line to his head
      if (!m.on) return null;
      var best = null, bd = 1e9;
      for (var x = m.on.x0 + 8; x <= m.on.x1 - 8; x += 18) {
        if (!ropeClear(x, m.y - 30, tg.x, tg.y - 44, tg.on, m.on) || nearBlock(x, m.y)) continue;
        var d = Math.abs(x - m.x); if (d < bd) { bd = d; best = x; }
      }
      return best;
    }
    function startSnipe(m, tg) { m.dir = tg.x >= m.x ? 1 : -1; m.vx = 0; begin(m, 'snipe'); m.gunAt = tg; m.lastSnipeK = kills; m.rangedCd = now + 4; }
    function ranged(m, tg) {   // the weapon for the distance (and his mood); true when he started something
      if (m !== hero || !m.on || !tg || !tg.on || tg.dying || tg.cho || m.cho || (m.rangedCd || 0) > now || nearBlock(m.x, m.y)) return false;
      var d = Math.hypot(tg.x - m.x, tg.y - m.y), dy = m.y - tg.y, rag = brutal(m);
      // the sniper: far away or high above, at most one kill in five
      if (guns() && can('sniper') && (d > 450 || dy > 150) && kills - (m.lastSnipeK === undefined ? -99 : m.lastSnipeK) >= 4) {
        if (ropeClear(m.x, m.y - 30, tg.x, tg.y - 44, tg.on, m.on)) { startSnipe(m, tg); return true; }
        var sx = snipeSpot(m, tg);
        if (sx !== null) { m.snipeAt = sx; m.snipeFor = tg; m.st = 'run'; m.dir = sx > m.x ? 1 : -1; m.vx = m.dir * RUN; return true; }
      }
      var los = losTo(m, tg);
      if (!los) return false;
      if (guns() && can('rifle') && rag && d > 380 && Math.abs(dy) < 90 && Math.random() < 0.6) { m.dir = tg.x >= m.x ? 1 : -1; m.vx = 0; begin(m, 'rifle'); m.gunAt = tg; m.shots = 3; m.nextShot = 0; m.rangedCd = now + 3.5; return true; }
      if (guns() && can('pistols') && d > 140 && d < 420 && (rag || Math.random() < 0.3)) { m.dir = tg.x >= m.x ? 1 : -1; m.vx = 0; begin(m, 'shoot'); m.gunAt = tg; m.shots = 4 + Math.floor(Math.random() * 3); m.nextShot = 0; m.rangedCd = now + 3; return true; }
      if (d > 150 && d < 460 && Math.random() < 0.35) { m.dir = tg.x >= m.x ? 1 : -1; m.vx = 0; begin(m, 'aim'); m.cd = 1.1; m.rangedCd = now + 3; return true; }   // the bow
      m.rangedCd = now + 1.2;
      return false;
    }
    function headshot(m, tg) {   // the sniper's one sure shot
      var dir = tg.x >= m.x ? 1 : -1, hx = tg.x, hy = tg.y - 44;
      if (blood) {
        fx.push({ k: 'head', x: hx, y: hy, vx: dir * (120 + Math.random() * 90), vy: -260 - Math.random() * 80, t: 2.6, T: 2.6, team: tg.team, z: tg.sz || 1 });
        bleed(hx, hy, dir, 18);
      } else { fx.push({ k: 'hat', x: hx, y: hy - 4, vx: dir * 160, vy: -240, t: 1.4, T: 1.4 }); spark(hx, hy, 10, '#fde68a'); }
      freeze(0.1); slowT = Math.max(slowT, 0.5); shake(4);
      tg.hp = 0; tg.cho = 0; fling(tg, dir * 160, -120);
      if (blood && tg.rag) { tg.rag.headless = 1; tg.rag.fountain = 0.9; }
      setTimeout(function () { tg.dying = 1; }, 60);
    }
    function ropePull(m, tg) {   // a rope arrow into him, then a pull - he comes flying to the ninja's fist
      m.hookCd = now + 6; m.dir = tg.x >= m.x ? 1 : -1;
      runSeq(m, [{ p: 'hookaim', d: 0.35, x0: m.x, y0: m.y, x1: m.x, y1: m.y, face: m.dir },
                 { p: 'hookfire', d: 0.12 + Math.abs(tg.x - m.x) / 1800, x0: m.x, y0: m.y, x1: m.x, y1: m.y, face: m.dir }], { land: m.on, yank: tg });
      m.rope = { ax: tg.x, ay: tg.y - 28, live: tg };
    }
    // no way to climb to him: the best object above to fire the rope at - his floor, or one that leads on to it
    function hookPlan(m, tg) {
      if (m !== hero || !m.on || !tg || !tg.on || (m.hookCd || 0) > now) return false;
      var ti = idx(tg.on), max = ropeMax();
      var c = plats.filter(function (p) { var r = m.y - p.y; return !p.ground && p !== m.on && r >= 60 && r <= max; });
      c = c.map(function (p) {
        var cx = cl(m.x, p.x0 + 8, p.x1 - 8), len = Math.hypot(cx - m.x, p.y - m.y), on;
        if (p === tg.on) on = 0; else { var P3 = paths(p, (p.x0 + p.x1) / 2); on = P3 && P3.dist[ti] < 1e9 ? P3.dist[ti] : 50 + Math.hypot((p.x0 + p.x1) / 2 - tg.x, p.y - tg.y) / 60; }
        return { p: p, sc: on + len / 300 };
      }).sort(function (a, b) { return a.sc - b.sc; });
      for (var i = 0; i < Math.min(8, c.length); i++) if (hookTo(m, c[i].p, tg)) return true;
      return false;
    }
    function think(m, dt) {
      m.think -= dt; m.cd = Math.max(0, m.cd - dt);
      if (m === hero) m.sta = Math.min(100, m.sta + (m.st === 'pant' ? 22 : 3) * dt);
      if (!m.on || ['atk', 'hit', 'land', 'flung', 'held', 'dead', 'rise', 'roll', 'aim', 'cho', 'seq', 'slide', 'point', 'smoke', 'yank', 'shoot', 'rifle', 'snipe'].indexOf(m.st) >= 0) return;
      if (m.snipeAt !== undefined && m.snipeAt !== null) {   // on his way to a spot with a clear line
        var sf = m.snipeFor;
        if (!sf || sf.dying || !sf.on || m.st !== 'run') { m.snipeAt = null; }
        else if (Math.abs(m.x - m.snipeAt) < 9) { m.snipeAt = null; startSnipe(m, sf); return; }
        else return;
      }
      if (m.dropTo) { if (m.st !== 'run') m.dropTo = null; else return; }   // (a planned drop runs on past the edge)
      if (nearBlock(m.x, m.y)) { escape(m); return; }
      var tg = enemyOf(m);
      if (m.st === 'block' && m.t < 0.25) return;
      if (m.st === 'block') { begin(m, 'guard'); if (m.counter && tg && Math.abs(tg.x - m.x) < 40) { m.counter = 0; begin(m, 'atk', 'upper'); return; } }
      if ((m.st === 'run' || m.st === 'walk') && ((m.x <= m.on.x0 + 3 && m.vx < 0) || (m.x >= m.on.x1 - 3 && m.vx > 0))) { m.vx = 0; m.st = 'guard'; }   // never walk off an edge by accident
      if (m.think > 0) return;
      m.think = 0.1 + Math.random() * 0.15 * (mode === 'calm' ? 3 : 1);
      if (m !== hero && !m.cho) {   // the two blue men never stand in one spot
        var mate = m === foe ? third : foe;
        if (mate && !mate.dying && !mate.cho && mate.on === m.on && Math.abs(mate.x - m.x) < 24 && (m === third || Math.abs(mate.x - m.x) < 4)) {
          var aw = m.x > mate.x ? 1 : m.x < mate.x ? -1 : (Math.random() < 0.5 ? 1 : -1);
          if (m.x + aw * 30 < m.on.x0 + 4 || m.x + aw * 30 > m.on.x1 - 4) aw = -aw;
          m.st = 'walk'; m.dir = aw; m.vx = aw * 90; return;
        }
      }
      if (m.on.ground && !m.cho) {   // nobody stays at the bottom of the screen: climb back up the boxes
        if (!m.upTo || now - (m.upAt || 0) > 1.5 || idx(m.upTo) < 0) { m.upTo = upFrom(m, tg && !tg.dying ? tg : null); m.upAt = now; }
        if (m.upTo && moveTo(m, m.upTo)) return;
      }
      // no one to fight: wander about the whole page
      if (!tg || tg.st === 'dead' || tg.dying) {
        if (m.trip && m.trip !== m.on && moveTo(m, m.trip)) return;
        if (m === hero && Math.random() < 0.03) { begin(m, 'smoke'); m.intro = 2.5 + Math.random() * 2; m.vx = 0; return; }
        m.trip = null; m.roamT -= 0.25; if (m.roamT <= 0) { m.roamT = 1.5 + Math.random() * 2.5; roam(m); } else if (Math.random() < 0.08) begin(m, Math.random() < 0.5 ? 'taunt' : 'look'); return;
      }
      if (m !== hero && tg === hero && !m.cho) {
        var was = m.aware && now - m.aware <= 6;
        if (Math.hypot(tg.x - m.x, tg.y - m.y) < (was ? 380 : 170) || (m.hp < (m.hp0 || 70))) m.aware = now;   // busy smashing he hardly looks up
        m.hp0 = m.hp;
        var is = m.aware && now - m.aware <= 6;
        if (is && !was) {   // he noticed (or was hit): a shout, and his mate comes too
          m.alarmAt = now; var mate = m === foe ? third : foe;
          if (mate && !mate.dying && !(mate.aware && now - mate.aware <= 6)) { mate.aware = now; mate.alarmAt = now; mate.trip = null; }
        }
        if (!is) { smashAbout(m); return; }
      }
      if (tg.cho && m !== hero && Math.abs(tg.x - m.x) < 80) { m.dir = tg.x >= m.x ? 1 : -1; m.vx = 0; if (m.st !== 'guard' && m.st !== 'taunt') begin(m, Math.random() < 0.3 ? 'taunt' : 'guard'); return; }   // someone else's fight: wait his turn
      var dx = tg.x - m.x, ad = Math.abs(dx), same = tg.on && m.on && (tg.on === m.on || (Math.abs(tg.y - m.y) < 14 && ad < 90)), sc = scene.name;   // next-door tiles at the same height are one fighting ground
      if (m === hero && !(sc === 'retreat') && !(sc === 'pursuit' && scene.runner === hero)) {
        // the ninja's sense, wherever the enemy is: far away he looks about for a few seconds, then he knows and goes
        var dd = Math.hypot(dx, tg.y - m.y);
        if (same || dd < 300) { m.huntSince = 0; m.locked = 0; }
        else if (tg.on) {
          if (!m.huntSince) { m.huntSince = now; m.senseIn = 2 + Math.random() * 3; }
          if (!m.locked && now - m.huntSince > m.senseIn) { m.locked = 1; m.lockAt = now; m.dir = dx >= 0 ? 1 : -1; begin(m, 'guard'); m.vx = 0; return; }
          if (!m.locked) { if (m.st !== 'look' && Math.random() < 0.35) { begin(m, 'look'); m.vx = 0; } else if (m.st !== 'look' && m.st !== 'walk') { m.st = 'walk'; m.vx = (Math.random() < 0.5 ? 1 : -1) * 60; } return; }
          if (now - m.lockAt < 0.5) return;                          // the "!" moment
          if (m.st === 'hide') begin(m, 'guard');
          if (Math.random() < 0.45 && ranged(m, tg)) return;      // far: shoot from here instead of travelling (the sniper when it fits)
          if (goToward(m, tg)) return;
          if (tg.y - m.y > 60 && rappel(m, tg)) return;
          if (m.y - tg.y > 60 && hookPlan(m, tg)) return;
          lost(m); return;
        }
      }
      m.dir = dx >= 0 ? 1 : -1;
      var flee = (sc === 'chase' && m === foe) || (sc === 'retreat' && m === hero) || (sc === 'pursuit' && m === scene.runner);
      if (flee) {
        if (m === hero && m.st === 'pant') { if (m.sta > 88) begin(m, 'guard'); return; }
        if (sc === 'pursuit') { if (ad < 45 && Math.abs(tg.y - m.y) < 20) { setScene('duel', 6); begin(m, 'guard'); m.vx = 0; return; } }   // caught: they fight here
        else if (ad > 330 || (m === hero && ad > 220 && Math.random() < 0.4)) { begin(m, 'pant'); m.vx = 0; return; }        // far enough: catch his breath
        if (m === foe && ad < 50 && Math.random() < 0.25) { setScene('duel', 6); begin(m, 'atk', 'jab'); m.vx = 0; return; } // cornered: turns and fights back
        if (!m.fleeTo || m.fleeTo === m.on || now - (m.fleeAt || 0) > 1.6) { m.fleeTo = farFrom(m, tg); m.fleeAt = now; }
        if (m.fleeTo && moveTo(m, m.fleeTo)) return;
        m.fleeTo = null; m.st = 'run'; m.dir = -m.dir; m.vx = m.dir * 220; return;
      }
      if ((sc === 'chase' && m === hero) || (sc === 'pursuit' && m !== scene.runner)) {
        // the bow: 1 chase in 3, when he is far away
        if (sc === 'chase' && scene.bow && scene.arrows < 3 && ad > 180 && ad < 620 && Math.abs(tg.y - m.y) < 220 && m.cd <= 0 && tg.st !== 'flung') { begin(m, 'aim'); m.vx = 0; m.cd = 1.1; return; }
        if (same) { if (ad < 30) { begin(m, 'atk', attackChoice(m)); m.vx = 0; return; } m.st = 'run'; m.vx = m.dir * 230; return; }
        if (!tg.on) { m.st = 'idle'; m.vx = 0; return; }
        if (!goToward(m, tg)) lost(m);
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
            if ((ad < 150 && tg.on) || scene.t < 0.6) {
              var A0 = tg.on && ad < 150 && Math.abs(tg.y - m.y) < 50 && !nearBlock(tg.x, tg.y) ? planArc(m, cl(tg.x - m.dir * 16, tg.on.x0, tg.on.x1), tg.on.y, tg.on) : null;
              if (A0) { jumpTo(m, tg.x - m.dir * 16, tg.on.y, true, tg.on, A0); m.ambush = 1; } else begin(m, 'guard');
              setScene('duel', 7);
            }
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
          if (r < 0.62 && ad > 200 && goToward(m, hero)) return;
          m.st = 'walk'; m.vx = m.dir * 60; return;
        }
      }
      if (!tg.on) { if (m.st === 'run' || m.st === 'walk') { m.st = 'guard'; m.vx = 0; } return; }   // he is in the air: wait for him to land
      if (same) m.waitT = 0;
      if (!same && m === hero && tg.aware && now - tg.aware < 6 && Math.hypot(dx, tg.y - m.y) < 260 && (sc === 'duel' || sc === 'standoff') && (m.waitT = (m.waitT || 0) + 0.25) < 1.6) { if (m.st !== 'guard') { begin(m, 'guard'); m.vx = 0; } return; }   // he lets the other come to him
      if (!same) { if (!goToward(m, tg)) lost(m); return; }
      // same ledge (or the tile next door: hop over the gap)
      if (tg.on !== m.on && (ad > 34 || Math.abs(tg.y - m.y) > 2)) { if (moveTo(m, tg.on)) return; }
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
      if (m.hookHit && now - m.hookHit < 1.6 && ad > 40 && ad < 170 && can('flykick') && !nearBlock(tg.x, tg.y)) { m.hookHit = 0; var Ah = planArc(m, tg.x - m.dir * 14, tg.y, tg.on, 26); if (Ah) { jumpTo(m, tg.x - m.dir * 14, tg.y, true, tg.on, Ah); m.flykick = 1; return; } }   // straight off the rope into a flying kick
      if (m === hero && ad > 140 && Math.random() < 0.25 && ranged(m, tg)) return;
      if (m === hero && can('slide') && tg.on === m.on && ad > 60 && ad < 130 && Math.random() < 0.08 && !nearBlock(tg.x, tg.y)) { begin(m, 'slide'); m.vx = m.dir * 340; m.tackle = 1; return; }   // slide tackle
      if (m === hero && can('ropepull') && tg.on === m.on && ad > 140 && ad < 420 && (m.hookCd || 0) < now && Math.random() < 0.2 && ropeClear(m.x, m.y - 30, tg.x, tg.y - 28, null, m.on)) { ropePull(m, tg); return; }
      if (ad > 90 && ad < 150 && Math.random() < 0.06 && (m !== hero || can('flykick')) && !nearBlock(tg.x, tg.y)) { var A1 = planArc(m, tg.x - m.dir * 14, tg.y, tg.on, 22); if (A1) { jumpTo(m, tg.x - m.dir * 14, tg.y, false, tg.on, A1); m.flykick = 1; return; } }
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
        if (m.groundT > 0.35 && free2(m)) { m.groundT = 0; if (!goToward(m, tg)) lost(m); }   // at the bottom: climb back up the boxes
      } else m.groundT = 0;
      if (!tg || !tg.on || !m.on || tg.on === m.on || m.st === 'hide' || m.goHide) { m.stuckT = 0; m.bestD = 1e9; return; }
      var d = Math.hypot(tg.x - m.x, tg.y - m.y);
      if (d < (m.bestD || 1e9) - 25) { m.bestD = d; m.stuckT = 0; } else m.stuckT = (m.stuckT || 0) + dt;
      if (m.stuckT > 3.5) { m.bestD = 1e9; m.stuckT = 0; if (m.on && !goToward(m, tg)) { begin(m, 'look'); m.vx = 0; } }
    }
    function step(m, dt) {
      if (!m) return;
      if (m.st === 'cho') { m.t += dt; m.flash = Math.max(0, m.flash - dt); stepCho(m, dt); return; }
      if (m.st === 'seq') { m.t += dt; m.flash = Math.max(0, m.flash - dt); stepSeq(m, dt); return; }
      if (m.st === 'yank') {   // pulled across by the rope arrow
        m.t += dt; var yk = Math.min(1, m.t / 0.35); m.x = m.yank.x0 + (m.yank.x1 - m.yank.x0) * ease(yk); if (hero) m.dir = hero.x >= m.x ? 1 : -1;
        if (yk >= 1) { begin(m, 'hit'); if (hero && hero.on === m.on && free2(hero)) { hero.dir = m.x >= hero.x ? 1 : -1; begin(hero, 'atk', 'upper'); } }
        return;
      }
      watchStuck(m, dt);
      m.t += dt; m.flash = Math.max(0, m.flash - dt); m.ph += dt * (m.st === 'run' ? Math.max(9, Math.abs(m.vx) / 16) : m.st === 'walk' ? Math.max(4, Math.abs(m.vx) / 9) : 3);
      think(m, dt);
      if (m.st === 'seq') return;                                  // a climb or drop just started: it moves itself
      if (m.st === 'run' && Math.abs(m.vx) > 30) m.dir = m.vx > 0 ? 1 : -1;
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
        if (m.smashing && !m.done && m.t >= A.hit) { m.done = 1; m.smashing = 0; crack(m, A); }
        if (!m.done && m.t >= A.hit && m.t <= A.hit + A.act && tg && tg.st !== 'dead' && !tg.cho) {
          var f = (tg.x - m.x) * m.dir;
          if (f > -6 && f < A.reach + 8 && Math.abs(tg.y - m.y) < (A.low ? 12 : 36)) {
            m.done = 1;
            if (A.grab) {
              var Ag = tg === hero && m.on ? planArc(hero, cl(m.x - hero.dir * 50, m.on.x0 + 4, m.on.x1 - 4), m.on.y, m.on, 55) : null;
              if (tg === hero && Math.random() < 0.95 && Ag) { jumpTo(hero, cl(m.x - hero.dir * 50, m.on.x0 + 4, m.on.x1 - 4), m.on.y, true, m.on, Ag); hero.ambush = 1; }
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
      } else if (m.st === 'roll') { m.vx = m.dir * 70; if (m.t > 0.35) begin(m, 'guard'); }
      else if (m.st === 'shoot' || m.st === 'rifle') {   // two pistols (alternate hands), or a rifle burst after a short aim
        m.vx = 0; var gt = m.gunAt;
        if (!gt || gt.dying || gt.st === 'flung') { if (m.t > 0.3) begin(m, 'guard'); }
        else {
          m.dir = gt.x >= m.x ? 1 : -1; m.nextShot -= dt;
          var rifle = m.st === 'rifle';
          if (m.t > (rifle ? 0.45 : 0.22) && m.shots > 0 && m.nextShot <= 0) {
            m.nextShot = rifle ? 0.09 : 0.13; m.shots--;
            fireAt(m, gt, rifle ? 'hF' : (m.shots % 2 ? 'hB' : 'hF'), rifle ? 0.8 : 0.7, rifle ? { dmg: 10, kb: 200, up: 0 } : { dmg: 7, kb: 110, up: 0 });
          }
          if (m.shots <= 0 && m.nextShot <= 0 && m.t > 0.5) begin(m, 'guard');
        }
      }
      else if (m.st === 'snipe') {   // kneel, the red line settles on his head, one shot
        m.vx = 0; var sg = m.gunAt;
        if (!sg || sg.dying) { if (m.t > 0.3) begin(m, 'guard'); }
        else {
          m.dir = sg.x >= m.x ? 1 : -1;
          if (m.t >= 1.3 && !m.done) {
            m.done = 1;
            var Js = joints(m, P.kneel), sa = Math.atan2(sg.y - 44 - Js.hF.y, sg.x - Js.hF.x), smx = Js.hF.x + Math.cos(sa) * 30, smy = Js.hF.y + Math.sin(sa) * 30;
            fx.push({ k: 'flash', x: smx, y: smy, t: 0.08, T: 0.08 }); fx.push({ k: 'tracer', x: smx, y: smy, x2: sg.x, y2: sg.y - 44, t: 0.12, T: 0.12 });
            headshot(m, sg);
          }
          if (m.t > 1.8) begin(m, 'guard');
        }
      }
      else if (m.st === 'slide') {
        if (m.tackle && tg && tg.on === m.on && Math.abs(tg.x - m.x) < 18 && !tg.cho && tg.st !== 'flung') { m.tackle = 0; hurt(m, tg, { dmg: 10, kb: 160, up: 360 }); }
        if (m.t > (m.tackle ? 0.5 : 0.3)) { m.tackle = 0; begin(m, 'guard'); }
      }
      else if (m.st === 'smoke') {
        m.vx = 0; m.smokeT = (m.smokeT || 0) - dt;
        if (m.smokeT <= 0) { m.smokeT = 0.45 + Math.random() * 0.4; var J0 = joints(m, P.smoke); fx.push({ k: 'smoke', x: J0.head.x + m.dir * 5, y: J0.head.y + 2, vx: m.dir * 8, vy: -22, t: 1.1, T: 1.1, r: 2, c: 'rgba(203,213,225,.55)' }); }
        m.intro -= dt;
        if (m.intro <= 0) {   // flicks the cigarette away and goes to work
          var J1 = joints(m, P.smoke); fx.push({ k: 'butt', x: J1.hF.x, y: J1.hF.y, vx: m.dir * 90, vy: -120, t: 1, T: 1 });
          begin(m, 'guard'); if (m === hero) { m.locked = 1; m.lockAt = now; m.huntSince = now; }
        }
      }
      else if (m.st === 'point') { m.vx = 0; if (tg) m.dir = tg.x >= m.x ? 1 : -1; if (m.t > 0.9) begin(m, Math.random() < 0.4 ? 'taunt' : 'guard'); }
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
            var fast = m.vy > 640, skid = !fast && m.st === 'air' && Math.abs(m.vx) > 250 && p.x1 - p.x0 > 50;
            m.aim = null; m.vault = 0; m.y = p.y; m.on = p; m.x = Math.max(p.x0, Math.min(p.x1, m.x)); m.vy = 0; m.vx *= skid ? 0.7 : 0.08; m.flip = 0; m.spin = 0; m.lastLand = now; dust(m.x, p.y, skid ? 9 : 6);
            if (m.big) { m.big = 0; shake(6); dust(m.x, p.y, 16); fx.push({ k: 'shock', x: m.x, y: p.y - 4, t: 0.3, T: 0.3 }); }
            if (m.st === 'flung') { m.down = 1; begin(m, 'land'); } else if (fast && p.x1 - p.x0 > 60) { if (Math.abs(m.vx) > 5) m.dir = m.vx > 0 ? 1 : -1; begin(m, 'roll'); } else if (skid) begin(m, 'slide'); else begin(m, 'land');
            break;
          }
        }
        if (m.x < M || m.x > W - M) { m.vx = -m.vx * 0.5; m.x = Math.max(M, Math.min(W - M, m.x)); }
        if (m.y > H - M + 4) { m.y = H - M; m.on = plats[plats.length - 1]; m.vy = 0; begin(m, 'land'); }
      } else {
        m.x += m.vx * dt;
        if (m.act && m.st === 'run' && Math.abs(m.x - m.act.s) < 12 && (m.act.s - m.x) * m.dir <= 4) {   // at the take-off point
          var ea = m.act, pb = m.actP; m.x = cl(ea.s, m.on.x0, m.on.x1);
          if (pb && idx(pb) >= 0) { execMove(m, ea, pb); return; } m.act = null;
        }
        if (m.x < m.on.x0 - 2 || m.x > m.on.x1 + 2) {
          m.on = null; if (['run', 'idle', 'hit', 'walk', 'guard', 'roll', 'slide'].indexOf(m.st) >= 0) begin(m, 'air');
          if (m.dropTo) { m.aim = m.dropTo; m.dropTo = null; m.vx = m.dir * 110; }
        }
        if (m.st === 'slide') m.vx *= Math.pow(m.tackle ? 0.3 : 0.04, dt);
        else if (m.st !== 'run' && m.st !== 'atk' && m.st !== 'walk' && m.st !== 'roll') m.vx *= Math.pow(0.002, dt);
      }
      if (m.dying && m.st !== 'held') { m.dying = 0; die(m); }
    }

    // ---- drawing (no outline: the ninja yellow, the others blue)
    function pose(m) {
      if (m.st === 'cho') return choPose(m);
      if (m.st === 'seq') {
        var sq = m.seq && m.seq[m.seqI], kq = sq ? Math.min(1, m.seqT / sq.d) : 1, sw = Math.sin(now * 7) * 4;
        if (!sq) return P.land;
        if (sq.p === 'hang') { var hq = {}; for (var kk in P.hang) hq[kk] = P.hang[kk]; hq.hF += sw; hq.hB += sw; return hq; }
        if (sq.p === 'pull') return kq < 0.5 ? mix(P.hang, P.vault, ease(kq / 0.5)) : mix(P.vault, P.land, ease((kq - 0.5) / 0.5));
        if (sq.p === 'lower') return mix(P.land, P.hang, ease(kq));
        if (sq.p === 'hookaim' || sq.p === 'hookfire') return sq.p === 'hookaim' ? mix(P.guard, P.bowup, ease(Math.min(1, kq * 2))) : P.bowup;
        if (sq.p === 'rope') { var ra = Math.sin(m.seqT * 14); return { L: -2, hy: 20, sF: 168 + ra * 12, eF: 8, sB: 168 - ra * 12, eB: 8, hF: 45 + ra * 10, kF: -70, hB: 25 - ra * 10, kB: -80 }; }   // hand over hand, legs round the rope
        if (sq.p === 'wall') { var sr = Math.sin(m.ph); return { L: 18, hy: 18, sF: 120 - sr * 50, eF: 40, sB: 120 + sr * 50, eB: 40, hF: 40 + 45 * sr, kF: -60 - 40 * Math.max(0, -sr), hB: 40 - 45 * sr, kB: -60 - 40 * Math.max(0, sr) }; }
        return kq < 0.6 ? mix(P.air, P.hang, ease(kq / 0.6)) : P.hang;   // the jump up to the edge, arms reaching
      }
      if (m.st === 'slide') return P.slide;
      if (m.st === 'point') return mix(P.guard, P.point, ease(Math.min(1, m.t / 0.2)));
      if (m.st === 'smoke') { var sm = {}; for (var ks in P.smoke) sm[ks] = P.smoke[ks]; var drag = Math.sin(now * 1.3) > 0.7 ? 1 : 0; sm.eF += drag * 8; return sm; }
      if (m.st === 'yank') return P.hurt;
      if (m.st === 'shoot') return mix(P.guard, P.pistols, ease(Math.min(1, m.t / 0.18)));
      if (m.st === 'rifle') return mix(P.guard, P.rifle, ease(Math.min(1, m.t / 0.25)));
      if (m.st === 'snipe') return mix(P.guard, P.kneel, ease(Math.min(1, m.t / 0.3)));
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
      var col = flash ? (dark() ? '#ffffff' : '#f87171') : colorOf(team);   // a hit flashes: white on dark pages, red on light ones (white would vanish)
      ctx.strokeStyle = col; ctx.lineWidth = 3.4 * (J.z || 1);
      [['neck', 'hip'], ['neck', 'eB'], ['eB', 'hB'], ['hip', 'kB'], ['kB', 'fB'], ['hip', 'kF'], ['kF', 'fF'], ['neck', 'eF'], ['eF', 'hF']].forEach(function (l) { ctx.beginPath(); ctx.moveTo(J[l[0]].x, J[l[0]].y); ctx.lineTo(J[l[1]].x, J[l[1]].y); ctx.stroke(); });
      if (!J.noHead) { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(J.head.x, J.head.y, 5.8 * (J.z || 1), 0, 7); ctx.fill(); }
      ctx.restore();
    }
    function drawFighter(m) {
      if (m.st === 'flung' && m.rag) { var JR = {}; for (var kk in m.rag.pts) JR[kk] = m.rag.pts[kk]; JR.noHead = m.rag.headless; drawMan(JR, m.team, m.flash > 0, null, 0); return; }
      var p = pose(m), J = joints(m, p), ang = (m.flip || m.st === 'flung') ? -m.spin * m.dir : 0;
      if (m.st === 'roll') { ang = (m.t / 0.35) * Math.PI * 2 * m.dir; J = joints(m, P.land); }
      if (m.st === 'seq' && m.seq && m.seq[m.seqI] && m.seq[m.seqI].p === 'wall') ang = -m.dir * 0.5;   // feet on the wall, leaning back
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
      if (m.rope && m.rope.live) { m.rope.ax = m.rope.live.x; m.rope.ay = m.rope.live.y - 28; }
      if (m.rope && m.st === 'seq' && m.seq && m.seq[m.seqI] && (m.seq[m.seqI].p === 'hookaim' || m.seq[m.seqI].p === 'hookfire')) {   // the bow, aimed at the edge (or at him)
        var bq = m.seq[m.seqI], bh = J.hF, bang = Math.atan2(m.rope.ay - bh.y, m.rope.ax - bh.x), pull2 = bq.p === 'hookaim' ? Math.min(1, m.seqT / (bq.d * 0.8)) : 0;
        var bcx = bh.x - Math.cos(bang) * 4, bcy = bh.y - Math.sin(bang) * 4;
        ctx.save(); ctx.strokeStyle = '#8b6a3e'; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.arc(bcx, bcy, 11, bang - 1.2, bang + 1.2); ctx.stroke();
        var e1x = bcx + Math.cos(bang - 1.2) * 11, e1y = bcy + Math.sin(bang - 1.2) * 11, e2x = bcx + Math.cos(bang + 1.2) * 11, e2y = bcy + Math.sin(bang + 1.2) * 11;
        var nkx = bcx + Math.cos(bang) * (4 - 12 * pull2), nky = bcy + Math.sin(bang) * (4 - 12 * pull2);
        ctx.strokeStyle = 'rgba(229,231,235,.85)'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(e1x, e1y); ctx.lineTo(nkx, nky); ctx.lineTo(e2x, e2y); ctx.stroke();
        if (bq.p === 'hookaim') { ctx.strokeStyle = dark() ? '#e5e7eb' : '#475569'; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(nkx, nky); ctx.lineTo(bcx + Math.cos(bang) * 13, bcy + Math.sin(bang) * 13); ctx.stroke(); }
        ctx.restore();
      }
      if (m.rope && m.st === 'seq' && m.seq && m.seq[m.seqI]) {
        var rq = m.seq[m.seqI], hand = J.hF, tipx = m.rope.ax, tipy = m.rope.ay;
        if (rq.p === 'hookaim') tipx = null;
        else if (rq.p === 'hookfire') {   // the arrow flies with the rope behind it
          var kf = Math.min(1, m.seqT / rq.d); tipx = hand.x + (m.rope.ax - hand.x) * kf; tipy = hand.y + (m.rope.ay - hand.y) * kf;
          var aang = Math.atan2(m.rope.ay - hand.y, m.rope.ax - hand.x);
          ctx.save(); ctx.strokeStyle = dark() ? '#e5e7eb' : '#475569'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(tipx, tipy); ctx.lineTo(tipx - Math.cos(aang) * 12, tipy - Math.sin(aang) * 12); ctx.stroke(); ctx.restore();
        }
        if (tipx !== null && !(rq.p === 'pull' && m.seqT > rq.d * 0.6)) {
          ctx.save(); ctx.strokeStyle = dark() ? '#c4b59a' : '#8b6a3e'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(hand.x, hand.y); ctx.lineTo(tipx, tipy); ctx.stroke();
          ctx.strokeStyle = dark() ? '#e5e7eb' : '#475569'; ctx.lineWidth = 1.6;          // the hook: three claws over the edge
          [-0.9, 0, 0.9].forEach(function (a2) { ctx.beginPath(); ctx.moveTo(tipx, tipy); ctx.lineTo(tipx + Math.sin(a2) * 5, tipy - 3 + Math.cos(a2) * 2); ctx.stroke(); });
          ctx.restore();
          if (rq.p === 'hookfire' && m.seqT + 0.03 >= rq.d && !m.rope.clank) { m.rope.clank = 1; spark(m.rope.ax, m.rope.ay, 5, '#fde68a'); }
        }
      }
      if (m.pulling && m.pulling.st === 'yank') {   // the rope still on him while he is pulled across
        var pt2 = m.pulling; ctx.save(); ctx.strokeStyle = dark() ? '#c4b59a' : '#8b6a3e'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(J.hF.x, J.hF.y); ctx.lineTo(pt2.x, pt2.y - 28); ctx.stroke(); ctx.restore();
      } else if (m.pulling) m.pulling = null;
      drawMan(J, m.team, m.flash > 0, c, ang, alpha);
      drawWeapon(m, J);
      if (m.st === 'smoke') {   // the cigarette and its ember
        var ch = J.hF, ce = Math.sin(now * 1.3) > 0.7 ? '#fb923c' : '#ea580c';
        ctx.save(); ctx.strokeStyle = '#f8fafc'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(ch.x, ch.y); ctx.lineTo(ch.x + m.dir * 5, ch.y - 1); ctx.stroke();
        ctx.fillStyle = ce; ctx.beginPath(); ctx.arc(ch.x + m.dir * 5.6, ch.y - 1.1, 1.2, 0, 7); ctx.fill(); ctx.restore();
      }
      if (m.team !== 'hero' && m.alarmAt && now - m.alarmAt < 0.9) { ctx.font = '800 14px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#ef4444'; ctx.fillText('!', J.head.x, J.head.y - 11); }
      if (m.team === 'hero' && m.lockAt && now - m.lockAt < 0.8 && m.st !== 'seq') { ctx.font = '800 14px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = dark() ? '#fde68a' : '#d97706'; ctx.fillText('!', J.head.x, J.head.y - 11); }
      if (m.st === 'seq' && m.seq && m.seq[m.seqI] && m.seq[m.seqI].p === 'hookaim') { ctx.font = '800 13px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = dark() ? '#fde68a' : '#d97706'; ctx.fillText('!', J.head.x, J.head.y - 11); }
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
    function drawRag(r) { var a = r.t > 3 ? Math.max(0, 1 - (r.t - 3)) : 1, J = {}; for (var k in r.pts) J[k] = r.pts[k]; J.noHead = r.headless; drawMan(J, r.team, false, null, 0, a); }
    function drawWeapon(m, J) {
      var steel = dark() ? '#e5e7eb' : '#475569', gun = dark() ? '#cbd5e1' : '#1f2937', tg = m.gunAt;
      ctx.save(); ctx.lineCap = 'round';
      // the katana: in his hand while he is angry (and has learnt it)
      if (m === hero && brutal(m) && can('katana') && ['guard', 'atk', 'run', 'walk', 'idle', 'land', 'hit', 'block'].indexOf(m.st) >= 0) {
        var vx = J.hF.x - J.eF.x, vy = J.hF.y - J.eF.y, L2 = Math.hypot(vx, vy) || 1; vx /= L2; vy /= L2;
        var bx = J.hF.x + vx * 22, by = J.hF.y + vy * 22;
        ctx.strokeStyle = '#7c2d12'; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.moveTo(J.hF.x - vx * 3, J.hF.y - vy * 3); ctx.lineTo(J.hF.x + vx * 3, J.hF.y + vy * 3); ctx.stroke();
        ctx.strokeStyle = steel; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(J.hF.x + vx * 3, J.hF.y + vy * 3); ctx.lineTo(bx, by); ctx.stroke();
        if (m.st === 'atk' && ATK[m.atk] && ATK[m.atk].blade && m.t < ATK[m.atk].hit + ATK[m.atk].act + 0.05) {   // the bright arc of the swing
          m.btrail = (m.btrail || []).concat([{ x: bx, y: by }]).slice(-7);
          ctx.strokeStyle = 'rgba(255,255,255,.65)'; ctx.lineWidth = 2.4; ctx.beginPath(); m.btrail.forEach(function (q, i) { if (i) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y); }); ctx.stroke();
        } else m.btrail = null;
      }
      if (m.st === 'shoot') {   // two pistols
        ctx.strokeStyle = gun; ctx.lineWidth = 2.6;
        [J.hF, J.hB].forEach(function (h) { ctx.beginPath(); ctx.moveTo(h.x, h.y); ctx.lineTo(h.x + m.dir * 6, h.y - 0.5); ctx.stroke(); ctx.beginPath(); ctx.moveTo(h.x, h.y); ctx.lineTo(h.x - m.dir * 0.5, h.y + 3); ctx.stroke(); });
      }
      if ((m.st === 'rifle' || m.st === 'snipe') && tg) {   // the rifle (the sniper's is longer, with a scope), pointed at him
        var sn = m.st === 'snipe', ty = tg.y - (sn ? 44 : 30), a = Math.atan2(ty - J.hF.y, tg.x - J.hF.x), len = sn ? 30 : 24, cs = Math.cos(a), sn2 = Math.sin(a);
        ctx.strokeStyle = gun; ctx.lineWidth = sn ? 2 : 2.6; ctx.beginPath(); ctx.moveTo(J.hF.x - cs * 10, J.hF.y - sn2 * 10); ctx.lineTo(J.hF.x + cs * len, J.hF.y + sn2 * len); ctx.stroke();
        if (sn) {
          ctx.lineWidth = 2.6; ctx.beginPath(); ctx.moveTo(J.hF.x + cs * 2 - sn2 * 3, J.hF.y + sn2 * 2 + cs * -3); ctx.lineTo(J.hF.x + cs * 10 - sn2 * 3, J.hF.y + sn2 * 10 + cs * -3); ctx.stroke();
          if (m.t > 0.3 && m.t < 1.3) {   // the red line settling on his head
            var k = Math.min(1, (m.t - 0.3) / 0.8), err = (1 - k) * 0.22 * Math.sin(m.t * 9), la = a + err, far = Math.hypot(tg.x - J.hF.x, ty - J.hF.y);
            ctx.strokeStyle = 'rgba(239,68,68,.65)'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(J.hF.x + cs * len, J.hF.y + sn2 * len); ctx.lineTo(J.hF.x + Math.cos(la) * far, J.hF.y + Math.sin(la) * far); ctx.stroke();
            ctx.fillStyle = '#ef4444'; ctx.beginPath(); ctx.arc(J.hF.x + Math.cos(la) * far, J.hF.y + Math.sin(la) * far, 1.6, 0, 7); ctx.fill();
          }
        }
      }
      ctx.restore();
    }
    function draw() {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
      if (shk > 0) ctx.translate((Math.random() - 0.5) * shk * 2, (Math.random() - 0.5) * shk * 2);
      var dk = dark(), rc = new Map();
      cracks.forEach(function (c) {   // the cracks they kicked into the page (drawn over it, the page is untouched)
        if (!c.el.isConnected) { c.dead = 1; return; }
        var r = rc.get(c.el); if (!r) { r = c.el.getBoundingClientRect(); rc.set(c.el, r); }
        if (!r.width || r.bottom < 0 || r.top > H) return;
        ctx.globalAlpha = (c.mend ? Math.max(0, 1 - c.mend / 1.2) : Math.min(1, c.t * 4)) * 0.6;
        ctx.strokeStyle = dk ? 'rgba(226,232,240,.9)' : 'rgba(30,41,59,.85)'; ctx.lineWidth = 1;
        var ox = r.left + c.rx, oy = r.top + c.ry;
        c.segs.forEach(function (sg) { ctx.beginPath(); ctx.moveTo(ox, oy); sg.forEach(function (p2) { ctx.lineTo(ox + p2[0], oy + p2[1]); }); ctx.stroke(); });
      });
      ctx.globalAlpha = 1;
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
        else if (p.k === 'tracer') { ctx.strokeStyle = 'rgba(253,224,71,.9)'; ctx.lineWidth = 1.1; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x2, p.y2); ctx.stroke(); }
        else if (p.k === 'flash') { ctx.fillStyle = '#fde047'; ctx.beginPath(); ctx.arc(p.x, p.y, 3.2, 0, 7); ctx.fill(); }
        else if (p.k === 'head') { ctx.globalAlpha = Math.min(1, p.t * 2); ctx.fillStyle = colorOf(p.team); ctx.beginPath(); ctx.arc(p.x, p.y, 5.8 * (p.z || 1), 0, 7); ctx.fill(); }
        else if (p.k === 'hat') { ctx.fillStyle = dk ? '#94a3b8' : '#334155'; ctx.beginPath(); ctx.moveTo(p.x - 5, p.y + 2); ctx.lineTo(p.x + 5, p.y + 2); ctx.lineTo(p.x, p.y - 4); ctx.fill(); }
        else if (p.k === 'bit') { ctx.fillStyle = dk ? '#94a3b8' : '#475569'; ctx.fillRect(p.x - 1, p.y - 1, 2.2, 2.2); }
        else if (p.k === 'butt') { ctx.fillStyle = '#f8fafc'; ctx.fillRect(p.x - 1.5, p.y - 0.6, 3, 1.2); ctx.fillStyle = '#fb923c'; ctx.fillRect(p.x + 1.2, p.y - 0.6, 1, 1.2); }
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
      if (m === foe || m === third) { learnt(); mendBy(m); if (hero) hero.rage = Math.max(0, (hero.rage || 0) - 15); }   // a man down lets some anger out
      if (m === foe) { foe = third; third = null; kills++; if (!foe) nextFoeT = 1.6 + Math.random(); else thirdT = 2 + Math.random() * 1.5; }
      else if (m === third) { third = null; kills++; thirdT = 2 + Math.random() * 1.5; }
      m.cho = 0;
    }
    function free3(m) { return m && !m.dying && m.hp > 0 && m.on && !m.cho && ['idle', 'run', 'walk', 'guard', 'taunt', 'land', 'look', 'block', 'hit'].indexOf(m.st) >= 0; }
    function tryCho() {
      if (cho || choCd > 0 || !free3(hero) || ['chase', 'ambush', 'breather', 'retreat', 'pursuit'].indexOf(scene.name) >= 0) return;
      var pl = hero.on, w = pl.x1 - pl.x0; if (w < 90 || pl.ground || nearBlock(hero.x, hero.y)) return;
      var near = function (m, d) { return free3(m) && m.on === pl && Math.abs(m.x - hero.x) < d; };
      var b = near(foe, 110) ? foe : near(third, 110) ? third : null; if (!b) return;
      var c = b === foe ? third : foe;
      if (w >= 120 && near(c, 320)) { startCho(b, c); return; }
      if (c && !c.dying && (c.waitedT = (c.waitedT || 0) + 1) < 90) return;   // give the other man about a second and a half to come
      if (c) c.waitedT = 0;
      startCho(b, null);
    }
    function startCho(b, c) {
      var known = function (L) { return L.map(function (sc, i) { return sc.every(function (bt) { return bt[0] !== 'a' || can(bt[1]); }) ? i : -1; }).filter(function (i) { return i >= 0; }); };
      if (c && !known(SC3).length) c = null;                     // the three-man fights need moves he has not learnt yet
      var pl = hero.on, list = c ? SC3 : SC2, ok2 = known(list), n, key, tries = 0;
      if (!ok2.length) return;
      do { n = ok2[Math.floor(Math.random() * ok2.length)]; key = (c ? 'c' : 'b') + n; } while (ok2.length > 1 && key === lastCho && ++tries < 10);
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
        if (mv.to && M.hit && !mv.done && mv.t >= M.hit) { mv.done = 1; if (!R.early) react(m, mv.to, mv.re, mv.o); else whoosh(m); var al = mv.o && mv.o.also && cho[mv.o.also]; if (al && al.cho) react(m, al, mv.o.alsoRe || mv.re, {}); }
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
      if (!hero || !hero.on) { thirdT = 0.5; return; }
      var x = Math.max(M, Math.min(W - M, hero.x + (Math.random() < 0.5 ? -1 : 1) * (120 + Math.random() * 120)));
      var cand = plats.filter(function (p) { return !p.ground && p.el && p.x1 - p.x0 > 40 && Math.abs((p.x0 + p.x1) / 2 - hero.x) > 220 && (!foe || p !== foe.on) && !nearBlock((p.x0 + p.x1) / 2, p.y); });
      var p = cand.length ? cand[Math.floor(Math.random() * cand.length)] : hero.on;
      var m = make('foe', spot(null, p, hero.x + (x > hero.x ? 50 : -50)), -50, null); m.big = 1;   // drops in from the top
      begin(m, 'air'); m.vx = 0; m.vy = 80; m.aim = p; m.dir = hero.x >= m.x ? 1 : -1;
      third = m;
    }
    function bringFoe() {
      // the next one leaps in from the far side of the screen
      // the next one drops in from the top of the screen, away from the ninja, and has to free-run to him
      var land = plats.filter(function (p) { return !p.ground && p.x1 - p.x0 > 40 && (!hero || Math.abs((p.x0 + p.x1) / 2 - hero.x) > 250) && !nearBlock((p.x0 + p.x1) / 2, p.y); });
      var p = land.length ? land[Math.floor(Math.random() * land.length)] : plats[plats.length - 1];
      var m = make('foe', p.x0 + 10 + Math.random() * Math.max(1, p.x1 - p.x0 - 20), -40, null);
      begin(m, 'air'); m.vx = 0; m.vy = 60; m.aim = p; m.dir = hero && hero.x < m.x ? -1 : 1;
      foe = m; thirdT = 0.7 + Math.random() * 0.6; setScene(Math.random() < 0.6 ? 'standoff' : 'duel', 3 + Math.random() * 2);
    }
    function tick(t) {
      if (!on) return;
      raf = requestAnimationFrame(tick);
      var dt = Math.min(0.05, (t - last) / 1000 || 0); last = t; acc += dt;
      if (acc < 1 / 45) return;
      dt = Math.min(0.05, acc) * 0.7; acc = 0; now += dt;
      if (slowT > 0) { slowT -= dt; dt *= 0.3; }   // slow motion on the big blows
      scanT -= dt; if (scanT <= 0) { scanT = 0.5; scan(); }
      if (!hero) {   // the story opens: the ninja leans on a button, smoking, while they smash the page
        var ok = plats.filter(function (p) { return !p.ground && p.x1 - p.x0 > 40 && !nearBlock((p.x0 + p.x1) / 2, p.y); }); var p = ok.length ? ok[Math.floor(Math.random() * ok.length)] : plats[plats.length - 1];
        hero = make('hero', (p.x0 + p.x1) / 2, p.y, p); begin(hero, 'smoke'); hero.intro = 4 + Math.random() * 1.5; nextFoeT = 0.2; thirdT = 0.6;
      }
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
        if (p.k === 'spark' || p.k === 'sweat' || p.k === 'bit' || p.k === 'butt' || p.k === 'hat') p.vy += 900 * dt;
        if (p.k === 'head') {   // it bounces on the tops and rolls to a stop
          p.vy += G * dt;
          for (var hi = 0; hi < plats.length; hi++) { var hq = plats[hi]; if (p.vy > 0 && p.x >= hq.x0 && p.x <= hq.x1 && p.y + 5 >= hq.y && p.y + 5 - p.vy * dt <= hq.y + 1) { p.y = hq.y - 5; p.vy = -p.vy * 0.35; p.vx *= 0.6; if (Math.abs(p.vy) < 40) p.vy = 0; break; } }
          if (p.x < M) { p.x = M; p.vx = Math.abs(p.vx) * 0.5; } if (p.x > W - M) { p.x = W - M; p.vx = -Math.abs(p.vx) * 0.5; } if (p.y > H - M - 5) { p.y = H - M - 5; p.vy = 0; p.vx *= 0.9; }
        }
      });
      fx = fx.filter(function (p) { return p.t > 0; });
      cracks.forEach(function (c) { c.t += dt; if (c.mend) c.mend += dt; else if (c.t > 3.5) c.mend = 0.001; });
      if (hero) {   // rage: up while fighting close, down when nobody is about; a wave over leaves little of it
        var es2 = [foe, third].filter(function (e) { return e && !e.dying; }), dmin = es2.length ? Math.min.apply(null, es2.map(function (e) { return Math.hypot(e.x - hero.x, e.y - hero.y); })) : 1e9;
        if (dmin < 140) hero.rage = Math.min(100, (hero.rage || 0) + 3 * dt); else if (dmin > 300) hero.rage = Math.max(0, (hero.rage || 0) - 2.5 * dt);
        if (!es2.length && hero.rage > 15) hero.rage *= Math.pow(0.5, dt);
        if (hero.rage >= 50) { hero.bt = (hero.bt || 0) + dt; if (hero.bt > 15) { hero.rage = 30; hero.bt = 0; } } else hero.bt = 0;   // an angry spell lasts a while, then he cools
      }   // a mark fades by itself after a few seconds cracks = cracks.filter(function (c) { return !c.dead && !(c.mend > 1.2); });
      decals.forEach(function (d) { d.t -= dt; }); decals = decals.filter(function (d) { return d.t > 0; }); if (decals.length > 160) decals.splice(0, decals.length - 160);
      draw();
    }
    function onMove(e) { mx = e.clientX; my = e.clientY; mouseT = now; }
    function onLeave() { mx = my = -999; }
    function onScroll() { if (on) scan(); }
    function onResize() { size(); if (on) scan(); }
    var api = {
      start: function () { if (on) return; on = true; cv.style.display = ''; size(); scan(); last = performance.now(); raf = requestAnimationFrame(tick); },
      stop: function () { arrows = []; cracks = []; on = false; cancelAnimationFrame(raf); ctx.clearRect(0, 0, W, H); cv.style.display = 'none'; hero = null; foe = null; third = null; cho = null; slowT = 0; rags = []; fx = []; decals = []; nextFoeT = 1; },
      mode: function (m) { mode = m; },
      blood: function (b) { blood = !!b; if (!blood) decals = []; },
      running: function () { return on; },
      moves: function () { var k = Object.keys(UNLOCK); return { kills: XP, have: 6 + k.filter(can).length, total: 6 + k.length }; },
      _s: function () { return { scene: scene, cho: cho, third: third, arrows: arrows, hero: hero, foe: foe, plats: plats, rags: rags, decals: decals, kills: kills, edges: edges }; }
    };
    document.addEventListener('mousemove', onMove, { passive: true });
    document.addEventListener('mouseleave', onLeave);
    window.addEventListener('scroll', onScroll, { passive: true, capture: true });
    window.addEventListener('resize', onResize);
    size();
    return api;
  };
})();
