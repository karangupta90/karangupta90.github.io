# Future-State Operating Model — Five Star Bath Solutions of Ottawa

This is the target operating model: who owns what, what's due when, what happens on failure. It is system-agnostic here; `07-system-integration-design.md` maps each responsibility onto a specific tool.

## 1. Roles and ownership

| Role | Owns | Never does |
|---|---|---|
| Office / scheduler | Manual appointment booking, rep assignment, customer confirmation trigger | Does not need to chase reps manually once acknowledgement/overdue automation is live |
| Sales representative | Acknowledgement, in-home consultation, proposal, 3D design upload, photos, post-appointment result | Cannot mark a job "sold" without a contract on file; cannot skip required result fields |
| Management | Overdue escalation, missing-item resolution, commission approval, profitability review, service-call oversight, correction of submitted results | Does not manually track any of this in a spreadsheet once the dashboard is live |
| Production coordinator | Sold-job handoff intake, material ordering/tracking, installer assignment, installation status | Cannot schedule an install date as "confirmed" without material + measurement readiness checks passing |
| Installer | Installation execution, quality checklist, invoice submission | Does not have access to commissions, margins, or other installers' pay |
| Customer | Views status, documents, payments, messages; reports service issues | Never sees internal cost/margin/commission data |
| AI (assistive layer) | Drafts, classifies, summarizes, flags | Never finalizes a customer promise, discount, warranty decision, or closes a serious complaint alone |

## 2. Workflow: Appointment → Acknowledgement

```
Office books appointment (manual)
 → Confirmation sent to customer (auto)
 → Appointment assigned to rep, delivered to rep's mobile view (auto)
 → Rep takes explicit action: Received & reviewed / Need more info / Scheduling conflict /
   Info looks wrong / Unable to attend (manual, required)
 → If no action by 11:00 PM same day → SMS + email to rep, "Acknowledgement overdue" flag
   raised to management dashboard (auto)
```

**Exceptions:**
- Appointment assigned after 9:00 PM for the same day, or for an appointment happening the next morning before 9:00 AM: the 11:00 PM deadline is replaced by "acknowledge within 2 hours of assignment, or by the appointment start time, whichever is sooner." This prevents a same-evening assignment from being auto-flagged overdue at 11:00 PM when the rep reasonably has until morning.
- Appointment assigned on a day the rep is marked unavailable, **or during a rep's scheduled time off/sick leave**: skip acknowledgement chase entirely, auto-alert management to reassign instead of chasing an absent rep. (Added after independent review — the original exception only covered a single late-evening edge case, not a whole day or multi-day absence.)

**Escalation tiers (added after independent review, to avoid alert fatigue):** a missed deadline is not immediately a management-visible incident.
- **Tier 1 — first miss:** automated SMS + email reminder to the rep only. Shown on the rep's own task list as overdue, but not yet escalated.
- **Tier 2 — second consecutive miss on the same appointment, or no rep response within 2 hours of the Tier 1 reminder:** escalates to the management dashboard as a genuine intervention item.
This keeps the dashboard meaningful — management sees real problems, not every evening's ordinary stragglers.

## 3. Workflow: In-home appointment → Post-appointment result

```
Appointment occurs
 → Rep submits structured result by 9:00 PM same day (manual, required, conditional fields
   based on outcome selected)
 → If "Sold": proposal + contract capture triggers Sold-Job Handoff (§5)
 → If not sold: proposal retained, follow-up date required if "Standby/Follow-up" selected
 → 3D design + photos flagged as required/complete
 → If not submitted by 9:00 PM → SMS + email to rep, "Result overdue" flag to management
```

**Exceptions:** same late-evening-appointment logic as acknowledgement — deadline becomes "by 9:00 PM or 2 hours after the appointment's scheduled end, whichever is later," so a 7:30–9:00 PM appointment isn't auto-flagged the instant it ends. The same whole-day-off exception and two-tier escalation (Tier 1 rep reminder, Tier 2 management escalation on a second miss) from §2 apply here as well.

**Contradiction/validation guardrails:**
- Cannot select "Sold" without a linked contract record.
- Cannot select "Financing pending" and "Deposit collected" simultaneously without a note.
- Discount % and discount $ must reconcile against initial vs. final price (system calculates one from the other; rep confirms).
- "Other approved outcome" requires a free-text explanation — no unexplained miscellaneous outcomes.
- Management can return a submitted result for correction; every edit is retained as history, not overwritten.

## 4. Statuses: internal vs. customer-facing

Internal statuses can be granular; the customer only ever sees the simplified set.

| Internal status (examples) | Customer-facing stage |
|---|---|
| Lead / appointment booked | Consultation scheduled |
| Appointment completed, result submitted | Consultation completed |
| Proposal created, unsold | *(not shown to this customer unless they buy later — proposal record persists internally for follow-up)* |
| Contract signed, deposit pending | Contract signed |
| Contract signed, deposit received, handoff created | Project review |
| Measurements confirmed, materials ordered | Materials in progress |
| Materials received, install not yet dated | Installation scheduling |
| Install date reserved (not yet confirmed) | Installation scheduling — tentative date shown, clearly labeled "tentative" |
| Install date confirmed | Installation confirmed |
| Install in progress | Installation in progress |
| Install complete, QC passed, balance outstanding | Installation complete — balance due |
| Balance paid, review requested | Follow-up |
| Closed | Project complete |
| Any open service call | Shown as its own item, never merged into the project timeline above |

## 5. Sold-Job Handoff (the moment nothing may depend on an informal message)

Trigger: rep marks result "Sold" **and** a completed contract record exists.

Automatic actions:
1. Signed contract emailed to customer as PDF attachment + stored in portal (see §6).
2. Proposal, 3D design, and photos linked to the new project record.
3. Deposit amount/method recorded from Helcim.
4. Requested/tentative install timing captured from rep notes.
5. Post-sale project record created with a completeness checklist (contract ✓/✗, design ✓/✗, photos ✓/✗, deposit ✓/✗, measurements pending).
6. Any missing item is flagged on the management dashboard as "Handoff incomplete" — production is not silently handed a partial file.
7. Production coordinator notified (not "may check eventually" — an explicit assignment with a due date, default next business day).
8. Customer receives welcome communication (see `communications/customer-messages.md`) explaining what happens next.

## 6. Signed Contract Delivery (replacing the expiring-link pattern)

1. On full execution, the final signed PDF is retrieved from the proposal/contract source of truth (see `07-system-integration-design.md` §Proposal & Contract).
2. System verifies the PDF is the fully-executed version (all required signature fields present) before sending — never emails a draft.
3. Email sent to customer with the PDF attached (if under a safe attachment-size threshold, default 15 MB) **and** a portal link to the same document for permanent access either way.
4. If the attachment exceeds the size threshold, the email omits the attachment and instead states clearly that the contract is available securely in the portal, with the magic link.
5. Delivery status (sent / bounced / failed) recorded against the project.
6. Failed delivery raises an alert to office staff with a one-click resend action.
7. Any later revision or change order becomes a **new versioned document**, never an overwrite — the customer's document list shows version history with dates.

## 7. Installation Date Lifecycle

`Customer-requested timing → Tentative → Reserved → Confirmed → (Rescheduled) → Started → Completed`

- Only "Confirmed" is ever described to the customer without a qualifier.
- "Tentative" and "Reserved" are always shown with explicit language ("this date is being held but not yet finalized — we'll confirm it by [X]").
- A rescheduled date resets to "Confirmed" only once the new date is actually finalized with the customer, not merely proposed internally.
- Communication sequence (detail in `communications/customer-messages.md`): entering production → tentative timing → confirmed date → ~2-week reminder → few-days-before prep info → final reminder before arrival → any delay notice → completion message → outstanding-balance follow-up.

## 8. Service-Call Lifecycle (fully separate from sales/production)

`Received → Acknowledged → Info requested (if needed) → Under review → Triage complete →
 Appointment required → Scheduled → Assigned → Waiting for parts/manufacturer (if needed) →
 Visit completed → Follow-up required (if needed) → Resolved → Closed → (Reopened if needed)`

- Safety concern or active leak: immediate escalation path — acknowledgement target measured in minutes, not the standard SLA; routed to a human immediately, never queued behind routine tickets.
- AI may classify/triage but the "Resolved/Closed" transition always requires human confirmation.
- Reopened calls are tracked as a distinct metric (repeat-call rate) rather than silently becoming a new ticket.

## 9. Commissions (structure configurable — see requirements register item B2 for the placeholder rates)

`Estimated → Pending → Approved → Due → Paid`, with side-states `Held` (e.g., pending install/collection) and `Adjusted`/`Reversed` (e.g., cancellation, chargeback). Commission tier keyed off discount depth so heavier discounting doesn't pay full commission — the exact tier boundaries are an admin-configurable table, not invented here.

## 10. Installer Invoices

`Submitted → Under review → (Correction requested) → Approved (full or partial) / Rejected →
 Scheduled for payment → Paid`. Approved amounts feed job-level profitability automatically — no separate manual re-entry into a cost report.

**Kept to 5 fields or fewer, photo-of-receipt first** (added after independent review — an installer will bypass anything resembling a multi-field expense form and just call the office, recreating the informal-coordination problem this project exists to remove): project/customer picker, amount requested, category (standard pay / approved extra work / materials / travel), a single photo-of-receipt upload where applicable, and an optional one-line note.

## 12. Communication Frequency Cooldown (added after independent review)

No customer should receive more than one non-urgent message in a 24-hour window unless it's a direct reply to something they initiated, or a safety/active-leak escalation. Before sending a satisfaction survey, payment reminder, or review request, the system checks whether another non-urgent message already went out in the prior 24 hours and, if so, queues it for the next available slot instead of stacking messages. This directly addresses the "survey fatigue" risk named in the brief and reinforced by the CX-leader review.

## 13. Consent Capture (added after independent review — CASL/PIPEDA)

Two consent moments are recorded as first-class data, not assumed:
- **At appointment booking:** SMS/email marketing consent (CASL), recorded with timestamp and method (verbal-over-phone-logged-by-office, or a checkbox if booked online). Implied consent from an inquiry is treated as valid for 6 months only, per CASL — communications must not rely on stale implied consent past that window without renewed express consent.
- **At the start of the in-home appointment:** consent to photograph/video the home (PIPEDA — photographing a private space is collection of personal information per OPC guidance), recorded the same way.

Both consent records are retained for at least 3 years after the relationship ends (CASL's proof-of-consent retention rule) and are stored as fields on the customer/project record in the thin layer (see `07-system-integration-design.md`), not left implicit.

## 11. Manual overrides (every automated status must have one)

- Management can manually mark an acknowledgement/result as resolved with a note, even if the rep's own action never came in (e.g., rep called in sick — office confirms verbally and logs it).
- Management can manually re-associate a misfiled design/photo/document to the correct project.
- Management can manually override a commission calculation with a required reason (retained in audit history).
- Office can manually mark a synced record as "resolved externally" if an integration permanently cannot recover (with reason logged).
