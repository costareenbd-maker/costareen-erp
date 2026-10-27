// fix-7 (27 Oct 2026): the owner's rule - a shareholder opens every screen and action the owner has (the AI section,
// capital, money, the "Only me" apps of the owner's own business), except users, security, keys and connections.
import { sql, FIX, owner, mgr, shareholder, makeShareholder, check, done } from './harness.mjs';
await makeShareholder();
await sql`insert into platform_admins (user_id, note) values (${FIX.U.owner}, 'test') on conflict do nothing`;   // the owner's own business

let r = await shareholder('erpHello', []);
check('(fix-7) hello: the shareholder\'s "Only me" apps are open (the AI section needs the engine app)', r.ok && r.result.role === 'shareholder' &&
  !(r.result.apps.off || []).includes('engine') && !(r.result.apps.off || []).includes('leads') && !r.result.platform, r.result && r.result.apps);
r = await mgr('erpHello', []);
check('(fix-7) hello: a manager\'s stay closed', r.ok && (r.result.apps.off || []).includes('engine'), r.result && r.result.apps);
r = await shareholder('erpApps', []);
check('(fix-7) the Apps list says the engine is open here', r.ok && r.result.apps.find((a) => a.key === 'engine').openHere === true, r.ok ? r.result.apps.filter((a) => a.labs) : r.error);

for (const name of ['erpBrief', 'erpEngine', 'erpWatch', 'erpSkills', 'erpBrain', 'erpAiBrain', 'erpLeads', 'erpCapital', 'erpMoney', 'erpCashBook', 'erpPnl', 'erpDashboardData', 'erpCommission', 'erpBalanceOpen']) {
  r = await shareholder(name, [{}]);
  check('(fix-7) shareholder opens ' + name, r.ok || !/does not have permission|Only the owner/.test(r.error || ''), r.error);
}
// 27 Oct 2026, the owner's second word: users, keys and connections too - the shareholder is the owner's equal
for (const name of ['erpUsers', 'erpSecurity', 'erpAccessKeys', 'erpConnections', 'erpAiKeys', 'erpBackupStatus']) {
  r = await shareholder(name, [{}]);
  check('(all-1) shareholder opens ' + name, r.ok || !/does not have permission|Only the owner/.test(r.error || ''), r.error);
}
for (const name of ['erpRecovery', 'erpRestorePreview', 'erpOwnerChanges', 'erpBusinessDelete']) {
  r = await shareholder(name, [{}]);
  check('(all-1) the owner alone keeps: ' + name, !r.ok && /does not have permission|Only the owner|Only its owner/.test(r.error || ''), r.ok ? 'opened!' : r.error);
}
r = await shareholder('erpUserPowers', [{ userId: FIX.U.mgr, powers: { act: true } }]);
check('(all-1) a shareholder switches abilities for the staff', r.ok, r.error);
r = await shareholder('erpUserSet', [{ userId: FIX.U.sales, role: 'manager' }]);
check('(all-1) a shareholder changes a staff role', r.ok, r.error);
r = await shareholder('erpUserSet', [{ userId: FIX.U.sales, role: 'owner' }]);
check('(all-1) ...but cannot make an owner', !r.ok && /Only an owner/.test(r.error || ''), r.ok ? 'opened!' : r.error);
r = await shareholder('erpUserSet', [{ userId: FIX.U.owner, role: 'manager' }]);
check('(all-1) ...nor touch an owner', !r.ok && /Only an owner/.test(r.error || ''), r.ok ? 'opened!' : r.error);
r = await mgr('erpBrief', [{}]);
check('(fix-7) a manager is told plainly whom to ask', !r.ok && /ask the owner/.test(r.error), r.error);

done();
