// Costareen ERP - page renderer.
//
// The ERP hands over a finished HTML page; this hands back a PDF or a PNG, drawn by a headless browser so that the
// design comes out as designed, or a short vertical video cut by ffmpeg from pages it drew (the content factory,
// 20 Oct 2026). It keeps nothing for long: a video job's files are deleted once uploaded, or after two hours.
//
// A page is treated as untrusted: scripts are off, the browser is offline, and any address that is not data carried
// inside the page itself is refused - so a page cannot make this server fetch anything. A video job may name one clip
// to download and one address to upload the result to; both must be the ERP's own file store (Supabase storage).
//
// Only the ERP may ask. The two are paired once: the first caller of /pair leaves a secret, of which only the
// fingerprint is kept, and pairing then closes. To pair again, delete data/pair.json on the server.
'use strict';
const http = require('http'), crypto = require('crypto'), fs = require('fs'), path = require('path'), os = require('os');
const { execFile } = require('child_process');
const { chromium } = require('playwright-core');

const PORT = Number(process.env.CZRENDER_PORT || 8794);
const DATA = process.env.CZRENDER_DATA || path.join(__dirname, 'data');
const PAIR = path.join(DATA, 'pair.json');
const JOBS = path.join(DATA, 'jobs');
const MAX = 6 * 1024 * 1024, MAX_VIDEO = 48 * 1024 * 1024;
const FFMPEG = process.env.FFMPEG || 'ffmpeg', FFPROBE = process.env.FFPROBE || 'ffprobe';
const PYTHON = process.env.CZRENDER_PY || path.join(__dirname, 'venv', 'bin', 'python3'), TTS = path.join(__dirname, 'tts.py');
const YTDLP = process.env.CZRENDER_YTDLP || path.join(__dirname, 'venv', 'bin', 'yt-dlp');
const FONTS = process.env.CZRENDER_FONTS || '/usr/share/fonts';
const STORE_RE = /^https:\/\/[a-z0-9-]+\.supabase\.co\/storage\/v1\//;

const sha = s => crypto.createHash('sha256').update(String(s)).digest();
let paired = null;
try { paired = Buffer.from(JSON.parse(fs.readFileSync(PAIR, 'utf8')).hash, 'hex'); } catch (e) {}
let extra = [];
try { extra = JSON.parse(fs.readFileSync(path.join(DATA, 'keys.json'), 'utf8')).map(k => Buffer.from(String(k.hash), 'hex')).filter(b => b.length === 32); } catch (e) {}
const allowed = given => !!((paired && crypto.timingSafeEqual(given, paired)) || extra.some(k => crypto.timingSafeEqual(given, k)));

let browser = null, starting = null, busy = 0;
async function getBrowser() {
  if (browser && browser.isConnected()) return browser;
  if (!starting) {
    starting = chromium.launch({ headless: true, chromiumSandbox: false, args: ['--disable-gpu', '--disable-dev-shm-usage'] })
      .then(b => { browser = b; starting = null; b.on('disconnected', () => { browser = null; }); return b; })
      .catch(e => { starting = null; throw e; });
  }
  return starting;
}
async function withPage(fn, viewport) {
  const b = await getBrowser();
  const ctx = await b.newContext({ javaScriptEnabled: false, offline: true, viewport: viewport || { width: 1080, height: 1080 }, deviceScaleFactor: 1 });
  try {
    const page = await ctx.newPage();
    await page.route('**/*', route => { const u = route.request().url(); return (u.startsWith('data:') || u === 'about:blank') ? route.continue() : route.abort(); });
    return await fn(page);
  } finally { await ctx.close().catch(() => {}); }
}
async function render(html, footer) {
  return withPage(async page => {
    await page.setContent(html, { waitUntil: 'load', timeout: 20000 });
    return page.pdf({
      format: 'A4', printBackground: true, preferCSSPageSize: true,
      displayHeaderFooter: !!footer, headerTemplate: '<span></span>',
      footerTemplate: footer ? '<style>#header,#footer{padding:0!important;margin:0!important}</style>' + footer : '<span></span>',
      margin: { top: '0', right: '0', bottom: footer ? '31mm' : '0', left: '0' }
    });
  });
}
/** A PNG of the page at exactly width x height (a picture card, a video frame). */
async function png(html, width, height) {
  const w = Math.max(200, Math.min(2160, Number(width) || 1080)), h = Math.max(200, Math.min(3840, Number(height) || 1080));
  return withPage(async page => {
    await page.setContent(html, { waitUntil: 'load', timeout: 20000 });
    await page.evaluate(() => document.fonts && document.fonts.ready).catch(() => {});
    return page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: w, height: h } });
  }, { width: w, height: h });
}

// ------------------------------------------------------------------ video jobs
const jobs = new Map();   // id -> {state, error, at}
let videoBusy = false;
const queue = [];
function run(cmd, args, opts) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 8 * 1024 * 1024, timeout: (opts && opts.timeout) || 240000 }, (err, stdout, stderr) => err ? reject(new Error(String(stderr || err.message).slice(-600))) : resolve(String(stdout)));
  });
}
async function fetchBytes(url, max) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('download ' + r.status);
  const b = Buffer.from(await r.arrayBuffer());
  if (b.length > max) throw new Error('clip too large');
  return b;
}
async function probe(file) {
  try {
    const out = await run(FFPROBE, ['-v', 'error', '-show_entries', 'stream=codec_type,width,height,duration', '-of', 'json', file]);
    const j = JSON.parse(out); const v = (j.streams || []).find(s => s.codec_type === 'video'), a = (j.streams || []).find(s => s.codec_type === 'audio');
    return { video: !!v, audio: !!a, duration: Number((v && v.duration) || 0), width: v && v.width, height: v && v.height };
  } catch (e) { return { video: false, audio: false, duration: 0 }; }
}
/** Microsoft Edge's neural voices through edge-tts (free; bn-BD-NabanitaNeural, en-US-AriaNeural...): an MP3 and the word timings. */
async function speak(dir, text, voice, rate) {
  const tf = path.join(dir, 'voice.txt'), mp3 = path.join(dir, 'voice.mp3'), wj = path.join(dir, 'words.json');
  fs.writeFileSync(tf, String(text));
  await run(PYTHON, [TTS, tf, String(voice || 'en-US-AriaNeural'), String(rate || '+0%'), mp3, wj], { timeout: 90000 });
  const words = JSON.parse(fs.readFileSync(wj, 'utf8'));
  const info = await probe(mp3);
  if (!info.audio) throw new Error('the voice came back empty');
  return { file: mp3, words, seconds: info.duration || (words.length ? words[words.length - 1].end : 0) };
}
/** A transparent picture of a page at W x H (text laid over a clip). */
async function overlayPng(html, W, H) {
  return withPage(async (page) => {
    await page.setContent(html, { waitUntil: 'load', timeout: 20000 });
    await page.evaluate(() => document.fonts && document.fonts.ready).catch(() => {});
    return page.screenshot({ type: 'png', omitBackground: true, clip: { x: 0, y: 0, width: W, height: H } });
  }, { width: W, height: H });
}
async function putTo(url, bytes, contentType) {
  if (!STORE_RE.test(String(url || ''))) throw new Error('nowhere to upload');
  const r = await fetch(url, { method: 'PUT', headers: { 'Content-Type': contentType, 'x-upsert': 'true' }, body: bytes });
  if (!r.ok) throw new Error('upload ' + r.status + ' ' + (await r.text()).slice(0, 120));
}
/** Stock b-roll from Pexels (the ERP passes the owner's key): one portrait clip of at least `seconds`, the smallest file that still covers the frame. */
async function pexelsClip(dir, key, query, W, H, seconds) {
  const r = await fetch('https://api.pexels.com/videos/search?' + new URLSearchParams({ query, per_page: '15', orientation: H > W ? 'portrait' : W > H ? 'landscape' : 'square', size: 'medium' }), { headers: { Authorization: key } });
  if (!r.ok) throw new Error('Pexels ' + r.status);
  const j = await r.json();
  let best = null;
  for (const v of j.videos || []) {
    if ((v.duration || 0) < seconds) continue;
    for (const f of v.video_files || []) {
      if (!/mp4/i.test(f.file_type || '') || !(f.width >= W * 0.6 && f.height >= H * 0.6)) continue;
      const area = f.width * f.height;
      if (!best || area < best.area) best = { url: f.link, area, id: v.id, user: v.user && v.user.name };
    }
  }
  if (!best) throw new Error('no Pexels clip fits ' + query);
  const f = path.join(dir, 'broll.mp4');
  fs.writeFileSync(f, await fetchBytes(best.url, 60 * 1024 * 1024));
  return { file: f, id: best.id, user: best.user };
}

/** Captions the way the short-video tools do them - 3-5 words a cue, big, outlined, the spoken word lit - but drawn by
 *  the browser (perfect Bengali shaping) as transparent PNGs, one per spoken word, laid over the video for that word's time. */
function captionGroups(words) {
  const groups = []; let cur = [];
  for (const w of words) {
    if (!w.text) continue;
    cur.push(w);
    const chars = cur.reduce((n, x) => n + x.text.length, 0);
    if (cur.length >= 4 || chars >= 22 || /[.!?।]$/.test(w.text)) { groups.push(cur); cur = []; }
  }
  if (cur.length) groups.push(cur);
  return groups;
}
const htmlEsc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
async function captionPngs(dir, words, W, H, offset, style) {
  const groups = captionGroups(words);
  const fs_ = Math.round(W * (style && style.size ? style.size : 0.062)), capH = Math.round(H * 0.22);
  const out = [];   // {file, start, end}
  let n = 0;
  for (const g of groups) {
    for (let k = 0; k < g.length; k++) {
      if (n >= 90) break;   // a very long voice: the last words share one picture
      const w = g[k];
      const start = w.start + offset, end = (k === g.length - 1 ? Math.max(w.end, g[k].end) : g[k + 1].start) + offset;
      const html = '<html><head><style>*{box-sizing:border-box}html,body{margin:0;width:' + W + 'px;height:' + capH + 'px;background:transparent;overflow:hidden}' +
        'body{display:flex;align-items:center;justify-content:center;font-family:"Noto Sans Bengali",Inter,sans-serif;font-weight:800;font-size:' + fs_ + 'px;line-height:1.3;text-align:center;padding:0 40px}' +
        'p{margin:0;color:#fff;text-shadow:0 0 6px #000,0 0 6px #000,0 3px 0 #000,0 -3px 0 #000,3px 0 0 #000,-3px 0 0 #000,2px 2px 0 #000,-2px -2px 0 #000,2px -2px 0 #000,-2px 2px 0 #000}' +
        'b{color:#f0a030;font-weight:800}</style></head><body><p>' + g.map((x, m) => (m === k ? '<b>' + htmlEsc(x.text) + '</b>' : htmlEsc(x.text))).join(' ') + '</p></body></html>';
      const f = path.join(dir, 'cap' + n + '.png');
      fs.writeFileSync(f, await withPage(async (page) => {
        await page.setContent(html, { waitUntil: 'load', timeout: 20000 });
        await page.evaluate(() => document.fonts && document.fonts.ready).catch(() => {});
        return page.screenshot({ type: 'png', omitBackground: true, clip: { x: 0, y: 0, width: W, height: capH } });
      }, { width: W, height: capH }));
      out.push({ file: f, start, end: Math.max(end, start + 0.2) });
      n++;
    }
    if (n >= 90) break;
  }
  return { pngs: out, capH };
}
/**
 * job: { width, height, slides:[{html, seconds, motion:'in'|'out'|'left'|'right'|'none'}], clip?:{url, seconds, mute?},
 *        voice?: {text, voice, rate, captions:true|false, offset}, music?: {url, volume}, upload:{url, contentType} }
 * The clip (when given) comes first, then the slides. Result is uploaded with PUT to job.upload.url.
 */
async function buildVideo(id, job) {
  const dir = path.join(JOBS, id); fs.mkdirSync(dir, { recursive: true });
  const W = Math.max(360, Math.min(2160, Number(job.width) || 1080)), H = Math.max(360, Math.min(3840, Number(job.height) || 1920)), FPS = 30;
  const parts = [];   // {file, kind:'image'|'video', seconds, motion, hasAudio}
  if (job.clip && STORE_RE.test(String(job.clip.url || ''))) {
    const src = path.join(dir, 'clip.src');
    fs.writeFileSync(src, await fetchBytes(job.clip.url, 150 * 1024 * 1024));
    const info = await probe(src);
    if (!info.video) throw new Error('the clip has no video');
    const secs = Math.max(2, Math.min(60, Number(job.clip.seconds) || Math.min(15, info.duration || 15)));
    parts.push({ file: src, kind: 'video', seconds: Math.min(secs, info.duration || secs), hasAudio: info.audio && !job.clip.mute });
  }
  let brollInfo = null;
  if (job.broll && (job.broll.key && job.broll.query || STORE_RE.test(String(job.broll.url || '')))) {
    try {
      const secs = Math.max(2, Math.min(6, Number(job.broll.seconds) || 3));
      let file;
      if (job.broll.url) { file = path.join(dir, 'broll.src'); fs.writeFileSync(file, await fetchBytes(job.broll.url, 60 * 1024 * 1024)); }
      else { const px = await pexelsClip(dir, job.broll.key, String(job.broll.query), W, H, secs); file = px.file; brollInfo = { pexels: px.id, by: px.user }; }
      const info = await probe(file);
      if (info.video) {
        const part = { file, kind: 'video', seconds: Math.min(secs, info.duration || secs), hasAudio: false };
        if (typeof job.broll.html === 'string' && job.broll.html) { part.overlay = path.join(dir, 'broll-over.png'); fs.writeFileSync(part.overlay, await overlayPng(job.broll.html, W, H)); }
        parts.unshift(part);
      }
    } catch (e) { brollInfo = { error: String((e && e.message) || e).slice(0, 160) }; }
  }
  const slides = Array.isArray(job.slides) ? job.slides.slice(0, 20) : [];
  for (let i = 0; i < slides.length; i++) {
    const s = slides[i]; if (!s || typeof s.html !== 'string') continue;
    const f = path.join(dir, 'slide' + i + '.png');
    fs.writeFileSync(f, await png(s.html, W, H));
    parts.push({ file: f, kind: 'image', seconds: Math.max(1, Math.min(15, Number(s.seconds) || 3)), motion: String(s.motion || (i % 2 ? 'out' : 'in')) });
  }
  if (!parts.length) throw new Error('nothing to cut');
  let voice = null, captions = null, voiceWarn = '';
  if (job.voice && job.voice.text) {
    try {
      const v = await speak(dir, job.voice.text, job.voice.voice, job.voice.rate);
      voice = v.file;
      // the slides stretch so the voice is never cut: the extra seconds go to the middle slides
      const total0 = parts.reduce((t, p) => t + p.seconds, 0) - 0.5 * (parts.length - 1);
      const off = Math.max(0, Number(job.voice.offset) || 0.4);
      if (v.seconds + off + 0.8 > total0) {
        const extra = v.seconds + off + 0.8 - total0, stills = parts.filter((p) => p.kind === 'image');
        for (const p of stills) p.seconds += extra / Math.max(1, stills.length);
      }
      if (job.voice.captions !== false && v.words.length) captions = await captionPngs(dir, v.words, W, H, off, job.voice.style);
    } catch (e) { voiceWarn = 'voice: ' + String((e && e.message) || e).slice(0, 160); voice = null; }
  }
  let music = null;
  if (job.music && STORE_RE.test(String(job.music.url || ''))) {
    try { music = path.join(dir, 'music.bin'); fs.writeFileSync(music, await fetchBytes(job.music.url, 30 * 1024 * 1024)); if (!(await probe(music)).audio) music = null; } catch (e) { music = null; }
  }

  const args = ['-y', '-hide_banner', '-loglevel', 'error'];
  const fc = [];
  parts.forEach((p, i) => {
    if (p.kind === 'video') { args.push('-t', String(p.seconds), '-i', p.file); fc.push('[' + i + ':v]scale=' + W + ':' + H + ':force_original_aspect_ratio=increase,crop=' + W + ':' + H + ',setsar=1,fps=' + FPS + ',format=yuv420p[v' + i + ']'); }
    else {
      args.push('-i', p.file);
      const N = Math.round(p.seconds * FPS), m = p.motion;
      // Ken Burns on one still: zoompan makes N frames out of the one picture
      const z = m === 'out' ? "'1.12-0.12*on/" + N + "'" : m === 'none' ? "'1.0'" : "'1.0+0.12*on/" + N + "'";
      const x = m === 'left' ? "'(iw-iw/zoom)*on/" + N + "'" : m === 'right' ? "'(iw-iw/zoom)*(1-on/" + N + ")'" : "'(iw-iw/zoom)/2'";
      fc.push('[' + i + ':v]scale=' + (W * 2) + ':' + (H * 2) + ':force_original_aspect_ratio=increase,crop=' + (W * 2) + ':' + (H * 2) + ',zoompan=z=' + z + ':x=' + x + ":y='(ih-ih/zoom)/2':d=" + N + ':s=' + W + 'x' + H + ':fps=' + FPS + ',setsar=1,format=yuv420p[v' + i + ']');
    }
  });
  // the hook over a b-roll clip
  const extraIn = [];
  parts.forEach((p, i) => { if (p.overlay) { args.push('-i', p.overlay); const idx = parts.length + extraIn.length; extraIn.push(p.overlay); fc.push('[v' + i + '][' + idx + ':v]overlay=0:0[vo' + i + ']'); } });
  const vname = (i) => (parts[i].overlay ? 'vo' + i : 'v' + i);
  // crossfades between the parts
  const TR = 0.5;
  let last = vname(0), total = parts[0].seconds;
  for (let i = 1; i < parts.length; i++) {
    const out = i === parts.length - 1 ? 'vout' : 'x' + i;
    fc.push('[' + last + '][' + vname(i) + ']xfade=transition=fade:duration=' + TR + ':offset=' + (total - TR).toFixed(2) + '[' + out + ']');
    total += parts[i].seconds - TR; last = out;
  }
  if (parts.length === 1) fc.push('[' + vname(0) + ']copy[vout]');
  // the captions laid over, one picture per spoken word for its time; BT.709 tagged so colours do not shift
  let vlast = 'vout', capInputs = 0;
  if (captions && captions.pngs.length) {
    const y = H - captions.capH - Math.round(H * 0.10);
    captions.pngs.forEach((c, k) => {
      args.push('-i', c.file); const idx = parts.length + extraIn.length + capInputs; capInputs++;
      const out = 'vc' + k;
      fc.push('[' + vlast + '][' + idx + ':v]overlay=0:' + y + ":enable='between(t," + c.start.toFixed(2) + ',' + c.end.toFixed(2) + ")'[" + out + ']');
      vlast = out;
    });
  }
  fc.push('[' + vlast + ']scale=out_color_matrix=bt709:out_range=tv,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709,format=yuv420p[vfinal]');
  // audio: the voice (and music under it at low volume), else the clip's own sound (plus music), else music alone, else silence
  const amix = [];
  let ai = parts.length + extraIn.length + capInputs;
  if (voice) { args.push('-i', voice); fc.push('[' + ai + ':a]aformat=sample_rates=48000:channel_layouts=stereo,apad[avoice]'); amix.push('[avoice]'); ai++; }
  else if (parts[0].kind === 'video' && parts[0].hasAudio) { fc.push('[0:a]aformat=sample_rates=48000:channel_layouts=stereo,apad[aclip]'); amix.push('[aclip]'); }
  if (music) { const vol = Math.max(0.05, Math.min(1, Number(job.music.volume) || (amix.length ? 0.18 : 0.6))); args.push('-stream_loop', '-1', '-i', music); fc.push('[' + ai + ':a]aformat=sample_rates=48000:channel_layouts=stereo,volume=' + vol + ',afade=t=out:st=' + Math.max(0, total - 3).toFixed(2) + ':d=3[amusic]'); amix.push('[amusic]'); ai++; }
  if (!amix.length) { args.push('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo'); fc.push('[' + ai + ':a]acopy[aout]'); }
  else if (amix.length === 1) fc.push(amix[0] + 'acopy[aout]');
  else fc.push(amix.join('') + 'amix=inputs=' + amix.length + ':duration=first:dropout_transition=2:normalize=0[aout]');
  const out = path.join(dir, 'out.mp4');
  // Reels spec: H.264 yuv420p, 30 fps fixed, closed GOP 2 s, AAC stereo 48 kHz 128k+
  args.push('-filter_complex', fc.join(';'), '-map', '[vfinal]', '-map', '[aout]', '-t', total.toFixed(2),
            '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-profile:v', 'high', '-level', '4.1', '-r', String(FPS), '-g', String(FPS * 2), '-keyint_min', String(FPS * 2), '-sc_threshold', '0', '-pix_fmt', 'yuv420p',
            '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2', '-movflags', '+faststart', '-shortest', out);
  await run(FFMPEG, args, { timeout: 420000 });
  const bytes = fs.readFileSync(out);
  if (!(job.upload && STORE_RE.test(String(job.upload.url || '')))) throw new Error('nowhere to upload');
  const r = await fetch(job.upload.url, { method: 'PUT', headers: { 'Content-Type': String(job.upload.contentType || 'video/mp4'), 'x-upsert': 'true' }, body: bytes });
  if (!r.ok) throw new Error('upload ' + r.status + ' ' + (await r.text()).slice(0, 120));
  return { bytes: bytes.length, seconds: Number(total.toFixed(1)), voice: !!voice, captions: !!(captions && captions.pngs.length), music: !!music, broll: brollInfo, warn: voiceWarn + (brollInfo && brollInfo.error ? ' b-roll: ' + brollInfo.error : '') };
}
/** job: { url?, clipUrl?, uploads: { frames: [url x6], audio: url } } -> meta about the video; frames and audio go to the given addresses. */
async function studyVideo(id, job) {
  const dir = path.join(JOBS, id); fs.mkdirSync(dir, { recursive: true });
  let src = path.join(dir, 'src.mp4'), meta = {};
  if (STORE_RE.test(String(job.clipUrl || ''))) fs.writeFileSync(src, await fetchBytes(job.clipUrl, 150 * 1024 * 1024));
  else if (/^https?:\/\//.test(String(job.url || ''))) {
    const out = await run(YTDLP, ['--no-warnings', '--no-playlist', '-f', 'b[height<=720][ext=mp4]/b[ext=mp4]/b', '--max-filesize', '80M', '--match-filter', 'duration<=300', '-o', path.join(dir, 'src.%(ext)s'), '--print-json', '--no-simulate', String(job.url)], { timeout: 180000 })
      .catch((e) => { const m = String(e.message || e); throw new Error(/Sign in|login|cookies/i.test(m) ? 'This site will not give the video to a server: save the video on your phone and upload the file instead.' : 'Could not fetch the link: ' + m.slice(-160)); });
    try { const j = JSON.parse(out.trim().split('\n').pop()); meta = { title: String(j.title || '').slice(0, 200), by: String(j.uploader || j.channel || '').slice(0, 100), views: Number(j.view_count || 0), likes: Number(j.like_count || 0), comments: Number(j.comment_count || 0), description: String(j.description || '').slice(0, 800), site: String(j.extractor_key || '') }; src = path.join(dir, 'src.' + (j.ext || 'mp4')); } catch (_) { /* no meta */ }
    if (!fs.existsSync(src)) { const f = fs.readdirSync(dir).find((n) => n.startsWith('src.')); if (f) src = path.join(dir, f); }
  } else throw new Error('a link or a file is needed');
  const info = await probe(src);
  if (!info.video) throw new Error('that is not a video');
  const dur = info.duration || 30;
  meta.seconds = Number(dur.toFixed(1)); meta.width = info.width; meta.height = info.height;
  const n = (job.uploads && job.uploads.frames || []).length;
  for (let i = 0; i < n; i++) {
    const t = Math.min(dur - 0.2, Math.max(0, (dur * (i + 0.5)) / n));
    const f = path.join(dir, 'f' + i + '.jpg');
    await run(FFMPEG, ['-y', '-v', 'error', '-ss', t.toFixed(2), '-i', src, '-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '5', f]);
    await putTo(job.uploads.frames[i], fs.readFileSync(f), 'image/jpeg');
  }
  if (job.uploads && job.uploads.audio && info.audio) {
    const a = path.join(dir, 'a.mp3');
    await run(FFMPEG, ['-y', '-v', 'error', '-i', src, '-t', '120', '-vn', '-ac', '1', '-ar', '22050', '-b:a', '48k', a]);
    await putTo(job.uploads.audio, fs.readFileSync(a), 'audio/mpeg');
    meta.hasAudio = true;
  }
  return { meta, frames: n };
}
function startJob(id, job) {
  jobs.set(id, { state: 'queued', at: Date.now() });
  queue.push({ id, job }); pump();
}
async function pump() {
  if (videoBusy || !queue.length) return;
  videoBusy = true;
  const { id, job } = queue.shift();
  const j = jobs.get(id); j.state = 'working';
  try { const r = job.study ? await studyVideo(id, job) : await buildVideo(id, job); Object.assign(j, { state: 'done', ...r }); }
  catch (e) { j.state = 'failed'; j.error = String((e && e.message) || e).slice(0, 300); console.error(new Date().toISOString(), 'video', id, j.error); }
  finally { fs.rmSync(path.join(JOBS, id), { recursive: true, force: true }); videoBusy = false; pump(); }
}
setInterval(() => { const t = Date.now() - 2 * 3600e3; for (const [id, j] of jobs) if (j.at < t) jobs.delete(id); }, 600e3).unref();

function body(req, max) {
  return new Promise((resolve, reject) => {
    let n = 0; const parts = [];
    req.on('data', c => { n += c.length; if (n > (max || MAX)) { reject(new Error('too large')); req.destroy(); } else parts.push(c); });
    req.on('end', () => resolve(Buffer.concat(parts).toString('utf8')));
    req.on('error', reject);
  });
}
const hits = new Map();
function tooMany(ip, max, secs) {
  const t = Date.now() / 1000, h = (hits.get(ip) || []).filter(x => x > t - secs);
  h.push(t); hits.set(ip, h); if (hits.size > 2000) hits.clear();
  return h.length > max;
}
const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };

const server = http.createServer(async (req, res) => {
  const ip = String(req.headers['x-real-ip'] || req.socket.remoteAddress || '');
  const p = String(req.url || '').split('?')[0].replace(/\/+$/, '');
  try {
    if (tooMany(ip, 120, 60)) return send(res, 429, { error: 'slow down' });
    if (req.method === 'POST' && p === '/render/pair') {
      if (paired) return send(res, 409, { error: 'already paired' });
      const j = JSON.parse(await body(req));
      const secret = String(j.secret || '');
      if (!/^[A-Za-z0-9]{40,128}$/.test(secret)) return send(res, 400, { error: 'bad secret' });
      fs.mkdirSync(DATA, { recursive: true, mode: 0o700 });
      fs.writeFileSync(PAIR, JSON.stringify({ hash: sha(secret).toString('hex'), at: new Date().toISOString() }), { mode: 0o600 });
      paired = sha(secret);
      return send(res, 200, { ok: true });
    }
    const given = sha(String(req.headers['x-render-key'] || ''));
    if (!allowed(given)) return send(res, 401, { error: 'not allowed' });

    if (req.method === 'POST' && p === '/render/pdf') {
      if (busy >= 3) return send(res, 503, { error: 'busy' });
      const j = JSON.parse(await body(req));
      if (typeof j.html !== 'string' || !j.html) return send(res, 400, { error: 'no page' });
      busy++;
      let pdf;
      try { pdf = await render(j.html, typeof j.footer === 'string' ? j.footer : ''); } finally { busy--; }
      res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': pdf.length, 'Cache-Control': 'no-store' });
      return res.end(pdf);
    }
    if (req.method === 'POST' && p === '/render/png') {
      if (busy >= 3) return send(res, 503, { error: 'busy' });
      const j = JSON.parse(await body(req, 16 * 1024 * 1024));
      if (typeof j.html !== 'string' || !j.html) return send(res, 400, { error: 'no page' });
      busy++;
      let img;
      try { img = await png(j.html, j.width, j.height); } finally { busy--; }
      res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': img.length, 'Cache-Control': 'no-store' });
      return res.end(img);
    }
    if (req.method === 'POST' && p === '/render/inspo') {
      if (queue.length >= 6) return send(res, 503, { error: 'busy' });
      const j = JSON.parse(await body(req));
      if (!(j.url || j.clipUrl)) return send(res, 400, { error: 'a link or a file' });
      const id = crypto.randomUUID().replace(/-/g, '');
      startJob(id, { ...j, study: true });
      return send(res, 200, { id, state: 'queued' });
    }
    if (req.method === 'POST' && p === '/render/video') {
      if (queue.length >= 6) return send(res, 503, { error: 'busy' });
      const j = JSON.parse(await body(req, MAX_VIDEO));
      if (!j.upload || !STORE_RE.test(String(j.upload.url || ''))) return send(res, 400, { error: 'no upload address' });
      const id = crypto.randomUUID().replace(/-/g, '');
      startJob(id, j);
      return send(res, 200, { id, state: 'queued', queued: queue.length });
    }
    if (req.method === 'GET' && p === '/render/voices') return send(res, 200, { voices: ['bn-BD-NabanitaNeural', 'bn-BD-PradeepNeural', 'bn-IN-TanishaaNeural', 'bn-IN-BashkarNeural', 'en-US-AriaNeural', 'en-US-GuyNeural', 'en-US-JennyNeural', 'en-US-ChristopherNeural', 'en-IN-NeerjaNeural', 'en-IN-PrabhatNeural'] });
    const m = /^\/render\/job\/([0-9a-f]{32})$/.exec(p);
    if (req.method === 'GET' && m) {
      const j = jobs.get(m[1]);
      return j ? send(res, 200, { id: m[1], state: j.state, error: j.error || '', bytes: j.bytes || 0, seconds: j.seconds || 0, voice: !!j.voice, captions: !!j.captions, music: !!j.music, broll: j.broll || null, warn: j.warn || '', meta: j.meta || null, frames: j.frames || 0 }) : send(res, 404, { error: 'no such job' });
    }
    return send(res, 404, { error: 'not found' });
  } catch (e) {
    console.error(new Date().toISOString(), p, String((e && e.message) || e).slice(0, 200));   // never the page itself
    try { send(res, 500, { error: 'could not draw the page' }); } catch (x) {}
  }
});
if (require.main === module) server.listen(PORT, '127.0.0.1', () => console.log('czrender on 127.0.0.1:' + PORT + (paired ? ' (paired)' : ' (waiting to be paired)')));
module.exports = { render, png };
