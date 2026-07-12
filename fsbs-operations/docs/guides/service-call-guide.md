# Service-Call Guide

## For whoever triages incoming service calls

1. **Safety/active-leak check first, always.** The customer-facing intake form itself intercepts this before the form even loads (see `prototype/service-call/index.html`), but if a call comes in by phone, apply the same rule: active leak or safety concern skips the queue and gets an immediate human response.
2. Classify using the categories in `06-future-state-operating-model.md` §8 — emergency / urgent / standard / informational, and warranty / potential warranty / non-warranty / manufacturer-related / installer callback / customer-caused / undetermined.
3. **Never promise warranty coverage or accept liability in the acknowledgement message** — the acknowledgement confirms receipt and next steps only; a coverage determination is always a separate, human, reviewed decision.
4. Move the call through its lifecycle (`06-future-state-operating-model.md` §8) — don't skip "Acknowledged," even for something you plan to resolve same-day; the acknowledgement timestamp is itself a tracked metric.
5. Closing a call always requires human confirmation, even if AI assisted with triage or drafted a resolution message.
6. A reopened call is tracked as a reopen, not a fresh ticket — repeat/reopen rate is a core quality metric (`11-success-metrics.md`).

## Using the findings
Root-cause and repeat-call patterns from this workflow should directly inform: installer training, product/vendor selection, quality-control checklists at hand-off, and any customer-education content worth adding to the preparation/completion messaging.
