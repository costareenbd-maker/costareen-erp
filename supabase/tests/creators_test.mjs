// Creators (handlers/creators.js): the sponsorship tracker - creators, filament given, posts with numbers, projects,
// the monthly report and the brief; owner only; sales counted by the creator's code on invoices.
import { owner, mgr, check, done } from './harness.mjs';

const PLA = 'FIL-SUN-PLA-BLA-001';
let r = await mgr('erpCreators', [{}]);
check('a manager cannot see the programme', !r.ok, r);
r = await owner('erpCreators', [{}]);
check('empty to start, with this month and a report header', r.ok && r.result.creators.length === 0 && /^\d{4}-\d{2}$/.test(r.result.month) && /Creator programme report/.test(r.result.report), r);

r = await owner('erpCreatorSave', [{ name: '' }]);
check('a creator needs a name', !r.ok, r);
r = await owner('erpCreatorSave', [{ name: 'Mr. Setu', handle: '2 YouTube channels + page', platforms: 'YouTube, Facebook', followers: '40k', brand: 'Polymaker', code: 'setu10', videos_month: 2, posts_month: 2, rolls_video: 2, filament: 'general, from stock', trial_until: '2026-12-31', notes: 'Declined to share scripts; tells us before anything market-affecting.' }]);
check('a creator is saved with the code upper-cased', r.ok && r.result.creators.length === 1 && r.result.creators[0].code === 'SETU10' && r.result.creators[0].trial_until === '2026-12-31', r);
const setu = r.result.creators[0].id;
r = await owner('erpCreatorSave', [{ name: 'Mr. Robin', platforms: 'YouTube, Facebook', brand: 'Polymaker', code: 'ROBIN10', videos_month: 2, posts_month: 2, rolls_video: 2, filament: 'engineering grade (ask the brand first)', notes: 'Knows robotics and student teams that compete worldwide.' }]);
const robin = r.result.creators.find((c) => c.name === 'Mr. Robin').id;
check('two creators, the brief mentions projects for the one with student teams', r.ok && /Projects: send us promising student or robotics teams/.test(r.result.briefs[robin]) && !/Projects:/.test(r.result.briefs[setu]), r.result.briefs);

// filament given: value from the product when the SKU is known
r = await owner('erpCreatorShip', [{ creator_id: setu, sku: PLA, qty: 2, date: '2026-10-05' }]);
check('two rolls of a known SKU: name and value filled in (2 x sell price)', r.ok && r.result.creators.find((c) => c.id === setu).ships[0].product === 'Sunlu PLA Black' && r.result.creators.find((c) => c.id === setu).ships[0].value === 2700, r.ok ? r.result.creators[0].ships : r);
r = await owner('erpCreatorShip', [{ creator_id: setu, product: 'PolyLite PLA Red', qty: 3, value: 4500, date: '2026-10-06' }]);
check('a product the shop does not stock, typed by hand', r.ok && r.result.creators.find((c) => c.id === setu).month.rolls === 5 && r.result.creators.find((c) => c.id === setu).month.value === 7200, r);
r = await owner('erpCreatorShip', [{ creator_id: setu, sku: PLA, qty: 0 }]);
check('zero rolls refused', !r.ok, r);

// posts and their numbers
r = await owner('erpCreatorPost', [{ creator_id: setu, date: '2026-10-07', platform: 'YouTube', kind: 'video', url: 'https://youtu.be/x', product: 'PolyLite PLA Red', views: 1200, likes: 80, comments: 15, shares: 5, leads: 3 }]);
const post = r.result.creators.find((c) => c.id === setu).posts[0];
check('a video with its numbers; engagement rate 8.3%; behind on 1 video + 2 posts', r.ok && post.views === 1200 && r.result.creators.find((c) => c.id === setu).month.rate === 8.3 && r.result.creators.find((c) => c.id === setu).month.behind.join('|') === '1 of 2 videos|0 of 2 posts', r.ok ? r.result.creators.find((c) => c.id === setu).month : r);
r = await owner('erpCreatorPost', [{ id: post.id, views: 5000, likes: 300, comments: 40, shares: 20, leads: 7, url: 'https://youtu.be/x' }]);
check('the numbers updated after 30 days', r.ok && r.result.creators.find((c) => c.id === setu).posts[0].views === 5000 && r.result.creators.find((c) => c.id === setu).month.leads === 7, r);
r = await owner('erpCreatorPost', [{ creator_id: setu, date: '2026-10-08', platform: 'Facebook', kind: 'post', views: 800, likes: 50 }]);
check('a post counts separately from videos', r.ok && r.result.creators.find((c) => c.id === setu).month.posts === 1 && r.result.creators.find((c) => c.id === setu).month.videos === 1, r);

// sales with the creator's code on an invoice note
r = await mgr('erpCreateInvoice', [{ customer: { name: 'Fan', phone: '01798765432' }, items: [{ sku: PLA, qty: 1 }], payMode: 'full', paymentMethod: 'Cash', note: 'used code SETU10' }]);
check('an invoice with the code in its note', r.ok, r);
r = await owner('erpCreators', [{ month: '2026-10' }]);
const S = r.result.creators.find((c) => c.id === setu);
check('one order and its revenue counted for Setu this month, none for Robin', S.month.orders === 1 && S.month.revenue === 1350 && r.result.creators.find((c) => c.id === robin).month.orders === 0, S.month);
check('the report carries creator, SKU x qty, link, date, numbers, enquiries, orders', /Mr\. Setu/.test(r.result.report) && /FIL-SUN-PLA-BLA-001 Sunlu PLA Black × 2/.test(r.result.report) && /https:\/\/youtu.be\/x/.test(r.result.report) && /5,000 views/.test(r.result.report) && /7 enquiries/.test(r.result.report) && /1 orders with code SETU10/.test(r.result.report) && /Behind the agreement: 1 of 2 videos/.test(r.result.report), r.result.report);
check('per 1,000 views: 7,200 of filament over 5,800 views = 1,241', S.month.cpm === 1241, S.month);

// projects for the brand
r = await owner('erpCreatorProject', [{ creator_id: robin, team: 'BUET Robotics', project: 'Mars rover arm', competition: 'URC 2027', material: 'PolyMax PETG', qty: '6 rolls' }]);
const proj = r.result.creators.find((c) => c.id === robin).projects[0];
check('a project is recorded as new and appears in the report', r.ok && proj.status === 'new' && /Projects for your review: BUET Robotics — Mars rover arm \(URC 2027\), needs PolyMax PETG × 6 rolls/.test(r.result.report), r.ok ? r.result.report : r);
r = await owner('erpCreatorProject', [{ id: proj.id, status: 'approved' }]);
check('approved: no longer listed for review', r.ok && r.result.creators.find((c) => c.id === robin).projects[0].status === 'approved' && !/Projects for your review/.test(r.result.report), r);

// another month is empty; removing a line
r = await owner('erpCreators', [{ month: '2026-09' }]);
check('September: nothing given, nothing posted', r.ok && r.result.creators.find((c) => c.id === setu).month.rolls === 0 && r.result.creators.find((c) => c.id === setu).month.views === 0 && r.result.creators.find((c) => c.id === setu).total.rolls === 5, r);
r = await owner('erpCreatorRemove', [{ kind: 'ship', id: S.ships[1].id, month: '2026-10' }]);
check('a filament line removed', r.ok && r.result.creators.find((c) => c.id === setu).ships.length === 1 && r.result.creators.find((c) => c.id === setu).month.rolls === 3, r);
r = await mgr('erpCreatorSave', [{ name: 'X' }]);
check('a manager cannot add creators', !r.ok, r);
r = await owner('erpCreatorSave', [{ id: setu, name: 'Mr. Setu', status: 'paused', brand: 'Polymaker', videos_month: 2, posts_month: 2, rolls_video: 2 }]);
check('paused: no longer counted as behind', r.ok && r.result.creators.find((c) => c.id === setu).status === 'paused' && r.result.creators.find((c) => c.id === setu).month.behind.length === 0, r);

// the "Only me" app
r = await owner('erpApps', []);
const app = r.result.apps.find((a) => a.key === 'creators');
check('the Creators app exists, labs, off for everyone', app && app.labs && app.on === false, app);

// a new creator added with his e-mail: the answer says which one was made, the e-mail is kept for his login
r = await owner('erpCreatorSave', [{ name: 'Mr. Rana', email: 'Rana@Example.com', brand: 'Polymaker', videos_month: 2, posts_month: 2, rolls_video: 2, whatsapp: '01700000000' }]);
check('added with the e-mail; the new id comes back', r.ok && r.result.created > 0 && r.result.creators.find((c) => c.id === r.result.created).email === 'rana@example.com', r);
r = await owner('erpCreatorSave', [{ name: 'Copy', email: 'rana@example.com', brand: 'Polymaker' }]);
check('the same e-mail twice is refused', !r.ok, r);
r = await owner('erpCreatorSave', [{ name: 'Bad', email: 'not-an-email', brand: 'Polymaker' }]);
check('a bad e-mail is refused', !r.ok, r);
await done();
