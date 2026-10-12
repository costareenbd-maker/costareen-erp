// Stage 1e: the published page is minified - every inline script and style block, the HTML comments,
// and the game files. The source (web/app.html, web/games/*.js) stays readable; only what is published changes.
//   node deploy/minify.mjs <file.html> [<game.js> ...]     (in place)
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, '.tools', 'package.json'));
const esbuild = require('esbuild');

// top-level names are kept: the page's script blocks call each other's functions by name
const js = (code) => esbuild.transformSync(code, { loader: 'js', minify: true, charset: 'utf8', legalComments: 'none', target: 'es2017' }).code.trim();
const css = (code) => esbuild.transformSync(code, { loader: 'css', minify: true, charset: 'utf8', legalComments: 'none', target: 'chrome80' }).code.trim();
// HTML comments go only from the HTML between blocks: comment-like text inside a script's strings must stay
const html = (t) => t.replace(/<!--(?!\[if)[\s\S]*?-->/g, '');

for (const file of process.argv.slice(2)) {
  const s = readFileSync(file, 'utf8');
  const before = s.length;
  if (/\.js$/.test(file)) { writeFileSync(file, js(s)); console.log('minified', file, before, '->', readFileSync(file, 'utf8').length); continue; }
  let blocks = 0, out = '', pos = 0;
  const re = /<(script|style)(\s[^>]*)?>([\s\S]*?)<\/\1>/gi;
  for (let m; (m = re.exec(s));) {
    const [all, tag, attrs, body] = m;
    out += html(s.slice(pos, m.index));
    pos = m.index + all.length;
    if (tag.toLowerCase() === 'style') { out += '<style' + (attrs || '') + '>' + css(body) + '</style>'; continue; }
    if (attrs && /\bsrc\s*=/.test(attrs)) { out += all; continue; }                                   // a library from elsewhere
    if (attrs && /type\s*=\s*["'](?!text\/javascript|module)/i.test(attrs)) { out += all; continue; }  // data blocks
    if (!body.trim()) { out += all; continue; }
    blocks++;
    out += '<script' + (attrs || '') + '>' + js(body) + '</script>';
  }
  out += html(s.slice(pos));
  writeFileSync(file, out);
  console.log('minified', file, before, '->', out.length, 'bytes,', blocks, 'script blocks');
}
