import fs from 'node:fs'; import * as acorn from 'acorn';
const html = fs.readFileSync(process.argv[2] || 'G:/costareen-erp/web/app.html', 'utf8');
const re = /<script>([\s\S]*?)<\/script>/g; let m, n = 0, bad = 0;
while ((m = re.exec(html))) { n++; try { acorn.parse(m[1], { ecmaVersion: 2022 }); } catch (e) { bad++; const line = html.slice(0, m.index + 8 + e.pos).split('\n').length; console.log('SYNTAX ERROR at line', line, e.message); } }
console.log(n, 'script blocks,', bad, 'with errors');
