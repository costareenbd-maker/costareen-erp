"""Build web/index.html from the sheet ERP's own page (original/ErpUI.html).

The page is used exactly as it is. Only these things change, each one an
exact text replacement that must match once (so a newer original that moved
something fails loudly instead of building a half-patched page):

  1. head: Supabase client (owner sign-in only), app manifest, icons
  2. srvPump: post to the `erp` Edge Function instead of google.script.run
  3. sign-in gate: the owner signs in with email + password (was: the Google
     account that owned the sheet); staff keep their 6-digit code
  4. sign out: also ends the owner's session; shown to the owner too
  5. installable app: service worker registration

Run:  python build_ui.py
"""
import os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'original', 'ErpUI.html')
OUT = os.path.join(HERE, os.environ.get('ERP_OUT', 'index.html'))

SUPABASE_URL = 'https://oqzcuuytytqadqjlwdsh.supabase.co'
SUPABASE_ANON = ('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9xemN1dXl0eXRxYWRx'
                 'amx3ZHNoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk4Nzk4MDEsImV4cCI6MjEwNTQ1NTgwMX0.fwdCTTde1fS2SP'
                 'fT5ULNqLI4-YQLa__3pHjufarZG_0')
API = os.environ.get('ERP_API', SUPABASE_URL + '/functions/v1/erp')

s = open(SRC, encoding='utf-8').read()


def patch(old, new, label):
    global s
    n = s.count(old)
    if n != 1:
        sys.exit('PATCH FAILED (%s): expected 1 match, found %d' % (label, n))
    s = s.replace(old, new)


# 1. head ---------------------------------------------------------------------
patch('<meta name="viewport" content="width=device-width, initial-scale=1">\n',
      '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
      '<title>Costareen ERP</title>\n'
      '<meta name="theme-color" content="#2a78d6">\n'
      '<link rel="manifest" href="/manifest.webmanifest">\n'
      '<link rel="icon" type="image/png" sizes="32x32" href="/icons/favicon-32.png">\n'
      '<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">\n'
      '<meta name="apple-mobile-web-app-capable" content="yes">\n'
      '<meta name="mobile-web-app-capable" content="yes">\n'
      '<meta name="apple-mobile-web-app-title" content="Costareen">\n'
      '<link rel="preconnect" href="https://oqzcuuytytqadqjlwdsh.supabase.co" crossorigin>\n'
      '<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js"></script>\n',
      'head')

# 2. the one door -------------------------------------------------------------
patch('''function srv(name, args, ok, bad) {''',
      '''// ---- web app: the server is the `erp` Edge Function on Supabase ----------
var ERP_API = '%(api)s';
var SB_URL = '%(url)s';
var SB_ANON = '%(anon)s';
var SB = null;
try { SB = window.supabase.createClient(SB_URL, SB_ANON); } catch (e) { SB = null; }

/** The owner's Supabase session, if signed in that way; staff send a code instead. */
function erpSession() {
  if (!SB) return Promise.resolve('');
  return SB.auth.getSession().then(function (r) {
    var s = r && r.data && r.data.session;
    return s ? s.access_token : '';
  }, function () { return ''; });
}

function erpPost(name, args) {
  return erpSession().then(function (tok) {
    return fetch(ERP_API, {
      method: 'POST',
      // run the server next to the database (Singapore); without this it runs
      // wherever the visitor is nearest, and every query crosses the distance
      headers: { 'Content-Type': 'application/json', 'apikey': SB_ANON, 'x-region': 'ap-southeast-1',
                 'Authorization': 'Bearer ' + SB_ANON,
                 'x-erp-session': tok ? 'Bearer ' + tok : '' },
      body: JSON.stringify({ name: name, args: args || [], token: erpToken() })
    });
  }).then(function (r) { return r.json(); });
}

// Owner password reset: the emailed link opens the app signed in; ask for the
// new password here (the sheet ERP had no passwords, so it had no such step).
try {
  if (SB) SB.auth.onAuthStateChange(function (event) {
    if (event !== 'PASSWORD_RECOVERY') return;
    setTimeout(function () {
      var p1 = window.prompt('Choose a new password for the owner account (at least 10 characters):', '');
      if (!p1) return;
      if (p1.length < 10) { window.alert('That is shorter than 10 characters. Open the link from the email again.'); return; }
      var p2 = window.prompt('Type the same password again:', '');
      if (p1 !== p2) { window.alert('The two did not match. Open the link from the email again.'); return; }
      SB.auth.updateUser({ password: p1 }).then(function (r) {
        if (r.error) { window.alert('Could not change it: ' + r.error.message); return; }
        try { history.replaceState(null, '', location.pathname); } catch (e) {}
        window.alert('Password changed. Use it with "Owner? Sign in with email" from now on.');
        signIn();
      });
    }, 300);
  });
} catch (e) {}

function srv(name, args, ok, bad) {''' % {'api': API, 'url': SUPABASE_URL, 'anon': SUPABASE_ANON},
      'transport helpers')

patch('''  var runner = google.script.run
    .withSuccessHandler(function (r) { finish(job.ok, r); })
    .withFailureHandler(function (e) { finish(job.bad, e); });

  try {
    // One door: the server identifies the caller and checks the role before
    // doing anything, so a screen that is hidden is also data that is never
    // sent. erpHello is the only exception - it is how you sign in.
    if (job.name === 'erpHello') {
      runner.erpHello(erpToken());
    } else {
      runner.erpCall(erpToken(), job.name, job.args || []);
    }
  } catch (e) {
    finish(job.bad, e);
  }''',
      '''  // One door: the server identifies the caller and checks the role before
  // doing anything, so a screen that is hidden is also data that is never
  // sent. erpHello is the only exception - it is how you sign in.
  try {
    erpPost(job.name, job.args || []).then(function (res) {
      if (res && res.ok) finish(job.ok, res.result);
      else finish(job.bad, new Error((res && res.error) || 'The server did not answer.'));
    }, function (e) {
      finish(job.bad, new Error('Could not reach the server - check the internet connection. (' +
        ((e && e.message) || e) + ')'));
    });
  } catch (e) {
    finish(job.bad, e);
  }
  srvPump();   // start the next one too, if it may run alongside''',
      'srvPump runner')

# 3. sign-in gate: owner by email ---------------------------------------------
patch('''var GATE_BUSY = false;''',
      '''var GATE_BUSY = false;
var GATE_OWNER = false;   // web app: the owner signs in with email, not a code''',
      'gate state')

patch('''    '<div class="sub" style="margin-top:14px">Do not have a code? Ask the owner ' +
    'to add you in Settings.</div>' +
    '</div></div>';
}''',
      '''    '<div class="sub" style="margin-top:14px">Do not have a code? Ask the owner ' +
    'to add you in Settings.</div>' +
    (GATE_OWNER
      ? '<div style="margin-top:18px;border-top:1px solid var(--grid);padding-top:16px">' +
        '<div class="sub" style="margin-bottom:10px">Owner sign-in</div>' +
        '<input class="i" id="gate_email" type="email" autocomplete="username" placeholder="Email"' + (busy ? ' disabled' : '') + '>' +
        '<input class="i" id="gate_pass" type="password" autocomplete="current-password" placeholder="Password" style="margin-top:8px"' + (busy ? ' disabled' : '') + '>' +
        '<button class="btn" style="width:100%;margin-top:10px" type="button" id="gate_owner_go"' + (busy ? ' disabled' : '') + '>' +
        (busy ? 'Checking…' : 'Sign in') + '</button></div>'
      : '<div class="sub" style="margin-top:10px"><a href="#" id="gate_owner">Owner? Sign in with email</a></div>') +
    '</div></div>';
}''',
      'gate owner form')

patch('''  if (go) go.addEventListener('click', submit);
  if (box) box.addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter') submit();
  });
}''',
      '''  if (go) go.addEventListener('click', submit);
  if (box) box.addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter') submit();
  });

  // owner: email + password through Supabase, then the same erpHello
  var ow = el('gate_owner');
  if (ow) ow.addEventListener('click', function (ev) { ev.preventDefault(); GATE_OWNER = true; ME_MSG = ''; paintGate(); });
  var og = el('gate_owner_go'), pw = el('gate_pass');
  function ownerIn() {
    if (GATE_BUSY) return;
    var em = (el('gate_email') && el('gate_email').value || '').trim();
    var pa = (pw && pw.value) || '';
    if (!em || !pa) { ME_MSG = 'Type your email and password.'; paintGate(); return; }
    if (!SB) { ME_MSG = 'Sign-in could not load. Check the internet connection and reload.'; paintGate(); return; }
    GATE_BUSY = true; ME_MSG = ''; paintGate();
    erpSetCode('');
    SB.auth.signInWithPassword({ email: em, password: pa }).then(function (r) {
      if (r.error) throw r.error;
      srv('erpHello', [], function (res) {
        GATE_BUSY = false;
        if (res && res.ok) { ME = res; ME_MSG = ''; startApp(); }
        else { ME_MSG = (res && res.message) || 'Could not sign you in.'; paintGate(); }
      }, function (e) { GATE_BUSY = false; ME_MSG = (e && e.message) || String(e); paintGate(); });
    }).catch(function (e) {
      GATE_BUSY = false;
      ME_MSG = /invalid/i.test(String(e && e.message)) ? 'That email and password do not match.' : ((e && e.message) || String(e));
      paintGate();
    });
  }
  if (og) og.addEventListener('click', ownerIn);
  if (pw) pw.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') ownerIn(); });
}''',
      'gate owner wiring')

# 4. sign out -------------------------------------------------------------------
patch('''function signOut() {
  if (!window.confirm('Sign out on this device?')) return;
  erpSetCode('');
  ME = null; ME_MSG = '';
  paintGate();
}''',
      '''function signOut() {
  if (!window.confirm('Sign out on this device?')) return;
  erpSetCode('');
  ME = null; ME_MSG = '';
  var after = function () { paintGate(); };
  try { if (SB) { SB.auth.signOut().then(after, after); return; } } catch (e) {}
  after();
}''',
      'sign out')

patch('''  // signing out is for people with a code; the owner has none to forget
  var so = el('signoutBtn');
  if (so) so.style.display = (ME && !ME.implicit) ? '' : 'none';''',
      '''  // web app: everyone signed in can sign out - the owner ends their session
  var so = el('signoutBtn');
  if (so) so.style.display = ME ? '' : 'none';''',
      'sign out button')

# 5. bug fix: a product created on the Receive screen was only a draft, and the
#    save sent just {sku, qty} - so the new product was silently dropped
#    (docs/fixes/stock.md). The server already accepts {isNew, product, qty}.
patch('''                         lines:RECV.lines.map(function (l) {
                           return { sku:l.sku, qty:l.qty };
                         })}],''',
      '''                         lines:RECV.lines.map(function (l) {
                           return l.isNew ? { isNew:true, product:l.product, qty:l.qty }
                                          : { sku:l.sku, qty:l.qty };
                         })}],''',
      'receive drafts')

# 6. files are no longer in Google Drive: download links use the link the
#    server returns (a signed storage link) instead of building a Drive URL.
patch('''      toast('<a href="https://drive.google.com/uc?export=download&amp;id=' + esc(r.id) +
            '" target="_blank" rel="noopener"><strong>Save ' + esc(r.name) + '</strong></a>' +
            ' · a copy is also kept in Drive', false, 30000);''',
      '''      toast('<a href="' + esc(r.url) +
            '" target="_blank" rel="noopener" download><strong>Save ' + esc(r.name) + '</strong></a>' +
            ' · a copy is also kept in the ERP', false, 30000);''',
      'expense export link')
patch('''  var dl = res.pdfId
    ? 'https://drive.google.com/uc?export=download&id=' + encodeURIComponent(res.pdfId)
    : '';''',
      '''  var dl = res.pdfUrl || '';''',
      'invoice download link')
patch("""        'Drive. This stays open until you close it.</div>' +""",
      """        'the ERP. This stays open until you close it.</div>' +""",
      'invoice done wording')
patch("""'</strong></a> · saved in Drive', false, 30000);""",
      """'</strong></a> · saved in the ERP', false, 30000);""",
      'statement saved wording')

# 7. speed: read-only calls run side by side (up to 4); a call that changes
#    anything still runs alone and in order, as the sheet's queue guaranteed.
#    The sheet ran one call at a time because Apps Script queued them anyway.
patch("""function srvPump() {
  if (SRV_BUSY || !SRV_Q.length) return;
  SRV_BUSY = true;
  var job = SRV_Q.shift();""",
      """var SRV_ACTIVE = 0, SRV_WRITING = false;
// the same list the server uses to know a call changes nothing (ERP_READS)
var SRV_READS = /^(erpBundle|erpHello|erpMe|erpCatalog|erpSales|erpDues|erpCustomers|erpPnl|erpMoney|erpToday|erpDaySales|erpProduct|erpLookupCustomer|erpCustomerAccount|erpCustomerStatement|erpCustomerCredit|erpWebOrders|erpWebOrderInvoices|erpCampaignAudience|erpCampaignList|erpCampaignGet|erpEvoStatus|erpBrandLogo|erpQuoteBoot|erpQuoteList|erpQuoteGet|erpQuoteAsset|erpExpenses|erpCapital|erpBackupStatus|erpAiKeys|erpGetTheme|erpBusinesses|erpStockHistory|erpReorderPlan|erpPoList|erpSfPayoutLines|erpBookedParcels|erpParcelPreview|erpReturnPreview|erpSettingsFull|erpSettingsLists|erpFormOptions|erpAdmin|erpPeople|erpDevices|erpCourierKeyStatus|erpPayReasons|erpDiscontinued|erpAccessWarning|erpBusinessLinks|erpLookupUsage|erpRecentInvoices|erpCourier|erpDashboardData)$/;
function srvPump() {
  if (!SRV_Q.length) return;
  var isRead = SRV_READS.test(SRV_Q[0].name);
  // a read waits only for a write; a write waits for everything before it
  if (isRead ? (SRV_WRITING || SRV_ACTIVE >= 4) : SRV_ACTIVE > 0) return;
  SRV_ACTIVE++; if (!isRead) SRV_WRITING = true;
  SRV_BUSY = true;
  var job = SRV_Q.shift();""",
      'parallel reads: start')
patch("""    SRV_BUSY = false;""",
      """    SRV_ACTIVE--; if (!isRead) SRV_WRITING = false;
    SRV_BUSY = SRV_ACTIVE > 0;""",
      'parallel reads: finish')

# 8. speed: the two halves of the first load are asked for together, not one
#    after the other.
patch("""  srv('erpBundle', [core, { fresh: fresh === true }], function (b) {
    if (b && b.biz) applyBusinesses(b.biz);
    applyBundle(b);
    srv('erpBundle', [['customers', 'invoices', 'history', 'weborders']], function (b2) {
      applyBundle(b2);
      settleEmpties();
      // what was shown at once was the kept copy: now fetch today's figures behind it
      if (DASH_SAVED) srv('erpBundle', [['dash'], { fresh: true }], function (b3) { applyBundle(b3); if (VIEW === 'dash') repaint(); }, function () {});
    }, bundleFail);
  }, bundleFail);
}""",
      """  var left = 2;
  function one() { if (--left === 0) settleEmpties(); }
  srv('erpBundle', [core, { fresh: fresh === true }], function (b) {
    if (b && b.biz) applyBusinesses(b.biz);
    applyBundle(b);
    one();
    // what was shown at once was the kept copy: now fetch today's figures behind it
    if (DASH_SAVED) srv('erpBundle', [['dash'], { fresh: true }], function (b3) { applyBundle(b3); if (VIEW === 'dash') repaint(); }, function () {});
  }, bundleFail);
  srv('erpBundle', [['customers', 'invoices', 'history', 'weborders']], function (b2) {
    applyBundle(b2);
    one();
  }, bundleFail);
}""",
      'first load in parallel')

# 9. installable app ------------------------------------------------------------
patch('</body>',
      '''<style>
/* phone: the list tables become stacked cards - no sideways scrolling.
   Labels come from labelTables() below. Document previews keep real tables. */
@media (max-width:640px) {
  .scroll:has(> table.m-cards), .scroll.tall:has(> table.m-cards) { overflow:visible; max-height:none; }
  table.m-cards, table.m-cards > tbody { display:block; width:100%; }
  table.m-cards > thead { display:none; }
  table.m-cards > tbody > tr { display:block; background:var(--surface); border:1px solid var(--ring);
    border-radius:10px; padding:8px 12px; margin-bottom:10px; }
  table.m-cards > tbody > tr > td { display:flex; justify-content:space-between; align-items:center;
    gap:12px; border:none; padding:5px 0; text-align:right; min-height:30px; white-space:normal; }
  table.m-cards > tbody > tr > td::before { content:attr(data-label); font-size:11px; font-weight:600;
    letter-spacing:.04em; text-transform:uppercase; color:var(--muted); text-align:left; flex:none; }
  table.m-cards > tbody > tr > td:first-child { display:block; text-align:left; font-weight:600;
    padding-bottom:6px; border-bottom:1px solid var(--grid); margin-bottom:3px; }
  table.m-cards > tbody > tr > td:first-child::before,
  table.m-cards > tbody > tr > td[data-label=""]::before { content:none; }
  table.m-cards > tbody > tr > td[data-label=""] { justify-content:flex-end; flex-wrap:wrap; }
  table.m-cards > tbody > tr > td:only-child { border-bottom:none; margin-bottom:0; padding-bottom:5px; }
  table.m-cards > tbody > tr > td[colspan] { display:block; text-align:left; }
  table.m-cards > tbody > tr > td[colspan]::before { content:none; }
  table.m-cards > tbody > tr > td.num { padding-right:0; }
  table.m-cards > tbody > tr > td:empty { display:none; }
  table.m-cards > tbody > tr.grp { background:none; border:none; padding:6px 2px 0; margin-bottom:4px; }
  table.m-cards input.i.qty { width:110px; }
}
</style>
<script>
// phone layout: give every list-table cell its column name so the CSS above can
// stack rows as cards. Runs after any repaint; document previews are left alone.
(function () {
  function labelTables() {
    var tables = document.querySelectorAll('.scroll > table');   // rows can be redrawn inside a table
    for (var t = 0; t < tables.length; t++) {
      var tb = tables[t];
      if (tb.closest('.qz-preview, .qz-pagewrap, #qz_print')) continue;
      var heads = [], th = tb.querySelectorAll(':scope > thead th');
      for (var h = 0; h < th.length; h++) heads.push(th[h].textContent.trim());
      var rows = tb.querySelectorAll(':scope > tbody > tr');
      for (var r = 0; r < rows.length; r++) {
        var col = 0, cells = rows[r].children;
        for (var c = 0; c < cells.length; c++) {
          if (!cells[c].hasAttribute('data-label')) cells[c].setAttribute('data-label', heads[col] || '');
          col += cells[c].colSpan || 1;
        }
      }
      if (!tb.classList.contains('m-cards')) tb.classList.add('m-cards');
    }
  }
  try {
    new MutationObserver(labelTables).observe(document.body, { childList: true, subtree: true });
    labelTables();
  } catch (e) {}
})();
</script>
<script>
// installable app (Add to Home screen) - only over https or localhost
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  window.addEventListener('load', function () { navigator.serviceWorker.register('/sw.js').catch(function () {}); });
}
</script>
</body>''',
      'service worker')

open(OUT, 'w', encoding='utf-8', newline='\n').write(s)
print('built', OUT, len(s), 'bytes')
