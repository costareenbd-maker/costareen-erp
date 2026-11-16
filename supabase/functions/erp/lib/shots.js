// shots-1 (owner 16 Nov 2026): "Realistic AI shots" - the business's own AI plans a reel as a shot list that follows the
// video engine pack (stills first, a start + end still for any change of state, one cause one motion, written physics),
// and this file checks the plan and turns every shot into the prompts the owner pastes into a generator.
//
// Pure functions only (no database), so the tests can drive them directly.
//
//   PROFILES                      oliareen (beauty, ordinary BD women) and costareen (electronics / 3D printers, men): their own
//                                 people, places, voice, colours and scene types. NEVER mixed: the plan's "business" must be
//                                 the profile it was asked for.
//   profileText(key)              the profile as a block for the planner's system prompt
//   validatePlan(plan, o)         the schema (engine pack shot_plan.schema.json) + the hard rules -> list of plain errors
//   factCheck(plan, factsText)    every facts_used line and every number / Latin word in the voice-over must be in the facts
//   stillPrompt / videoPrompt     port of the pack's build_prompt.py (same order, same words)
//   promptPack(plan, pack)        every shot's start still, end still (when there is one) and video prompt
//
// The engine pack's long rules (VIDEO_RULES.md) come from the owner's paid course and this repository is public, so they
// are NOT in the code: they are uploaded once into erp_provider_secrets (VIDEO_PACK, deploy/video_pack_upload.py) and read
// at run time. FALLBACK below is a short version in our own words that keeps the four hard rules when no pack is loaded.

const str = (v) => String(v == null ? '' : v).trim();

export const FALLBACK = {
  version: 'fallback',
  rules: [
    'You plan short realistic AI videos as a list of shots. Facts (names, prices, specs, claims) come ONLY from the facts block; never invent any.',
    'Structure: a hook in the first 2 seconds (never an intro), then the problem, the product, proof, and a natural call to action.',
    'Every shot starts from a STILL image (start_frame) that is made and checked before any video.',
    'A shot that changes state (closed to open, empty to full, before to after, a reveal) needs an end_frame too: the same place, light and camera, only the changed state.',
    'One cause, one motion: one simple action by the subject and one camera move per shot. Hands opening, pouring or assembling are split into shots or shown as the result.',
    'The camera is written in six slots: movement, start, speed, framing, end, time (real time, normal speed, no slow motion).',
    'Heavy objects and machines get a physics line: the exact path, the final position and what must never happen.',
    'Light is a named source with a direction and quality, never "cinematic lighting". Mood is one or two words.',
    'Sound is ambience and effects only, no music and no speech (music and the voice are added in the edit).',
    'Text on screen is added in the edit, never generated. People, faces, clothes and places are Bangladeshi when people appear.',
    'Shots are at most 8 seconds for veo and 15 seconds for the others. The voice-over is separate from the pictures and fits the shot length.',
  ].join('\n'),
  realism: 'Real everyday photo look: candid, natural skin and material texture, true-to-life muted colours, low contrast, a little real-camera imperfection; no retouching, no beauty filter, no film grading, no glossy AI look, no readable text, no logos, no watermark.',
  physics: 'Real weight and real physics: heavy things move slowly because they are heavy, not because the video is slowed down.',
};

export const PROFILES = {
  oliareen: {
    key: 'oliareen', name: 'Oliareen', trade: 'Korean and other skincare / beauty products',
    people: 'ordinary Bangladeshi women aged 20-40 with real brown skin and its real texture (pores, a little unevenness), simple everyday clothes (salwar kameez, kurti, a plain top), no model make-up',
    places: 'a Dhaka flat: a bathroom mirror with a small shelf, a bedroom dressing table, a window with daylight, a balcony; ordinary, tidy, lived-in',
    voice: 'a warm Bangladeshi woman, like an older sister giving honest advice; female voice; simple spoken Bangla',
    colours: 'soft cream #FBF3F0 and berry #AB3C50 (for the text and cards added in the edit)',
    scenes: ['benefit: what the product does for the skin, shown on an ordinary face or hand', 'ingredient: the named ingredient from the facts, close on the bottle or the texture', 'texture: a drop or a swipe on the back of the hand', 'routine step: where it goes in a morning or night routine', 'before / after only with a real result given in the facts (start and end still)'],
    never: 'no medical claims (cures, treats, heals), no invented results or customers, no male presenter, no tech or workshop scenes',
  },
  costareen: {
    key: 'costareen', name: 'Costareen', trade: '3D printers, filament and electronics',
    people: 'ordinary Bangladeshi men aged 18-40 (makers, students, small workshop owners) with real skin, t-shirt or shirt, hands with small marks of work',
    places: 'a small Dhaka workshop or a desk in a room: a shelf of filament spools, a 3D printer on a sturdy table, a soldering mat, a window with daylight',
    voice: 'a calm Bangladeshi man who knows the machines, like a helpful bhai at the shop; male voice; simple spoken Bangla with the English technical words kept',
    colours: 'charcoal #1F2933 and Costareen orange #F26B21 (for the text and cards added in the edit)',
    scenes: ['spec: one number from the facts (speed, size, nozzle, weight) shown by the machine or part doing it', 'feature: one feature shown working, close on the part', 'warranty: the warranty from the facts, the box and the warranty card on the desk', 'unboxing as start and end stills (closed box -> printer standing on the table), never hands opening it in one shot', 'print result: the finished print on the bed (start and end stills)'],
    never: 'no beauty or skincare scenes, no women presenters as the buyer, no invented specs, prices or warranty',
  },
};
export const PROFILE_KEYS = Object.keys(PROFILES);

export function profileText(key) {
  const p = PROFILES[key];
  if (!p) return '';
  return ['# Business profile: ' + p.key + ' (' + p.name + ' - ' + p.trade + ')',
    'People on screen: ' + p.people + '.', 'Places: ' + p.places + '.', 'Voice-over: ' + p.voice + '.', 'Brand colours: ' + p.colours + '.',
    'Scene types to choose from: ' + p.scenes.join('; ') + '.', 'Never: ' + p.never + '.',
    'The plan\'s "business" field must be "' + p.key + '". Never use the other business\'s people, places or scenes.'].join('\n');
}

export const PLATFORMS = { reels: '9:16', shorts: '9:16', tiktok: '9:16', story: '9:16', youtube: '16:9', feed: '4:5', square: '1:1' };
const PURPOSES = ['hook', 'problem', 'product', 'proof', 'broll', 'cta'];
const MODELS = ['veo', 'seedance', 'kling', 'gemini_omni', 'avatar', 'stock'];
const ARS = ['9:16', '16:9', '1:1', '4:5'];
const CAM = ['movement', 'start', 'speed', 'framing', 'end', 'time'];
// a change of state in the action: needs a start AND an end still
const STATE_RE = /\b(open(s|ed|ing)?|unbox\w*|pour\w*|fill\w*|reveal\w*|appl(y|ies|ied|ying)|spread\w*|squeez\w*|remov\w*|peel\w*|pump\w*|assembl\w*|insert\w*|turns? (on|off|into)|switch(es|ed)? on|lights? up|sets? (it )?down|finish\w*|prints? (out|a|the))\b/i;
// a heavy thing moving: needs a physics line
const HEAVY_RE = /\b(printer|machine|box|carton|crate|pallet|spool|forklift|table|monitor|laser|engraver|drum|heavy)\b/i;
const MOVE_RE = /\b(lift\w*|lower\w*|plac\w*|mov\w*|drop\w*|carr\w*|slid\w*|push\w*|pull\w*|roll\w*|set\w* (it )?down|land\w*|tip\w*|fall\w*|swing\w*|rais\w*)\b/i;
// two motions in one action
const MANY_RE = /\b(then|after that|and also|while also)\b/gi;
const MEDICAL_RE = /\b(cure[sd]?|treat(s|ment)?|heal(s|ed)?|medical|guarantee[sd]?)\b|চিকিৎসা|নিরাময়|সারিয়ে|গ্যারান্টি/i;

/** The schema and the hard rules. Returns plain sentences; [] = the plan is good. */
export function validatePlan(plan, o) {
  const opt = o || {}, errs = [];
  const e = (m) => { if (errs.length < 30) errs.push(m); };
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) return ['The AI did not return a plan (JSON object).'];
  for (const k of ['business', 'platform', 'aspect_ratio', 'goal', 'vo', 'shots']) if (plan[k] === undefined || plan[k] === null || plan[k] === '') e('The plan has no "' + k + '".');
  if (plan.business !== undefined && !['personal', 'oliareen', 'costareen'].includes(plan.business)) e('"business" must be personal, oliareen or costareen.');
  if (opt.profile && plan.business && plan.business !== opt.profile) e('The plan is for "' + plan.business + '" but this is ' + opt.profile + ': the two businesses never mix.');
  if (plan.aspect_ratio !== undefined && !ARS.includes(plan.aspect_ratio)) e('"aspect_ratio" must be one of ' + ARS.join(', ') + '.');
  if (opt.aspect && plan.aspect_ratio && plan.aspect_ratio !== opt.aspect) e('The aspect ratio must be ' + opt.aspect + ' for this platform (one ratio per video).');
  if (plan.facts_used !== undefined && !(Array.isArray(plan.facts_used) && plan.facts_used.every((x) => typeof x === 'string'))) e('"facts_used" must be a list of lines.');
  const shots = Array.isArray(plan.shots) ? plan.shots : [];
  if (plan.shots !== undefined && !Array.isArray(plan.shots)) e('"shots" must be a list.');
  if (Array.isArray(plan.shots) && !shots.length) e('The plan has no shots.');
  if (shots.length > 12) e('At most 12 shots.');
  const ns = new Set();
  shots.forEach((s, i) => {
    const L = 'Shot ' + (s && s.n != null ? s.n : i + 1) + ': ';
    if (!s || typeof s !== 'object') { e(L + 'not an object.'); return; }
    for (const k of ['n', 'purpose', 'seconds', 'model', 'start_frame', 'camera', 'action', 'light', 'mood', 'sound']) if (s[k] === undefined || s[k] === null || s[k] === '') e(L + 'no "' + k + '".');
    if (s.n !== undefined && !Number.isInteger(s.n)) e(L + '"n" must be a whole number.');
    if (ns.has(s.n)) e(L + 'the number is used twice.'); ns.add(s.n);
    if (s.purpose !== undefined && !PURPOSES.includes(s.purpose)) e(L + '"purpose" must be one of ' + PURPOSES.join(', ') + '.');
    if (s.model !== undefined && !MODELS.includes(s.model)) e(L + '"model" must be one of ' + MODELS.join(', ') + '.');
    if (s.seconds !== undefined && !(typeof s.seconds === 'number' && s.seconds > 0 && s.seconds <= 15)) e(L + '"seconds" must be a number from 1 to 15.');
    if (s.model === 'veo' && typeof s.seconds === 'number' && s.seconds > 8) e(L + 'a veo shot is at most 8 seconds.');
    for (const k of ['start_frame', 'action', 'light', 'mood', 'sound']) if (s[k] !== undefined && typeof s[k] !== 'string') e(L + '"' + k + '" must be text.');
    for (const k of ['end_frame', 'physics', 'onscreen_text']) if (s[k] !== undefined && s[k] !== null && typeof s[k] !== 'string') e(L + '"' + k + '" must be text or null.');
    const c = s.camera;
    if (c !== undefined && (typeof c !== 'object' || !c)) e(L + '"camera" must have the six slots.');
    else if (c) for (const k of CAM) if (!str(c[k])) e(L + 'the camera has no "' + k + '" slot.');
    const act = str(s.action);
    // the hard rules
    if (act && STATE_RE.test(act) && !str(s.end_frame)) e(L + 'the action changes state ("' + act.slice(0, 60) + '") so it needs an end_frame (start + end still).');
    if (act && ((act.match(MANY_RE) || []).length >= 2 || act.split(/[.;!?]\s+\S/).length > 2)) e(L + 'one cause, one motion: the action has more than one step ("' + act.slice(0, 60) + '"). Split it into shots.');
    if (act && HEAVY_RE.test(act) && MOVE_RE.test(act) && !str(s.physics)) e(L + 'a heavy thing moves, so it needs a physics line (path, final position, what must never happen).');
    if (/cinematic lighting/i.test(str(s.light))) e(L + 'light must be a named source with a direction, not "cinematic lighting".');
    if (/\b(music|song|singing)\b/i.test(str(s.sound)) && !/\bno music\b/i.test(str(s.sound))) e(L + 'the sound line is ambience only: music is added in the edit.');
  });
  const vo = Array.isArray(plan.vo) ? plan.vo : [];
  if (plan.vo !== undefined && !Array.isArray(plan.vo)) e('"vo" must be a list.');
  // pace (engine pack): ~2.5 Bangla / ~4.2 English words a second. The voice-over is kept apart from the pictures, so one
  // line may run into the next shot (up to 1.7x its own shot); the whole voice-over must fit the whole video (+15%).
  const rate = (t) => (/[ঀ-৿]/.test(t) ? 2.5 : 4.2);
  const wordsOf = (t) => str(t).split(/\s+/).filter(Boolean).length;
  const total = shots.reduce((a, x) => a + (x && typeof x.seconds === 'number' ? x.seconds : 0), 0);
  let allWords = 0, allRate = 0;
  vo.forEach((v, i) => {
    if (!v || typeof v !== 'object' || !Number.isInteger(v.shot) || typeof v.text !== 'string') { e('Voice-over line ' + (i + 1) + ' needs "shot" (number) and "text".'); return; }
    if (!ns.has(v.shot)) e('Voice-over line ' + (i + 1) + ' is for shot ' + v.shot + ', which is not in the plan.');
    const s = shots.find((x) => x && x.n === v.shot);
    allWords += wordsOf(v.text); allRate = Math.max(allRate, rate(v.text));
    if (s && typeof s.seconds === 'number') {
      const words = wordsOf(v.text), max = Math.ceil(s.seconds * rate(v.text) * 1.7);
      if (words > max) e('Voice-over for shot ' + v.shot + ' is ' + words + ' words: far too long for ' + s.seconds + ' seconds (at most ~' + max + ').');
    }
    if (opt.profile === 'oliareen' && MEDICAL_RE.test(v.text)) e('Voice-over for shot ' + v.shot + ' makes a medical / guarantee claim: not allowed.');
  });
  const allMax = Math.ceil(total * (allRate || 2.5) * 1.15);
  if (total > 0 && allWords > allMax) e('The whole voice-over is ' + allWords + ' words: it does not fit ' + total + ' seconds (at most ~' + allMax + ').');
  return errs;
}

// ---- the facts check: nothing in the voice-over that is not in the facts
const BN_DIGITS = '০১২৩৪৫৬৭৮৯';
const latinDigits = (t) => String(t || '').replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d)));
const norm = (t) => latinDigits(t).toLowerCase().replace(/[৳,]/g, '').replace(/\s+/g, ' ').trim();
const numbersOf = (t) => (latinDigits(t).replace(/(\d),(?=\d{2,3}\b)/g, '$1').match(/\d+(?:\.\d+)?/g) || []).map((n) => String(Number(n)));
// Latin words in a Bangla or English line that carry a claim: brand names, specs (SPF, PLA, PETG), units
const STOP = new Set(['the', 'and', 'for', 'you', 'your', 'with', 'this', 'that', 'now', 'our', 'are', 'just', 'get', 'buy', 'shop', 'order', 'inbox', 'message', 'link', 'bio', 'today', 'here', 'from', 'all', 'one', 'new', 'more', 'skin', 'face', 'use', 'try', 'see', 'how', 'why', 'what', 'its', 'it\'s', 'can', 'will', 'not', 'has', 'have', 'only', 'every', 'day', 'days', 'night', 'morning', 'website', 'page', 'call', 'dm', 'free', 'taka', 'tk', 'bdt']);
function claimWords(t) {
  return (String(t || '').match(/[A-Za-z][A-Za-z0-9+\-]{1,}/g) || []).map((w) => w.toLowerCase().replace(/[+-]+$/, '')).filter((w) => w.length >= 3 && !STOP.has(w));
}
/** -> { ok, problems: [...] }. factsText = the facts block the AI was given (product, price, product page text, notes). */
export function factCheck(plan, factsText) {
  const facts = norm(factsText), factNums = new Set(numbersOf(factsText)), factWords = new Set(claimWords(factsText));
  const problems = [];
  const used = Array.isArray(plan && plan.facts_used) ? plan.facts_used.map(str).filter(Boolean) : [];
  for (const f of used) {
    const n = norm(f);
    const toks = n.split(/[^a-z0-9ঀ-৿.]+/).filter((x) => x.length >= 3);
    const hit = facts.includes(n) || (toks.length && toks.filter((x) => facts.includes(x)).length / toks.length >= 0.8);
    if (!hit) problems.push('"' + f.slice(0, 80) + '" (in facts_used) is not in the facts given.');
  }
  const vo = Array.isArray(plan && plan.vo) ? plan.vo : [];
  for (const v of vo) {
    const t = str(v && v.text);
    for (const n of numbersOf(t)) if (!factNums.has(n)) problems.push('The voice-over for shot ' + v.shot + ' says "' + n + '", which is not in the facts.');
    for (const w of claimWords(t)) if (!factWords.has(w) && !facts.includes(w)) problems.push('The voice-over for shot ' + v.shot + ' says "' + w + '", which is not in the facts.');
  }
  return { ok: !problems.length, problems: [...new Set(problems)].slice(0, 20) };
}

// ---- the prompts (port of build_prompt.py)
const dot = (t) => str(t).replace(/[.\s]+$/, '') + '.';
export function stillPrompt(shot, which, ar, pack) {
  const P = pack || FALLBACK;
  return str(shot[which || 'start_frame']) + ' ' + P.realism + ' Aspect ratio ' + (ar || '9:16') + '. photorealism';
}
export function videoPrompt(shot, pack) {
  const P = pack || FALLBACK, c = shot.camera || {};
  const parts = ['Movement: ' + str(c.movement) + '. Start: ' + str(c.start) + '. Speed: ' + str(c.speed) + '. Framing: ' + str(c.framing) + '. End: ' + str(c.end) + '. Time: ' + (str(c.time) || 'real time, normal speed, no slow motion') + '.',
    dot(shot.action)];
  if (str(shot.physics)) parts.push(P.physics + ' ' + dot(shot.physics));
  parts.push(str(shot.light).replace(/[.\s]+$/, '') + '. ' + str(shot.mood).replace(/[.\s]+$/, '') + ' mood.');
  parts.push(P.realism);
  parts.push('Sound: ' + dot(shot.sound));
  return parts.join(' ');
}
export function promptPack(plan, pack) {
  const ar = plan.aspect_ratio || '9:16';
  return (plan.shots || []).map((s) => ({
    n: s.n, purpose: s.purpose, seconds: s.seconds, model: s.model,
    start: stillPrompt(s, 'start_frame', ar, pack),
    end: str(s.end_frame) ? stillPrompt(s, 'end_frame', ar, pack) : '',
    video: videoPrompt(s, pack),
    vo: (plan.vo || []).filter((v) => v && v.shot === s.n).map((v) => str(v.text)).join(' '),
    onscreen: str(s.onscreen_text),
  }));
}
