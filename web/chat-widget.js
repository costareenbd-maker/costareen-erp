/* The website chat (Inbox, handlers/inbox.js webchat): one line on the business's own site -
     <script src="https://<erp>/chat-widget.js" data-chat="<the chat address from Inbox > Channels>" async></script>
   A round button; the visitor gives a name and a mobile number, then chats with the shop's AI agent (photos and voice
   notes too), or presses the call button and talks: their words are heard by the browser, the answers spoken back.
   The visitor's id and its signed token stay in this browser (localStorage), so the chat continues on the next visit. */
(function () {
  if (window.__erpChat) return; window.__erpChat = true;
  var me = document.currentScript || document.querySelector('script[data-chat]');
  var API = me && me.getAttribute('data-chat'); if (!API) return;
  var KEY = 'erp_chat_' + API.replace(/[^a-z0-9]/gi, '').slice(-24);
  var st = {}; try { st = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { st = {}; }
  var fresh = false, info = { name: 'Chat', colour: '#F5A623', logo: '', greeting: '' }, after = 0, open = false, timer = null, calling = false, rec = null, lastSpoken = 0;
  function save() { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {} }
  function call(a, body) {
    return fetch(API + (API.indexOf('?') >= 0 ? '&' : '?') + 'a=' + a, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) })
      .then(function (r) { return r.json(); }).catch(function () { return { ok: false, error: 'No connection.' }; });
  }
  function h(t, a, kids) { var e = document.createElement(t); for (var k in (a || {})) { if (k === 'text') e.textContent = a[k]; else if (k === 'style') e.style.cssText = a[k]; else e.setAttribute(k, a[k]); } (kids || []).forEach(function (c) { e.appendChild(c); }); return e; }
  var css = '.ec-b{position:fixed;right:20px;bottom:20px;width:58px;height:58px;border-radius:50%;border:0;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.25);z-index:2147483000;display:flex;align-items:center;justify-content:center;color:#fff}' +
    '.ec-b svg{width:28px;height:28px;fill:none;stroke:#fff;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}' +
    '.ec-p{position:fixed;right:20px;bottom:90px;width:360px;max-width:calc(100vw - 24px);height:540px;max-height:calc(100vh - 110px);background:#fff;color:#111;border-radius:18px;box-shadow:0 16px 48px rgba(0,0,0,.28);z-index:2147483000;display:none;flex-direction:column;overflow:hidden;font:14px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans Bengali",sans-serif}' +
    '.ec-p.on{display:flex}.ec-h{padding:12px 14px;color:#fff;display:flex;gap:10px;align-items:center}.ec-h img{width:32px;height:32px;border-radius:50%;background:#fff;object-fit:cover}.ec-h b{flex:1;font-size:15px}.ec-h small{display:block;font-weight:400;opacity:.85;font-size:11.5px}' +
    '.ec-h button{background:rgba(255,255,255,.2);border:0;color:#fff;border-radius:999px;width:32px;height:32px;cursor:pointer;font-size:15px}' +
    '.ec-m{flex:1;overflow:auto;padding:12px;display:flex;flex-direction:column;gap:6px;background:#f6f6f7}.ec-x{max-width:80%;padding:8px 11px;border-radius:15px;white-space:pre-wrap;word-wrap:break-word}' +
    '.ec-x.me{align-self:flex-end;color:#fff;border-bottom-right-radius:4px}.ec-x.it{align-self:flex-start;background:#fff;border:1px solid #e5e5e5;border-bottom-left-radius:4px}.ec-x img{max-width:220px;border-radius:10px;display:block}' +
    '.ec-cards{display:flex;gap:6px;overflow-x:auto;max-width:100%}.ec-card{flex:0 0 140px;background:#fff;border:1px solid #e5e5e5;border-radius:12px;overflow:hidden;font-size:12px}.ec-card img{width:100%;height:84px;object-fit:cover;border-radius:0}.ec-card div{padding:5px 7px}' +
    '.ec-opts{display:flex;gap:4px;flex-wrap:wrap;margin-top:6px}.ec-opts button{border:1px solid #ccc;background:#fff;border-radius:999px;padding:3px 10px;cursor:pointer;font:inherit;font-size:12.5px}' +
    '.ec-i{display:flex;gap:6px;padding:8px;border-top:1px solid #eee;align-items:center}.ec-i input[type=text]{flex:1;border:1px solid #ddd;border-radius:999px;padding:9px 12px;font:inherit;color:#111;background:#fff}' +
    '.ec-i button,.ec-i label{border:0;background:#f0f0f0;border-radius:50%;width:36px;height:36px;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:16px;flex:0 0 36px}.ec-i .send{color:#fff}' +
    '.ec-f{padding:18px;display:flex;flex-direction:column;gap:10px}.ec-f input{border:1px solid #ddd;border-radius:10px;padding:10px 12px;font:inherit;color:#111;background:#fff}.ec-f button{border:0;border-radius:10px;padding:11px;color:#fff;font:inherit;font-weight:700;cursor:pointer}' +
    '.ec-t{font-size:12px;color:#888;padding:0 12px 6px;background:#f6f6f7}.ec-e{color:#c0392b;font-size:12.5px}.ec-ai{font-size:11px;text-align:center;color:#999;padding:4px}';
  document.head.appendChild(h('style', { text: css }));
  var btn = h('button', { class: 'ec-b', 'aria-label': 'Chat with us', type: 'button' });
  btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 4h16v12H8l-4 4z"/><path d="M8 9h8M8 12h5"/></svg>';
  var panel = h('div', { class: 'ec-p', role: 'dialog', 'aria-label': 'Chat' });
  document.body.appendChild(btn); document.body.appendChild(panel);
  function colourise() { btn.style.background = info.colour; }
  function shell(body) {
    panel.innerHTML = '';
    var head = h('div', { class: 'ec-h', style: 'background:' + info.colour });
    if (info.logo) head.appendChild(h('img', { src: info.logo, alt: '' }));
    var t = h('b', { text: info.name }); t.appendChild(h('small', { text: 'AI assistant · a person joins when needed' })); head.appendChild(t);
    if (st.visitor && ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) { var cb = h('button', { type: 'button', title: 'Talk', text: calling ? '■' : '📞' }); cb.onclick = toggleCall; head.appendChild(cb); }
    var x = h('button', { type: 'button', text: '✕', title: 'Close' }); x.onclick = function () { setOpen(false); }; head.appendChild(x);
    panel.appendChild(head); body.forEach(function (b) { panel.appendChild(b); });
  }
  function startForm(err) {
    var n = h('input', { placeholder: 'Your name', autocomplete: 'name' }), p = h('input', { placeholder: 'Mobile number (01…)', inputmode: 'numeric', autocomplete: 'tel' });
    var go = h('button', { type: 'button', text: 'Start the chat', style: 'background:' + info.colour });
    var e = h('div', { class: 'ec-e', text: err || '' });
    go.onclick = function () { go.disabled = true; call('start', { name: n.value, phone: p.value }).then(function (r) { if (r.ok) { st = { visitor: r.visitor, token: r.token }; save(); chat(); } else { go.disabled = false; e.textContent = r.error || 'Try again.'; } }); };
    shell([h('div', { class: 'ec-f' }, [h('div', { text: info.greeting || 'Hello! How can we help you?' }), n, p, go, e])]);
  }
  var box, typing;
  function chat() {
    box = h('div', { class: 'ec-m' }); typing = h('div', { class: 'ec-t', text: '' });
    var inp = h('input', { type: 'text', placeholder: 'Write a message…' });
    var file = h('input', { type: 'file', accept: 'image/*', style: 'display:none' }), pl = h('label', { title: 'Send a photo', text: '📷' }); pl.appendChild(file);
    var mic = h('button', { type: 'button', title: 'Hold for a voice note', text: '🎤' });
    var send = h('button', { type: 'button', class: 'send', title: 'Send', text: '➤', style: 'background:' + info.colour });
    function sendText() { var t = inp.value.trim(); if (!t) return; inp.value = ''; put({ mine: true, kind: 'text', text: t }); call('send', { visitor: st.visitor, token: st.token, text: t }).then(check); }
    send.onclick = sendText; inp.onkeydown = function (e) { if (e.key === 'Enter') sendText(); };
    file.onchange = function () { var f = file.files[0]; if (!f) return; shrink(f, function (d) { put({ mine: true, kind: 'image', image: d }); call('send', { visitor: st.visitor, token: st.token, image: d.split(',')[1], mime: 'image/jpeg' }).then(check); }); file.value = ''; };
    var mr = null, chunks = [];
    mic.onpointerdown = function () { if (!navigator.mediaDevices || !window.MediaRecorder) return; navigator.mediaDevices.getUserMedia({ audio: true }).then(function (s) { chunks = []; mr = new MediaRecorder(s); mr.ondataavailable = function (e) { chunks.push(e.data); };
      mr.onstop = function () { s.getTracks().forEach(function (t) { t.stop(); }); var b = new Blob(chunks, { type: mr.mimeType || 'audio/webm' }); if (b.size < 1500) return; var rd = new FileReader(); rd.onload = function () { put({ mine: true, kind: 'text', text: '🎤 Voice note' }); call('send', { visitor: st.visitor, token: st.token, audio: String(rd.result).split(',')[1], mime: b.type }).then(check); }; rd.readAsDataURL(b); };
      mr.start(); mic.textContent = '●'; }).catch(function () {}); };
    mic.onpointerup = mic.onpointerleave = function () { if (mr && mr.state === 'recording') { mr.stop(); mic.textContent = '🎤'; } };
    shell([box, typing, h('div', { class: 'ec-i' }, [pl, mic, inp, send]), h('div', { class: 'ec-ai', text: 'You are chatting with an AI assistant.' })]);
    after = 0; fresh = true; poll();
  }
  function check(r) { if (r && r.ok === false && r.error) put({ mine: false, kind: 'text', text: r.error }); if (r && /Start the chat again/.test(r.error || '')) { st = {}; save(); startForm(); } poll(); }
  function shrink(f, cb) { var rd = new FileReader(); rd.onload = function () { var im = new Image(); im.onload = function () { var k = Math.min(1, 1400 / Math.max(im.width, im.height)), c = document.createElement('canvas'); c.width = Math.round(im.width * k); c.height = Math.round(im.height * k); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); cb(c.toDataURL('image/jpeg', 0.85)); }; im.src = rd.result; }; rd.readAsDataURL(f); }
  function put(m) {
    if (!box) return;
    var d = h('div', { class: 'ec-x ' + (m.mine ? 'me' : 'it'), style: m.mine ? 'background:' + info.colour : '' });
    if (m.image) d.appendChild(h('img', { src: m.image, alt: '' }));
    if (m.cards && m.cards.length) { var cs = h('div', { class: 'ec-cards' }); m.cards.forEach(function (c) { var cd = h('div', { class: 'ec-card' }); if (c.image) cd.appendChild(h('img', { src: c.image, alt: '' })); var t = h('div'); t.appendChild(h('b', { text: c.title })); t.appendChild(h('div', { text: c.subtitle })); cd.appendChild(t); cs.appendChild(cd); }); d.appendChild(cs); }
    if (m.text) d.appendChild(document.createTextNode(m.text));
    if (m.buttons && m.buttons.length) { var o = h('div', { class: 'ec-opts' }); m.buttons.forEach(function (b) { var bb = h('button', { type: 'button', text: b }); bb.onclick = function () { put({ mine: true, kind: 'text', text: b }); call('send', { visitor: st.visitor, token: st.token, text: b }).then(check); }; o.appendChild(bb); }); d.appendChild(o); }
    box.appendChild(d); box.scrollTop = box.scrollHeight;
    if (calling && !m.mine && m.text && m.id > lastSpoken) { lastSpoken = m.id; speak(m.text); }
  }
  function poll() {
    clearTimeout(timer); if (!open || !st.visitor) return;
    call('poll', { visitor: st.visitor, token: st.token, after: after }).then(function (r) {
      if (r && r.ok) { var first = fresh; fresh = false; (r.msgs || []).forEach(function (m) { if (m.id <= after) return; after = m.id; if (first || !m.mine) put(m); }); typing.textContent = r.typing ? (info.name + ' is typing…') : r.person ? 'A person from the team is looking at this.' : ''; }
      else if (r && /Start the chat again/.test(r.error || '')) { st = {}; save(); startForm(); return; }
      timer = setTimeout(poll, r && r.typing ? 1500 : 3000);
    });
  }
  // the voice call: the browser hears the visitor, the answers are spoken back (Bangla when the page says so)
  function speak(t) { try { var u = new SpeechSynthesisUtterance(t.replace(/[\u{1F300}-\u{1FAFF}]/gu, '')); u.lang = /[ঀ-৿]/.test(t) ? 'bn-BD' : 'en-US'; speechSynthesis.speak(u); } catch (e) {} }
  function toggleCall() {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition; if (!SR) return;
    calling = !calling; lastSpoken = after;
    if (calling) {
      rec = new SR(); rec.lang = (document.documentElement.lang || '').indexOf('en') === 0 ? 'en-US' : 'bn-BD'; rec.continuous = true; rec.interimResults = false;
      rec.onresult = function (e) { var t = e.results[e.results.length - 1][0].transcript.trim(); if (!t) return; put({ mine: true, kind: 'text', text: '🗣️ ' + t }); call('send', { visitor: st.visitor, token: st.token, text: t }).then(check); };
      rec.onend = function () { if (calling) try { rec.start(); } catch (e) {} };
      try { rec.start(); } catch (e) {}
    } else { try { rec.stop(); } catch (e) {} try { speechSynthesis.cancel(); } catch (e) {} }
    chat();
  }
  function setOpen(v) { open = v; panel.classList.toggle('on', v); if (v) { if (st.visitor) chat(); else startForm(); } else clearTimeout(timer); }
  btn.onclick = function () { setOpen(!open); };
  fetch(API + (API.indexOf('?') >= 0 ? '&' : '?') + 'a=info', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).then(function (r) { return r.json(); })
    .then(function (r) { if (r && r.ok) { info = r; colourise(); if (!r.open) btn.style.display = 'none'; } }).catch(function () {});
  colourise();
})();
