// Each person's screen language is kept with their login.
import { sql, owner, mgr, check, done } from './harness.mjs';
let r = await owner('erpSetLang', ['fr']);
check('only English or Bangla', !r.ok, r);
r = await owner('erpSetLang', ['bn']);
check('Bangla saved', r.ok && r.result.lang === 'bn', r);
r = await owner('erpBusinesses', []);
check('...and handed back with the business list', r.ok && r.result.lang === 'bn', r.result && r.result.lang);
r = await mgr('erpBusinesses', []);
check('another person keeps their own (none yet)', r.ok && r.result.lang === '', r.result && r.result.lang);
await owner('erpSetLang', ['en']);
r = await owner('erpBusinesses', []);
check('back to English', r.result.lang === 'en');
await done();
