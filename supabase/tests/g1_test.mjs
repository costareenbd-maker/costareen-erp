// Game under New invoice: the owner decides who sees it (default: only the owner).
import { owner, mgr, sales, check, done } from './harness.mjs';
let r = await owner('erpGame', []);
check('default: the owner sees it', r.ok && r.result.who === 'owner' && r.result.on, r);
r = await sales('erpGame', []);
check('default: staff do not', r.ok && !r.result.on, r);
r = await mgr('erpGameSet', [{ who: 'all' }]);
check('only the owner changes it', !r.ok, r);
r = await owner('erpGameSet', [{ who: 'all' }]);
check('everyone', r.ok && r.result.who === 'all', r);
r = await sales('erpGame', []);
check('...staff see it now', r.ok && r.result.on, r);
r = await owner('erpGameSet', [{ who: 'none' }]);
r = await owner('erpGame', []);
check('nobody, not even the owner', r.ok && !r.result.on, r);
r = await owner('erpGameSet', [{ who: 'boss' }]);
check('nonsense refused', !r.ok, r);
await done();
