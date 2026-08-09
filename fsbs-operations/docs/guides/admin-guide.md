# Admin Guide

For whoever administers this system day-to-day (likely office management).

## What you can configure
- **Overdue thresholds** — acknowledgement (default 11:00 PM) and post-appointment result (default 9:00 PM) deadlines, plus the late-evening and whole-day-off exceptions (`06-future-state-operating-model.md` §2–3).
- **Escalation tiers** — when a Tier 1 rep-only reminder becomes a Tier 2 management escalation.
- **Commission tiers and rates** — edit the tier table (management dashboard "Commissions" panel). Never invent or leave a real rate unset; if a rate is unknown, mark it "TBD — do not process payment" rather than guessing.
- **Job-cost categories** — the fixed list from the brief (wall system, base/tub, door/glass, fixtures, installer labour, plumbing, freight, other materials, service/rework) can have subcategories added, not removed.
- **Magic-link expiry** — default 14 days; number of authorized contacts per project — default 2.
- **Review-platform target and satisfaction-survey cadence** — avoid changing this more than once per quarter; frequent changes make review-conversion metrics meaningless.
- **Service-call urgency rules** — which categories auto-flag as emergency.
- **Consent records** — you can view but never delete a consent record; corrections are appended, not overwritten (audit trail).

## What you cannot configure (hard rules, by design)
- AI cannot be granted permission to finalize a customer promise, discount, refund, or warranty decision — this is not a settings toggle.
- The signed-contract PDF is never replaced in place — a correction is always a new version.
- QuickBooks/accounting integration is out of scope for this system; do not attempt to wire one in without a separate, explicit decision outside this project.

## Daily admin routine
1. Check the management dashboard's "Needs attention" panel first — overdue items, missing designs/contracts, incomplete handoffs, integration failures.
2. Clear the AI draft-approval queue (approve, edit, or reject — nothing sits unsent silently).
3. Review aging service calls, especially anything past 48 hours.
4. Once weekly, review the Nightly Reconciliation output for any accumulated discrepancies (`07-system-integration-design.md` §7).
