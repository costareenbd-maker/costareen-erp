"""channels-1 (21 Nov 2026): three one-line hooks in the content-desk-ui-1 block so the appended channels-1 block can add
the Channels tab and the approve controls on draft cards. Used on main and on the live page source (same block text).
    python deploy/channels1_hooks.py <app.html>"""
import sys

HOOKS = [
    # the tabs + the body of a new tab
    ("    var body = CD.tab === 'videos' ? videosHtml() : CD.tab === 'events' ? eventsHtml() : CD.tab === 'plan' ? planHtml() : CD.tab === 'people' ? handlersHtml() : todayHtml();\n",
     "    if (window.cdxTabs) tabs = cdxTabs(tabs);   // channels-1\n"
     "    var body = CD.tab === 'videos' ? videosHtml() : CD.tab === 'events' ? eventsHtml() : CD.tab === 'plan' ? planHtml() : CD.tab === 'people' ? handlersHtml() : todayHtml();\n"
     "    if (window.cdxBody) body = cdxBody(CD.tab) || body;   // channels-1\n"),
    # the approve controls on a draft card
    ("      '<div class=\"cd-act\">' + (owner() ? '<button type=\"button\" class=\"cd-btn dark\" data-cd=\"ready\"",
     "      (window.cdxAct ? cdxAct(d, f) : '') +   // channels-1\n"
     "      '<div class=\"cd-act\">' + (owner() ? '<button type=\"button\" class=\"cd-btn dark\" data-cd=\"ready\""),
    # the block's state for the new block
    ("  var rp = repaint;\n  repaint = function () { navSync(); if (typeof VIEW === 'undefined' || VIEW !== 'contentdesk') return rp.apply(this, arguments); paint(); load(); };\n",
     "  var rp = repaint;\n  repaint = function () { navSync(); if (typeof VIEW === 'undefined' || VIEW !== 'contentdesk') return rp.apply(this, arguments); paint(); load(); };\n"
     "  window.cdxApi = { st: CD, paint: function () { paint(); }, load: function (f) { load(f); }, draft: function (id) { return draftOf(id); }, owner: owner };   // channels-1\n"),
]


def apply(path):
    s = open(path, encoding='utf-8').read()
    if 'window.cdxApi' in s:
        print('hooks already in', path)
        return
    for old, new in HOOKS:
        n = s.count(old)
        if n != 1:
            raise SystemExit('hook anchor found %d times: %r' % (n, old[:80]))
        s = s.replace(old, new)
    open(path, 'w', encoding='utf-8', newline='\n').write(s)
    print('hooks in', path)


if __name__ == '__main__':
    apply(sys.argv[1])
