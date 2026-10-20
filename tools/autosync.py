"""devsync-2 (owner 21 Oct 2026: "every change from his side pulled automatically, and he sees mine").

Run every 2 minutes on EACH developer's PC by the Windows task "Costareen git autosync" (tools/autosync-install.cmd).
  - commits not on GitHub yet (a push that failed, no network) are pushed;
  - the other developer's work is pulled in: GitHub's main is merged into this folder when that is safe - the folder
    has no unsaved (uncommitted) changes to tracked files; a clash is never forced: it is logged and left for a person.
Nothing is ever thrown away: no reset, no forced push. Log: tools/autosync.log (not on GitHub).
"""
import os, subprocess, sys, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOG = os.path.join(ROOT, 'tools', 'autosync.log')
LOCAL_ONLY = ('backup-', 'private', 'local-')


def log(m):
    with open(LOG, 'a', encoding='utf-8') as f:
        f.write(time.strftime('%Y-%m-%d %H:%M:%S ') + m + '\n')


def git(*a, check=True):
    r = subprocess.run(['git', '-C', ROOT] + list(a), capture_output=True, text=True, encoding='utf-8', errors='replace')
    if check and r.returncode:
        raise RuntimeError(' '.join(a[:2]) + ': ' + (r.stderr or r.stdout).strip()[:300])
    return r.stdout.strip()


def main():
    if os.path.exists(os.path.join(ROOT, '.git', 'MERGE_HEAD')) or os.path.isdir(os.path.join(ROOT, '.git', 'rebase-merge')):
        return   # someone is in the middle of a merge / rebase: hands off
    git('fetch', '-q', '--prune', 'origin')
    branch = git('rev-parse', '--abbrev-ref', 'HEAD')
    if branch == 'HEAD' or branch.startswith(LOCAL_ONLY):
        return
    # 1. my commits that did not reach GitHub
    has_remote = git('ls-remote', '--heads', 'origin', branch, check=False)
    count_ahead = lambda: git('rev-list', '--count', 'origin/' + branch + '..HEAD') if has_remote else git('rev-list', '--count', 'HEAD', '--not', '--remotes=origin')
    ahead = count_ahead()
    # 2. the other developer's work: GitHub's main into this folder (only with no unsaved changes to tracked files)
    dirty = git('status', '--porcelain', '--untracked-files=no')
    behind = git('rev-list', '--count', 'HEAD..origin/main')
    if behind != '0':
        if dirty:
            log('main has %s new commit(s) from GitHub - not merged yet: this folder has unsaved changes (it is tried again in 2 minutes)' % behind)
        else:
            r = subprocess.run(['git', '-C', ROOT, 'merge', '-q', '--no-edit', 'origin/main'], capture_output=True, text=True, encoding='utf-8', errors='replace')
            if r.returncode:
                subprocess.run(['git', '-C', ROOT, 'merge', '--abort'], capture_output=True)
                log('CLASH: GitHub main does not merge cleanly into %s - left as it was; a person merges it (git merge origin/main)' % branch)
            else:
                who = git('log', '-1', '--format=%an: %s', 'origin/main')
                log('pulled %s commit(s) from GitHub main (latest - %s)' % (behind, who[:150]))
                ahead = count_ahead()   # the merge commit itself goes up too, so GitHub has it
    if ahead and ahead != '0':
        r = subprocess.run(['git', '-C', ROOT, 'push', '-q', 'origin', branch], capture_output=True, text=True, encoding='utf-8', errors='replace')
        log(('pushed %s commit(s) of %s' % (ahead, branch)) if r.returncode == 0 else ('push of %s refused: %s' % (branch, (r.stderr or '').strip()[:300])))


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        log('ERROR ' + str(e)[:400])
