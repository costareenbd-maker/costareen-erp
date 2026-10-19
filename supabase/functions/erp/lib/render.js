// The render server (deploy/czrender/server.js on the office server): PDFs (deps.renderPdf), and since 20 Oct 2026
// PNG pictures of a page and short videos cut from pages (the content factory). deps.render = { url, key }.

const str = (v) => String(v == null ? '' : v).trim();

function conf(deps) {
  const r = (deps && deps.render) || {};
  if (!r.url || !r.key) throw new Error('The render server is not set up on this system (RENDER_URL / RENDER_KEY).');
  return { url: str(r.url).replace(/\/+$/, ''), key: str(r.key), fetch: deps.fetch || fetch };
}

/** A PNG of an HTML page at width x height. Returns bytes. */
export async function renderPng(deps, html, width, height) {
  const c = conf(deps);
  const r = await c.fetch(c.url + '/png', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Render-Key': c.key }, body: JSON.stringify({ html, width, height }) });
  if (!r.ok) throw new Error('The picture could not be drawn (' + r.status + ').');
  const bytes = new Uint8Array(await r.arrayBuffer());
  if (bytes.length < 100) throw new Error('The picture could not be drawn.');
  return bytes;
}

/** Start a video job: {width, height, slides:[{html, seconds, motion}], clip?, voice?, upload:{url, contentType}}. Returns the job id. */
export async function startVideo(deps, job) {
  const c = conf(deps);
  const r = await c.fetch(c.url + '/video', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Render-Key': c.key }, body: JSON.stringify(job) });
  let j = {}; try { j = JSON.parse(await r.text()); } catch (_) { j = {}; }
  if (!r.ok || !j.id) throw new Error('The video could not be started: ' + str(j.error || r.status));
  return str(j.id);
}

/** Study a video for the inspiration box: {url | clipUrl, uploads:{frames:[], audio}}. Returns the job id. */
export async function startStudy(deps, job) {
  const c = conf(deps);
  const r = await c.fetch(c.url + '/inspo', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Render-Key': c.key }, body: JSON.stringify(job) });
  let j = {}; try { j = JSON.parse(await r.text()); } catch (_) { j = {}; }
  if (!r.ok || !j.id) throw new Error('The study could not be started: ' + str(j.error || r.status));
  return str(j.id);
}

/** Where a job stands: {state: queued|working|done|failed, error, bytes, seconds}. */
export async function videoJob(deps, id) {
  const c = conf(deps);
  const r = await c.fetch(c.url + '/job/' + encodeURIComponent(id), { method: 'GET', headers: { 'X-Render-Key': c.key } });
  let j = {}; try { j = JSON.parse(await r.text()); } catch (_) { j = {}; }
  if (r.status === 404) return { state: 'lost', error: 'The render server no longer has this job.' };
  if (!r.ok) throw new Error('The render server did not answer (' + r.status + ').');
  return { state: str(j.state), error: str(j.error), bytes: Number(j.bytes || 0), seconds: Number(j.seconds || 0), voice: !!j.voice, captions: !!j.captions, music: !!j.music, broll: j.broll || null, warn: str(j.warn), meta: j.meta || null };
}
