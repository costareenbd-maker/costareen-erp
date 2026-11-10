# Human-like AI salesperson - research summary (10 Nov 2026)

Owner asked: research GitHub and other sources on how an AI sales agent can behave and talk like a person.
Summary of a web/GitHub/paper sweep (abstracts and excerpts only; effect sizes as reported by their authors).

## Adopted now (learn-1 / name-1)
- Learn the manner from our own team's real chats (teamlearn.js): the strongest, most local source of "how we talk".
- Match length and register (style matching raises trust: ACM CSCW 2008 https://dl.acm.org/doi/10.1145/1460563.1460608).
- One question per turn, no restating, no repeated openers (Rasa conversation design https://rasa.com/blog/13-rules-for-cui-design).
- Honest urgency only (real stock / real offer dates).
- Angry customer / damage / refund -> plain apology + hand to a person: a human-like bot made angry customers less
  satisfied (Crolic et al., Journal of Marketing 2022 https://journals.sagepub.com/doi/10.1177/00222429211045687).
- Emoji: at most one, mirror the customer, none in complaints (positive emoji raise warmth/purchase intent:
  https://onlinelibrary.wiley.com/doi/10.1002/cb.70008).
- Disclosure: do not announce "I am a bot" up front, never deny it when sincerely asked (Luo et al., Marketing Science
  2019 https://pubsonline.informs.org/doi/10.1287/mksc.2019.1192 - up-front disclosure cut purchases sharply; competence closes the gap).
- One message per answer (one-1), the 15 s merge of quick messages kept.

## Next (not built yet, ranked)
1. Sales stage label fed into the reply prompt (SalesGPT https://github.com/filip-michalsky/salesgpt; its issues #166/#19
   show the bug of computing the stage but not using it).
2. Reply delay scaled to length + typing indicator on Messenger and WhatsApp Cloud, the 15 s merge counted inside it,
   total <= ~20 s (Gnewuch et al., ECIS 2018 https://aisel.aisnet.org/ecis2018_rp/113/).
3. If a new message arrives while a reply is being written: drop that reply and write one answer for both.
4. Objection playbook from ERP facts: Polymaker authorisation letter, cash on delivery, courier time by district, price per kg.
5. Per-customer memory (printer model, past filaments, district) used in openers.
6. Follow-ups inside platform rules: nudges inside 24 h only; after that a person or a WhatsApp template
   (Messenger tags end 9 Feb 2026; the Human Agent tag is for manual messages only).

## Not worth adopting
- Fake typos / typing simulators (deceptive, no sales gain).
- Splitting one answer into many bubbles.
- Claiming to be human / hiding the AI.
- Fake scarcity and countdowns.
- A long personal backstory for "Faujia" (inflates expectations).
- Automated messages under the Human Agent tag (against Meta policy).
- Delays near 30 s.
