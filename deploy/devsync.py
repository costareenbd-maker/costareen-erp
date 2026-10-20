"""devsync-1 (owner 21 Oct 2026: "the second developer's changes should be on the dev link, trackable in real time").

Run every 2 minutes by the Windows task "Costareen dev sync" (deploy/devsync-install.cmd). Each run:
  1. git fetch the GitHub repo into its own copy (G:/costareen-erp-devsync - never the working folder anyone edits);
  2. main moved -> that copy goes to the new main and the DEV ERP is updated: migrations if a .sql changed, the
     function if supabase/functions changed, and the page every time (its "What's on dev" badge lists the commits);
  3. a branch not merged into main changed -> its page goes up on its own preview link
     (https://<branch>.costareen-erp-dev.pages.dev), on the dev data and server.
Only ERP_TARGET=dev: deploy.py refuses anything else for dev, and this script never runs a live step.
The keys stay on this PC (deploy/secrets.env); nothing is added to GitHub. State and a log: deploy/devsync-state.json,
deploy/devsync.log.
"""
import json, os, re, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
MAIN = os.path.dirname(HERE)                              # the working folder (only its secrets.env is read)
COPY = os.environ.get('DEVSYNC_DIR', 'G:/costareen-erp-devsync')
REPO = 'https://github.com/costareenbd-maker/costareen-erp.git'
STATE = os.path.join(HERE, 'devsync-state.json')
LOG = os.path.join(HERE, 'devsync.log')
LOCK = os.path.join(HERE, 'devsync.lock')


def log(m):
    line = time.strftime('%Y-%m-%d %H:%M:%S ') + m
    print(line)
    with open(LOG, 'a', encoding='utf-8') as f:
        f.write(line + '\n')


def git(*a, cwd=COPY):
    return subprocess.check_output(['git', '-C', cwd] + list(a), text=True, encoding='utf-8', errors='replace').strip()


def secrets():
    env = dict(os.environ)
    for l in open(os.path.join(HERE, 'secrets.env'), encoding='utf-8'):
        m = re.match(r'\s*(?:export\s+)?([A-Z0-9_]+)=(.*)$', l)
        if m:
            env[m.group(1)] = m.group(2).strip().strip('"').strip("'")
    env['ERP_TARGET'] = 'dev'
    env.pop('ERP_TARGET_LIVE', None)
    return env


def deploy(step, env):
    r = subprocess.run([sys.executable, os.path.join(COPY, 'deploy', 'deploy.py'), step], cwd=os.path.join(COPY, 'deploy'), env=env,
                       capture_output=True, text=True, encoding='utf-8', errors='replace', shell=False)
    tail = (r.stdout + r.stderr).strip().splitlines()[-3:]
    log('  %s -> %s %s' % (step, 'ok' if r.returncode == 0 else 'FAILED', ' | '.join(tail)[:400]))
    return r.returncode == 0


def main():
    if os.path.exists(LOCK) and time.time() - os.path.getmtime(LOCK) < 1200:
        return   # the last run is still going (a deploy takes 1-3 minutes)
    open(LOCK, 'w').write(str(os.getpid()))
    try:
        if not os.path.isdir(os.path.join(COPY, '.git')):
            log('making the sync copy ' + COPY)
            subprocess.check_call(['git', 'clone', '-q', REPO, COPY])
        # the minifier's tools (deploy/.tools, not on GitHub) are shared with the working folder
        tools = os.path.join(COPY, 'deploy', '.tools')
        if not os.path.exists(tools):
            subprocess.call(['cmd', '/c', 'mklink', '/J', tools.replace('/', '\\'), os.path.join(HERE, '.tools').replace('/', '\\')], stdout=subprocess.DEVNULL)
        git('fetch', '-q', '--prune', 'origin')
        st = json.load(open(STATE, encoding='utf-8')) if os.path.exists(STATE) else {}
        env = secrets()
        # devsync-2 (owner: "every change from his side automatically"): a pushed branch is merged into main by itself when
        # it merges cleanly (wip/... and try-... branches stay preview-only); a clash is left for a person, never forced
        git('checkout', '-q', '-f', 'main'); git('reset', '-q', '--hard', 'origin/main')
        merged = []
        for ref in git('for-each-ref', '--format=%(refname:short)', 'refs/remotes/origin').splitlines():
            b = ref.split('/', 1)[-1]
            if not ref.startswith('origin/') or b in ('HEAD', 'main') or re.match(r'^(wip/|try-|backup-|private)', b): continue
            if git('rev-list', '--count', 'HEAD..' + ref) == '0': continue
            r = subprocess.run(['git', '-C', COPY, 'merge', '-q', '--no-edit', '-m', 'Auto-merge %s into main (devsync)' % b, ref], capture_output=True, text=True)
            if r.returncode:
                subprocess.run(['git', '-C', COPY, 'merge', '--abort'], capture_output=True)
                if st.get('clash', {}).get(b) != git('rev-parse', ref):
                    log('CLASH: branch %s does not merge cleanly into main - preview only; a person merges it' % b)
                st.setdefault('clash', {})[b] = git('rev-parse', ref)
            else:
                merged.append(b); st.get('clash', {}).pop(b, None)
        if merged:
            r = subprocess.run(['git', '-C', COPY, 'push', '-q', 'origin', 'main'], capture_output=True, text=True)
            log(('merged into main: ' + ', '.join(merged)) if r.returncode == 0 else ('push of merged main refused: ' + (r.stderr or '')[:300]))
            git('fetch', '-q', 'origin')
        main_sha = git('rev-parse', 'origin/main')
        if main_sha != st.get('main'):
            old = st.get('main')
            git('checkout', '-q', '-f', 'main'); git('reset', '-q', '--hard', 'origin/main'); git('clean', '-q', '-fd', '-e', 'deploy/secrets.env')
            changed = git('diff', '--name-only', old, main_sha).splitlines() if old else ['supabase/000.sql', 'supabase/functions/x']
            who = git('log', '-1', '--format=%an: %s', main_sha)
            log('main -> %s (%s)' % (main_sha[:8], who[:120]))
            env['DEVSYNC_BY'] = 'auto (devsync)'
            env.pop('DEV_PAGES_BRANCH', None)
            ok = True
            if any(re.match(r'supabase/\d{3}_.*\.sql$', f) for f in changed): ok = deploy('db', env) and ok
            if ok and any(f.startswith('supabase/functions/') for f in changed): ok = deploy('function', env) and ok
            if ok: ok = deploy('web', env) and ok
            st['main'] = main_sha if ok else st.get('main')
            st['lastError'] = '' if ok else time.strftime('%H:%M ') + 'deploy of ' + main_sha[:8] + ' failed - see deploy/devsync.log'
        # branches not merged yet: each gets its page on its own preview link (the dev server and data underneath)
        br = st.setdefault('branches', {})
        for ref in git('for-each-ref', '--format=%(refname:short) %(objectname)', 'refs/remotes/origin').splitlines():
            name, sha = ref.split(' ')
            b = name.split('/', 1)[-1]
            if b in ('HEAD', 'main') or not name.startswith('origin/') or br.get(b) == sha: continue
            if git('rev-list', '--count', 'origin/main..' + name) == '0': br[b] = sha; continue
            log('branch %s -> %s (%s)' % (b, sha[:8], git('log', '-1', '--format=%an: %s', sha)[:120]))
            git('checkout', '-q', '-f', '--detach', sha); git('clean', '-q', '-fd')
            # main's deploy script, not the branch's: an older one does not know preview links and would publish over main
            open(os.path.join(COPY, 'deploy', 'deploy.py'), 'w', encoding='utf-8', newline='').write(git('show', 'origin/main:deploy/deploy.py') + '\n')
            env2 = dict(env, DEV_PAGES_BRANCH=re.sub(r'[^a-z0-9-]', '-', b.lower())[:28].strip('-'), DEVSYNC_BY='auto (devsync, branch ' + b + ')')
            if deploy('web', env2): br[b] = sha
            git('checkout', '-q', '-f', 'main')
        st['checkedAt'] = time.strftime('%Y-%m-%d %H:%M:%S')
        json.dump(st, open(STATE, 'w', encoding='utf-8'), indent=1)
    except Exception as e:
        log('ERROR ' + str(e)[:400])
    finally:
        try: os.remove(LOCK)
        except OSError: pass


if __name__ == '__main__':
    main()
