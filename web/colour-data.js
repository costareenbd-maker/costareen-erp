// Colour names as shops write them on filament products -> a representative sRGB value, for the Colour Finder
// (Stage N5b). Only used when a shop has not set its own swatch for that colour (Market > What I share > Colour
// swatches). Finishes (silk, matte, glitter, rainbow, transparent) change how a colour looks far more than these
// values can say - the page marks them "roughly" at best. English and Bangla names, matched loosely.
var COLOUR_NAMES = [
  { hex: '#1c1c1c', names: ['black', 'jet black', 'matte black', 'galaxy black', 'কালো'] },
  { hex: '#f4f4f1', names: ['white', 'pure white', 'cold white', 'matte white', 'সাদা'] },
  { hex: '#efe6d0', names: ['warm white', 'ivory', 'cream', 'bone white', 'off white', 'ক্রিম'] },
  { hex: '#8c8c8c', names: ['grey', 'gray', 'ধূসর', 'ছাই'] },
  { hex: '#4a4a4a', names: ['dark grey', 'dark gray', 'space grey', 'space gray', 'charcoal', 'graphite'] },
  { hex: '#c0c0c0', names: ['light grey', 'light gray', 'silver', 'silver grey', 'রুপালি'] },
  { hex: '#d8d8d8', names: ['silk silver', 'metallic silver'] },
  { hex: '#d42a2a', names: ['red', 'bright red', 'fire red', 'লাল'] },
  { hex: '#9b1c2e', names: ['dark red', 'wine', 'maroon', 'burgundy', 'crimson', 'মেরুন'] },
  { hex: '#ff6b7a', names: ['coral', 'salmon'] },
  { hex: '#f28c28', names: ['orange', 'কমলা'] },
  { hex: '#ffb347', names: ['light orange', 'apricot', 'peach'] },
  { hex: '#f5d327', names: ['yellow', 'bright yellow', 'হলুদ'] },
  { hex: '#f0e68c', names: ['light yellow', 'lemon', 'pale yellow'] },
  { hex: '#d4a017', names: ['mustard', 'gold yellow', 'dark yellow'] },
  { hex: '#2e9e4f', names: ['green', 'grass green', 'সবুজ'] },
  { hex: '#1d6b3a', names: ['dark green', 'forest green', 'army green', 'olive green', 'olive'] },
  { hex: '#8fd14f', names: ['light green', 'lime', 'lime green', 'apple green', 'fluorescent green', 'neon green'] },
  { hex: '#20b2aa', names: ['teal', 'turquoise', 'aqua', 'cyan', 'mint'] },
  { hex: '#2b6fd6', names: ['blue', 'royal blue', 'নীল'] },
  { hex: '#1b3a7a', names: ['dark blue', 'navy', 'navy blue', 'midnight blue', 'গাঢ় নীল'] },
  { hex: '#6ab4f0', names: ['sky blue', 'light blue', 'baby blue', 'আকাশি'] },
  { hex: '#a7d8f0', names: ['ice blue', 'pale blue', 'translucent blue'] },
  { hex: '#6a3fb5', names: ['purple', 'violet', 'বেগুনি'] },
  { hex: '#b48cf0', names: ['lavender', 'lilac', 'light purple'] },
  { hex: '#e84393', names: ['pink', 'hot pink', 'magenta', 'fuchsia', 'গোলাপি'] },
  { hex: '#f7b7d2', names: ['light pink', 'baby pink', 'rose', 'pale pink'] },
  { hex: '#7a4a2b', names: ['brown', 'chocolate', 'বাদামি', 'খয়েরি'] },
  { hex: '#c19a6b', names: ['wood', 'light brown', 'tan', 'khaki', 'beige', 'sand', 'কাঠ'] },
  { hex: '#e8c39e', names: ['skin', 'skin tone', 'flesh', 'nude'] },
  { hex: '#d4af37', names: ['gold', 'silk gold', 'metallic gold', 'সোনালি'] },
  { hex: '#b87333', names: ['copper', 'silk copper', 'bronze', 'তামা'] },
  { hex: '#e6e6e6', names: ['transparent', 'clear', 'natural', 'translucent', 'স্বচ্ছ'] },
  { hex: '#d7e4c0', names: ['glow', 'glow in the dark', 'luminous'] },
  { hex: '#9c6bd6', names: ['rainbow', 'multicolour', 'multicolor', 'dual colour', 'dual color', 'tri colour', 'gradient'] },
  { hex: '#bfb6a8', names: ['marble', 'granite', 'stone', 'concrete'] }
];
/** The sRGB hex for a colour as written on a product (loose: "Silk Gold 1kg" -> gold), or '' when unknown. */
function colourHexFor(name) {
  var n = String(name || '').toLowerCase().replace(/[^a-z0-9ঀ-৿ ]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!n) return '';
  var best = null, bestLen = 0;
  for (var i = 0; i < COLOUR_NAMES.length; i++) {
    var c = COLOUR_NAMES[i];
    for (var j = 0; j < c.names.length; j++) {
      var k = c.names[j];
      if ((n === k || n.indexOf(k) >= 0) && k.length > bestLen) { best = c.hex; bestLen = k.length; }
    }
  }
  return best || '';
}
if (typeof module !== 'undefined' && module.exports) module.exports = { COLOUR_NAMES: COLOUR_NAMES, colourHexFor: colourHexFor };
