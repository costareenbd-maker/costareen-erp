// Colour maths for the Colour Finder (Stage N5b). Plain script for the page; also loadable in Node for the tests.
// sRGB (D65) -> CIELAB and the CIEDE2000 colour difference, written from the published formulas
// (Sharma, Wu, Dalal 2005). Nothing here is exact science on a phone camera: the page always says "closest".
(function (root) {
  function parseHex(h) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(h || '').trim());
    if (!m) return null;
    var n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function toHex(rgb) { return '#' + rgb.map(function (v) { v = Math.max(0, Math.min(255, Math.round(v))); return (v < 16 ? '0' : '') + v.toString(16); }).join(''); }
  function lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  function delin(c) { c = Math.max(0, Math.min(1, c)); return 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055); }
  function rgbToLab(rgb) {
    var r = lin(rgb[0]), g = lin(rgb[1]), b = lin(rgb[2]);
    var x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047, y = (0.2126729 * r + 0.7151522 * g + 0.0721750 * b) / 1.0, z = (0.0193339 * r + 0.1191920 * g + 0.9503041 * b) / 1.08883;
    var f = function (t) { return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116; };
    var fx = f(x), fy = f(y), fz = f(z);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  }
  var hexToLab = function (h) { var rgb = parseHex(h); return rgb ? rgbToLab(rgb) : null; };
  /** CIEDE2000 between two Lab colours (kL = kC = kH = 1). */
  function deltaE2000(lab1, lab2) {
    var L1 = lab1[0], a1 = lab1[1], b1 = lab1[2], L2 = lab2[0], a2 = lab2[1], b2 = lab2[2];
    var rad = Math.PI / 180, deg = 180 / Math.PI;
    var C1 = Math.sqrt(a1 * a1 + b1 * b1), C2 = Math.sqrt(a2 * a2 + b2 * b2), Cbar = (C1 + C2) / 2;
    var G = 0.5 * (1 - Math.sqrt(Math.pow(Cbar, 7) / (Math.pow(Cbar, 7) + Math.pow(25, 7))));
    var a1p = (1 + G) * a1, a2p = (1 + G) * a2;
    var C1p = Math.sqrt(a1p * a1p + b1 * b1), C2p = Math.sqrt(a2p * a2p + b2 * b2);
    var h1p = (a1p === 0 && b1 === 0) ? 0 : Math.atan2(b1, a1p) * deg; if (h1p < 0) h1p += 360;
    var h2p = (a2p === 0 && b2 === 0) ? 0 : Math.atan2(b2, a2p) * deg; if (h2p < 0) h2p += 360;
    var dLp = L2 - L1, dCp = C2p - C1p, dhp;
    if (C1p * C2p === 0) dhp = 0;
    else if (Math.abs(h2p - h1p) <= 180) dhp = h2p - h1p;
    else if (h2p - h1p > 180) dhp = h2p - h1p - 360;
    else dhp = h2p - h1p + 360;
    var dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(dhp / 2 * rad);
    var Lbp = (L1 + L2) / 2, Cbp = (C1p + C2p) / 2, hbp;
    if (C1p * C2p === 0) hbp = h1p + h2p;
    else if (Math.abs(h1p - h2p) <= 180) hbp = (h1p + h2p) / 2;
    else if (h1p + h2p < 360) hbp = (h1p + h2p + 360) / 2;
    else hbp = (h1p + h2p - 360) / 2;
    var T = 1 - 0.17 * Math.cos((hbp - 30) * rad) + 0.24 * Math.cos(2 * hbp * rad) + 0.32 * Math.cos((3 * hbp + 6) * rad) - 0.20 * Math.cos((4 * hbp - 63) * rad);
    var dTheta = 30 * Math.exp(-Math.pow((hbp - 275) / 25, 2));
    var RC = 2 * Math.sqrt(Math.pow(Cbp, 7) / (Math.pow(Cbp, 7) + Math.pow(25, 7)));
    var SL = 1 + 0.015 * Math.pow(Lbp - 50, 2) / Math.sqrt(20 + Math.pow(Lbp - 50, 2)), SC = 1 + 0.045 * Cbp, SH = 1 + 0.015 * Cbp * T;
    var RT = -Math.sin(2 * dTheta * rad) * RC;
    return Math.sqrt(Math.pow(dLp / SL, 2) + Math.pow(dCp / SC, 2) + Math.pow(dHp / SH, 2) + RT * (dCp / SC) * (dHp / SH));
  }
  /** Grey-world white balance against a sampled reference that should be white: rgb and ref are 0..255 sRGB. */
  function whiteBalance(rgb, ref) {
    var lr = [lin(rgb[0]), lin(rgb[1]), lin(rgb[2])], lw = [lin(ref[0]), lin(ref[1]), lin(ref[2])];
    var m = Math.max(lw[0], lw[1], lw[2], 0.02);
    var out = lr.map(function (v, i) { var w = Math.max(lw[i], 0.02); return delin(v * (m / w) / Math.max(m, 0.35) * 0.92); });
    return out;
  }
  function labelFor(dE) { return dE < 6 ? 'very close' : dE < 13 ? 'close' : 'roughly'; }
  /** The closest candidates to a sampled colour. candidates: [{hex, ...}]. Returns [{...candidate, dE, label}] sorted. */
  function closest(rgb, candidates, n) {
    var lab = rgbToLab(rgb);
    return candidates.map(function (c) { var l = c.lab || hexToLab(c.hex); if (!l) return null; var d = deltaE2000(lab, l); return Object.assign({}, c, { dE: Math.round(d * 10) / 10, label: labelFor(d) }); })
      .filter(Boolean).sort(function (a, b) { return a.dE - b.dE; }).slice(0, n || 3);
  }
  var COLOUR = { parseHex: parseHex, toHex: toHex, rgbToLab: rgbToLab, hexToLab: hexToLab, deltaE2000: deltaE2000, whiteBalance: whiteBalance, labelFor: labelFor, closest: closest };
  root.COLOUR = COLOUR;
  if (typeof module !== 'undefined' && module.exports) module.exports = COLOUR;
})(typeof window !== 'undefined' ? window : globalThis);
