/*
 * Brawl: a pixel head from a photo, made in the browser (no AI, nothing leaves the device until it is saved).
 *   ERP_FACE_FIND(rgba, w, h)            -> {x, y, w, h}  a head box guessed from the skin area (fallback: the middle)
 *   ERP_FACE_PIX(rgba, w, h, box, cut)   -> {w: 28, h: 34, pal: ['#rrggbb'], px}  same format as the other fighters
 *     cut 0..1: how hard the background is cut away (0.5 normal)
 * Steps: the box plus a margin is read small; the colours along the margin are the background; a flood from the
 * margin eats pixels that look like the background and have no edge in between; the middle of the face is never cut;
 * the biggest piece stays, holes are filled; then 28x34 pixels, 12 colours, a dark outline.
 */
(function () {
  var HW = 28, HH = 34;
  function rgb(d, i) { return [d[i], d[i + 1], d[i + 2]]; }
  // a quick Lab, so "looks alike" is closer to what the eye sees
  function lab(r, g, b) {
    function f(c) { c /= 255; return c > 0.04045 ? Math.pow((c + 0.055) / 1.055, 2.4) : c / 12.92; }
    var R = f(r), G = f(g), B = f(b);
    var X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047, Y = R * 0.2126 + G * 0.7152 + B * 0.0722, Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
    function h(t) { return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116; }
    var fx = h(X), fy = h(Y), fz = h(Z);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  }
  function d2(a, b) { var x = a[0] - b[0], y = a[1] - b[1], z = a[2] - b[2]; return x * x + y * y + z * z; }
  function kmeans(pts, k, it) {
    if (!pts.length) return [];
    var c = []; for (var i = 0; i < k; i++) c.push(pts[Math.floor((i + 0.5) * pts.length / k)].slice());
    for (var n = 0; n < (it || 8); n++) {
      var s = c.map(function () { return [0, 0, 0, 0]; });
      pts.forEach(function (p) { var bi = 0, bd = 1e18; for (var j = 0; j < c.length; j++) { var dd = d2(p, c[j]); if (dd < bd) { bd = dd; bi = j; } } var t = s[bi]; t[0] += p[0]; t[1] += p[1]; t[2] += p[2]; t[3]++; });
      c = s.filter(function (t) { return t[3]; }).map(function (t) { return [t[0] / t[3], t[1] / t[3], t[2] / t[3]]; });
    }
    return c;
  }
  // read a part of the photo at a smaller size (area average)
  function sample(rgba, w, h, x0, y0, sw, sh, ow, oh) {
    var out = new Float32Array(ow * oh * 3), sx = sw / ow, sy = sh / oh;
    for (var y = 0; y < oh; y++) for (var x = 0; x < ow; x++) {
      var ax = x0 + x * sx, ay = y0 + y * sy, r = 0, g = 0, b = 0, n = 0;
      var xs = Math.max(1, Math.round(sx)), ys = Math.max(1, Math.round(sy));
      for (var yy = 0; yy < ys; yy++) for (var xx = 0; xx < xs; xx++) {
        var px = Math.min(w - 1, Math.max(0, Math.floor(ax + xx * sx / xs))), py = Math.min(h - 1, Math.max(0, Math.floor(ay + yy * sy / ys)));
        var i = (py * w + px) * 4; r += rgba[i]; g += rgba[i + 1]; b += rgba[i + 2]; n++;
      }
      var o = (y * ow + x) * 3; out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n;
    }
    return out;
  }

  // backup for busy backgrounds (trees, rooms): the biggest skin-coloured piece that is not a wall
  function bySkin(im, ow, oh) {
    var N = ow * oh, skin = new Uint8Array(N), lab2 = new Int32Array(N), best = null, id = 0;
    for (var i = 0; i < N; i++) {
      var r = im[i * 3], g = im[i * 3 + 1], b = im[i * 3 + 2];
      var cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b, cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
      skin[i] = cb >= 77 && cb <= 127 && cr >= 135 && cr <= 175 && r > 60 && r > b ? 1 : 0;
    }
    for (var s0 = 0; s0 < N; s0++) {
      if (!skin[s0] || lab2[s0]) continue;
      id++; var st = [s0], n = 0, x0 = ow, x1 = 0, y0 = oh, y1 = 0, sx = 0, sy = 0; lab2[s0] = id;
      while (st.length) {
        var p = st.pop(), px = p % ow, py = (p - px) / ow; n++; sx += px; sy += py;
        if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py;
        [p - 1, p + 1, p - ow, p + ow].forEach(function (q) { if (q < 0 || q >= N || lab2[q] || !skin[q]) return; if (Math.abs((q % ow) - px) > 1) return; lab2[q] = id; st.push(q); });
      }
      var wide = x1 - x0 + 1 > ow * 0.62 || (x0 === 0 && x1 === ow - 1) || (y0 === 0 && (x0 === 0 || x1 === ow - 1));
      var score = wide ? 0 : n * (sy / n < oh * 0.75 ? 1 : 0.3) * (1 - Math.abs(sx / n - ow / 2) / ow);
      if (score > 0 && (!best || score > best.score)) best = { score: score, n: n, x0: x0, x1: x1, y0: y0, y1: y1, cx: sx / n };
    }
    if (!best || best.n < N * 0.015) return null;
    var bw = Math.min(ow, (best.x1 - best.x0 + 1) * 1.8);
    return { bx: best.cx - bw / 2, by: best.y0 - bw * HH / HW * 0.2, bw: bw };
  }

  window.ERP_FACE_FIND = function (rgba, w, h) {
    // the person against the background: the background colours come from the top and side edges; the top of the
    // hair is the first row with enough person in it; the head is as wide as its widest row above the neck
    var k = Math.min(1, 160 / Math.max(w, h)), ow = Math.max(8, Math.round(w * k)), oh = Math.max(8, Math.round(h * k)), N = ow * oh;
    var im = sample(rgba, w, h, 0, 0, w, h, ow, oh), L = new Array(N), ring = [];
    for (var i = 0; i < N; i++) L[i] = lab(im[i * 3], im[i * 3 + 1], im[i * 3 + 2]);
    for (var y = 0; y < oh; y++) for (var x = 0; x < ow; x++) if (y < 3 || x < 3 || x >= ow - 3) ring.push(L[y * ow + x]);
    var bg = kmeans(ring, 6, 8), fg = new Uint8Array(N);
    for (i = 0; i < N; i++) { var m = 1e18; for (var j = 0; j < bg.length; j++) { var dd = d2(L[i], bg[j]); if (dd < m) m = dd; } fg[i] = m > 12 * 12 ? 1 : 0; }
    // shave specks: a person pixel needs 5 of its 9 neighbours
    var f2 = new Uint8Array(N);
    for (y = 1; y < oh - 1; y++) for (x = 1; x < ow - 1; x++) { var c = 0; for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) c += fg[(y + dy) * ow + x + dx]; f2[y * ow + x] = c >= 5 ? 1 : 0; }
    // each row: where the person starts and ends (the middle third must hold some of it)
    var top = -1, sp = [], cxs = [];
    for (y = 0; y < oh; y++) {
      var a = -1, b = -1, n = 0;
      for (x = Math.round(ow * 0.08); x < ow - Math.round(ow * 0.08); x++) if (f2[y * ow + x]) { if (a < 0) a = x; b = x; n++; }
      sp.push(n > 1 ? b - a + 1 : 0); cxs.push(n > 1 ? (a + b) / 2 : ow / 2);
      if (top < 0 && n > ow * 0.06 && Math.abs((a + b) / 2 - ow / 2) < ow * 0.3) top = y;
    }
    var bw, bx, by, sk = top <= 1 || top > oh * 0.6 ? bySkin(im, ow, oh) : null;
    if (sk) { bw = sk.bw; bx = sk.bx; by = sk.by; }
    else if (top < 0 || top > oh * 0.6) { bw = Math.min(ow * 0.52, oh * 0.62 * HW / HH); bx = (ow - bw) / 2; by = oh * 0.07; }
    else {
      // walk down: the widest row so far is the head; a narrowing (neck) then widening (shoulders) ends it
      var M = 0, low = 1e9, neck = -1, sx = 0, sn = 0;
      for (y = top; y < Math.min(oh, top + oh * 0.75); y++) {
        var s = 0, sc = 0; for (var q = Math.max(top, y - 2); q <= Math.min(oh - 1, y + 2); q++) { s += sp[q]; sc++; } s /= sc;   // smoothed over 5 rows
        sx += cxs[y]; sn++;
        if (y - top < Math.max(M * 0.75, ow * 0.08)) { M = Math.max(M, s); continue; }   // still in the upper head: it only gets wider
        low = Math.min(low, s);
        if (low < M * 0.9 && s > low * 1.25) { neck = y; break; }
        if (low >= M * 0.9) M = Math.max(M, s);
      }
      if (M < ow * 0.12) M = ow * 0.3;
      if (neck < 0 && M > ow * 0.62) M = ow * 0.5;   // no neck seen: a guess
      bw = Math.min(ow, M * 1.14); bx = sx / sn - bw / 2; by = top - bw * HH / HW * 0.04;
    }
    var bh = bw * HH / HW;
    if (bh > oh) { bh = oh; bw = bh * HW / HH; }
    bx = Math.max(0, Math.min(ow - bw, bx)); by = Math.max(0, Math.min(oh - bh, by));
    return { x: bx / k, y: by / k, w: bw / k, h: bh / k };
  };

  window.ERP_FACE_PIX = function (rgba, w, h, box, cut) {
    cut = cut === undefined ? 0.5 : Math.max(0, Math.min(1, cut));
    // the box with a margin round it (the margin tells what the background is)
    var mx = box.w * 0.14, my = box.h * 0.08;
    var X0 = box.x - mx, Y0 = box.y - my, EW = box.w + 2 * mx, EH = box.h + 2 * my;
    var ow = 150, oh = Math.round(ow * EH / EW), N = ow * oh;
    var im = sample(rgba, w, h, X0, Y0, EW, EH, ow, oh), L = new Array(N);
    for (var i = 0; i < N; i++) L[i] = lab(im[i * 3], im[i * 3 + 1], im[i * 3 + 2]);
    // background colours: the margin ring (outside the photo counts as nothing)
    var ring = [], bm = Math.round(ow * mx / EW), tm = Math.round(oh * my / EH);
    for (var y = 0; y < oh; y++) for (var x = 0; x < ow; x++) {
      var edge = x < Math.max(2, bm * 0.7) || x >= ow - Math.max(2, bm * 0.7) || y < Math.max(2, tm * 0.7);
      if (!edge) continue;
      var rx = X0 + x * EW / ow, ry = Y0 + y * EH / oh;
      if (rx < 0 || ry < 0 || rx >= w || ry >= h) continue;
      ring.push(L[y * ow + x]);
    }
    var bg = kmeans(ring.length ? ring : [L[0]], 6, 8);
    function dbg(p) { var m = 1e18; for (var j = 0; j < bg.length; j++) { var dd = d2(p, bg[j]); if (dd < m) m = dd; } return Math.sqrt(m); }
    // the middle of the face is never cut
    var cx = ow / 2, cy = oh * 0.53, crx = ow * (box.w / EW) * 0.30, cry = oh * (box.h / EH) * 0.34;
    function core(x, y) { var a = (x - cx) / crx, b = (y - cy) / cry; return a * a + b * b < 1; }
    var T1 = 3 + cut * 25, T2 = 3 + cut * 11;
    var gone = new Uint8Array(N), st = [];
    function seed(x, y) { var p = y * ow + x; if (!gone[p] && !core(x, y)) { var rx = X0 + x * EW / ow, ry = Y0 + y * EH / oh; if (rx < 0 || ry < 0 || rx >= w || ry >= h || dbg(L[p]) < T1 * 1.4) { gone[p] = 1; st.push(p); } } }
    for (var x2 = 0; x2 < ow; x2++) { seed(x2, 0); seed(x2, oh - 1); }
    for (var y2 = 0; y2 < oh; y2++) { seed(0, y2); seed(ow - 1, y2); }
    while (st.length) {
      var p = st.pop(), px = p % ow, py = (p - px) / ow;
      for (var k = 0; k < 4; k++) {
        var qx = px + (k === 0 ? 1 : k === 1 ? -1 : 0), qy = py + (k === 2 ? 1 : k === 3 ? -1 : 0);
        if (qx < 0 || qy < 0 || qx >= ow || qy >= oh) continue;
        var q = qy * ow + qx; if (gone[q] || core(qx, qy)) continue;
        var db = dbg(L[q]), step = Math.sqrt(d2(L[q], L[p]));
        if (db < T1 * 0.55 || (db < T1 && step < T2) || (db < T1 * 1.6 && step < T2 * 0.4)) { gone[q] = 1; st.push(q); }
      }
    }
    // the body under the head goes too: below the box everything outside the neck column is cut
    // tidy: open (shave thin bits), keep the piece holding the middle, fill holes
    var keep = new Uint8Array(N); for (i = 0; i < N; i++) keep[i] = gone[i] ? 0 : 1;
    function morph(a, grow) {
      var o = new Uint8Array(N);
      for (var y = 0; y < oh; y++) for (var x = 0; x < ow; x++) {
        var v = grow ? 0 : 1;
        for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
          var xx = x + dx, yy = y + dy, t = xx < 0 || yy < 0 || xx >= ow || yy >= oh ? 0 : a[yy * ow + xx];
          if (grow && t) v = 1; if (!grow && !t) v = 0;
        }
        o[y * ow + x] = v;
      }
      return o;
    }
    keep = morph(morph(keep, false), true);
    var mark = new Uint8Array(N), s2 = [Math.round(cy) * ow + Math.round(cx)]; mark[s2[0]] = 1; keep[s2[0]] = 1;
    while (s2.length) { var p2 = s2.pop(), x3 = p2 % ow; [p2 - 1, p2 + 1, p2 - ow, p2 + ow].forEach(function (q) { if (q < 0 || q >= N || mark[q] || !keep[q] || Math.abs((q % ow) - x3) > 1) return; mark[q] = 1; s2.push(q); }); }
    var out = new Uint8Array(N), s3 = [];
    for (i = 0; i < N; i++) { var xi = i % ow, yi = (i - xi) / ow; if ((xi === 0 || yi === 0 || xi === ow - 1 || yi === oh - 1) && !mark[i]) { out[i] = 1; s3.push(i); } }
    while (s3.length) { var p3 = s3.pop(), x4 = p3 % ow; [p3 - 1, p3 + 1, p3 - ow, p3 + ow].forEach(function (q) { if (q < 0 || q >= N || out[q] || mark[q] || Math.abs((q % ow) - x4) > 1) return; out[q] = 1; s3.push(q); }); }
    // out = background reached from the edge; everything else is the head (holes filled)
    // now 28x34 inside the box
    var bx0 = mx / EW * ow, by0 = my / EH * oh, bw = box.w / EW * ow, bh = box.h / EH * oh;
    var cols = [], alpha = [];
    for (var Y = 0; Y < HH; Y++) for (var X = 0; X < HW; X++) {
      var r = 0, g = 0, b = 0, n = 0, a = 0, tot = 0;
      for (var yy = by0 + Y * bh / HH; yy < by0 + (Y + 1) * bh / HH; yy += 1) for (var xx = bx0 + X * bw / HW; xx < bx0 + (X + 1) * bw / HW; xx += 1) {
        var pi = Math.min(oh - 1, Math.floor(yy)) * ow + Math.min(ow - 1, Math.floor(xx)); tot++;
        if (out[pi]) continue; a++; r += im[pi * 3]; g += im[pi * 3 + 1]; b += im[pi * 3 + 2]; n++;
      }
      var on = tot && a / tot > 0.45;
      alpha.push(on);
      if (on) {   // a little more contrast, like the other heads
        var c = [r / n, g / n, b / n].map(function (v) { return Math.max(0, Math.min(255, (v - 128) * 1.12 + 128 - 6)); });
        cols.push(c);
      } else cols.push(null);
    }
    // 12 colours (median cut)
    var pts = cols.filter(Boolean), boxes = [pts];
    while (boxes.length < 12) {
      var bi = -1, br = -1, bc = 0;
      boxes.forEach(function (bxs, j) { if (bxs.length < 2) return; for (var c2 = 0; c2 < 3; c2++) { var lo = 1e9, hi = -1e9; bxs.forEach(function (q) { if (q[c2] < lo) lo = q[c2]; if (q[c2] > hi) hi = q[c2]; }); if (hi - lo > br) { br = hi - lo; bi = j; bc = c2; } } });
      if (bi < 0 || br < 4) break;
      var bb = boxes[bi].slice().sort(function (u, v) { return u[bc] - v[bc]; }), m = bb.length >> 1;
      boxes.splice(bi, 1, bb.slice(0, m), bb.slice(m));
    }
    var pal = boxes.filter(function (q) { return q.length; }).map(function (q) { var s = [0, 0, 0]; q.forEach(function (c3) { s[0] += c3[0]; s[1] += c3[1]; s[2] += c3[2]; }); return [s[0] / q.length, s[1] / q.length, s[2] / q.length]; });
    function hex(c4) { return '#' + c4.map(function (v) { var t = Math.round(v).toString(16); return t.length < 2 ? '0' + t : t; }).join(''); }
    var OUT = pal.length, palHex = pal.map(hex).concat(['#141016']), px = '';
    for (i = 0; i < HW * HH; i++) {
      var X5 = i % HW, Y5 = (i - X5) / HW;
      if (cols[i]) { var bj = 0, bd = 1e18; for (var j2 = 0; j2 < pal.length; j2++) { var dd2 = d2(cols[i], pal[j2]); if (dd2 < bd) { bd = dd2; bj = j2; } } px += '0123456789abcdef'[bj]; continue; }
      var near = (X5 > 0 && alpha[i - 1]) || (X5 < HW - 1 && alpha[i + 1]) || (Y5 > 0 && alpha[i - HW]) || (Y5 < HH - 1 && alpha[i + HW]);
      px += near ? '0123456789abcdef'[OUT] : '.';
    }
    return { w: HW, h: HH, pal: palHex, px: px };
  };
})();
