# tools

- `bangla_lint.py` - checks Bangla copy in the pages and server handlers: তুমি forms and banned words (পণ্য, ভারসাম্য ...) are errors, English left inside Bangla strings is a warning. Run `python tools/bangla_lint.py [paths] [--only tumi,banned,english] [--strict]`; rules in docs/bangla/GLOSSARY.md section 0.
- `autosync.py`, `autosync-install.cmd` - push every commit and pull the other developer's main (CLAUDE.md 7b).
