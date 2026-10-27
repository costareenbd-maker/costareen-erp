// Platform admin on a bridged company: the company's own platform_admins row (the installer makes its owner
// "admin of this copy") must not open the provider's screens, which read the provider's control tables.
import { sql, FIX, owner, check, done, deps } from './harness.mjs';

await sql`insert into platform_admins (user_id, note) values (${FIX.U.owner}, 'test') on conflict do nothing`;
const NAMES = ['erpPlatformCommunity', 'erpPlatformDesign', 'erpPlatformDoctor', 'erpPlatformRegister', 'erpInstalls', 'erpComplianceLog', 'erpPlatform'];

// 1. on its own server the admin is the admin
let r = await owner('erpHello', []);
check('own server: hello says platform', r.ok && r.result.platform === true, r);
for (const n of NAMES) {
  r = await owner(n, []);
  check('own server: ' + n + ' opens', r.ok || !/platform admin|does not have permission/i.test(r.error || ''), r);
}

// 2. the same row on a company running on the provider's server counts for nothing
const was = deps.install;
deps.install = { id: '00000000-0000-4000-8000-0000000000aa', bridged: true };
r = await owner('erpHello', []);
check('bridged: hello does not say platform', r.ok && r.result.ok && r.result.platform === false, r);
for (const n of NAMES) {
  r = await owner(n, []);
  check('bridged: ' + n + ' refused', !r.ok && /platform admin|does not have permission/i.test(r.error || ''), r);
}
r = await owner('erpNewsAdd', [{ text: 'hello everyone', days: 3 }]);
check('bridged: cannot post an announcement', !r.ok, r);
r = await owner('erpBrandSet', [{ name: 'Mine' }]);
check('bridged: cannot change the brand', !r.ok, r);
deps.install = was;
await done();
