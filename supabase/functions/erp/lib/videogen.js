// shots-1: the place where a real image / video generator plugs in later. None is connected yet (16 Nov 2026: the owner
// makes the clips by hand in a browser-only Flow reseller), so Realistic AI shots ends in a prompt pack + shot list.
//
// A generator is an object registered here:
//   {
//     key: 'fal',                                   // short name, kept with the plan
//     name: 'fal.ai',                               // what the owner sees
//     secret: 'FAL_KEY',                            // the provider secret it needs (erp_provider_secrets / business AI_ key)
//     costBdt: ({ kind, seconds, model }) => n,     // an honest price BEFORE anything is made: the owner approves money first
//     still: async (ctx, { prompt, aspect, refImage }) => ({ job }),            // start or end still
//     video: async (ctx, { prompt, start, end, seconds, aspect, model }) => ({ job }),   // start (+ end) still -> clip
//     voice: async (ctx, { text, lang, sex }) => ({ job }),                     // e.g. ElevenLabs; optional
//     poll: async (ctx, job) => ({ state: 'working' | 'done' | 'failed', url, error }),
//   }
// Rules for whoever connects one: never spend without the owner's approval of the shown price, keep every job in ai_work
// with its cost, stills first (a still is checked before its video is asked for), and nothing is posted by itself.

export const GENERATORS = {};

export function registerGenerator(g) { if (g && g.key) GENERATORS[g.key] = g; }
export function generatorList() { return Object.values(GENERATORS).map((g) => ({ key: g.key, name: g.name })); }
export function generator(key) { return GENERATORS[key] || null; }
