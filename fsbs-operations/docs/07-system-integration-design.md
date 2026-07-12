# System and Integration Design — Five Star Bath Solutions of Ottawa

Implements Option 4 (Hybrid) from `04-option-comparison.md`, incorporating every change from the independent review (`05-independent-review.md`).

## 1. Architecture

**The "thin layer" is one small structured database with a REST API in front of it — not a no-code drag-and-drop app, and not a full custom CRM.** This keeps the schema portable (reviewer #1's concern) while staying small enough to build and maintain (the brief's "prefer a smaller reliable system" instruction). Concretely: a relational database (tables below) behind a minimal API that the customer portal, sales-rep prototype, management dashboard, and Make.com scenarios all read from and write to as the single source of truth for the things no existing vendor tool owns reliably.

```
 GoHighLevel  ──(comms)──┐
 CompanyCam   ──(photos)─┤
 One Click    ──(docs)───┤        ┌─────────────────────────┐
 Contractor               ├──────▶│   Make.com orchestration │──────▶  Thin Layer
 Helcim       ──(payments)┤       │ (webhooks, scheduled     │        (DB + API)
 ServiceMinder─(jobs,poll)┘       │  polls, retries, dedup)  │◀──────  reads/writes
                                  └─────────────────────────┘             │
                                                                          ▼
                                                     Customer Portal · Sales-Rep App ·
                                                     Management Dashboard · Service-Call Intake
```

Every external system keeps owning what it's independently good at (per the per-workflow table in `04-option-comparison.md`); the thin layer only holds what has no reliable home today: unified project/status, proposal/contract metadata + the retrieved signed PDF, 3D-design records, service calls, commissions, job costs, installer invoices, consent records, and the audit trail.

## 2. Data model (core tables, field-level ownership marked)

| Table | Key fields | Owning system (source of truth) |
|---|---|---|
| `customers` | name, address, phone, email, **language_preference** (en/fr, added post-review), authorized_contacts[] (max 2 by default), **consent_marketing** {given, timestamp, method}, **consent_photo_video** {given, timestamp, method} | Thin layer (mirrors identity from GHL/ServiceMinder on create, thin layer owns consent fields specifically) |
| `appointments` | date/time, address, assigned_rep, ack_status, ack_label, ack_deadline, result_status, result_deadline, escalation_tier | Thin layer (comms mirrored to GHL, summary mirrored to ServiceMinder) |
| `proposals` | amount, scope, products, initial_price, lowest_price, discount, sold(bool), rep, follow_up_date | Thin layer, sourced from OCC on creation |
| `contracts` | proposal_id, final_price, discount, deposit, signed_pdf_url (thin-layer storage, never OCC's temporary link), version, delivery_status | Thin layer; **document authored in OCC, but the moment it is signed, the PDF itself is retrieved and stored in the thin layer — OCC's own link is never relied upon past that moment** |
| `designs` (3D) | project_id, file/link, version, uploaded_by, uploaded_at, missing_flag | Thin layer (no source tool exists) |
| `projects` | customer_id, contract_id, internal_status, customer_facing_stage, install_tentative/reserved/confirmed dates, handoff_checklist | Thin layer, install-date facts synced from ServiceMinder where ServiceMinder is used for scheduling |
| `service_calls` | project_id, category, urgency, safety_flag, stage, assigned_to, opened_at, resolved_at, reopened_count | Thin layer (no source tool exists) |
| `commissions` | rep, project_id, tier, rate, amount, status (estimated/pending/approved/due/paid/held/adjusted/reversed) | Thin layer, admin-configurable tier table |
| `job_costs` | project_id, category (wall system/base/door/fixtures/installer/plumbing/freight/other/service/rework), amount, month | Thin layer |
| `installer_invoices` | installer, project_id, category, amount, receipt_photo, status | Thin layer |
| `payments` | project_id, amount, method, status, helcim_txn_id | Mirrored summary from Helcim; **Helcim remains the transaction source of truth** |
| `audit_log` | entity, entity_id, field, old_value, new_value, changed_by, changed_at, reason | Thin layer — append-only, never edited or deleted |
| `sync_dedup` | source_system, source_event_id, processed_at | Thin layer — the idempotency table (see §4) |

## 3. Identifiers and matching

- Every external record referenced by the thin layer stores the **external system's own ID** alongside the thin-layer's internal ID (e.g., `contracts.occ_document_id`, `payments.helcim_txn_id`, `photos.companycam_project_id`) — matching is always by the external system's ID, never by fuzzy name/address matching, to prevent the duplicate-customer-record risk named in the brief.
- Customer identity matching across systems (GHL, ServiceMinder, OCC) uses **email + phone as a compound key** at first sync; if a new inbound record doesn't match an existing compound key, it is held in a "needs review" queue rather than auto-created as a possible duplicate — office staff resolve it manually (satisfies the brief's "duplicate records must never disappear silently" requirement).

## 4. Idempotency and error handling (added after independent review)

- Every webhook-driven write checks the `sync_dedup` table for `(source_system, source_event_id)` before writing. If already processed, the event is acknowledged and discarded — this specifically guards against CompanyCam's documented retry-with-backoff behavior and any duplicate OCC webhook delivery.
- Make.com's **Break error handler** is used on every scenario touching the thin layer, so a failed run becomes a stored **Incomplete Execution** (per Make's documented feature) rather than a silently lost update — visible on the management dashboard's "Integration Failures" panel (see prototype).
- Transient errors (`RateLimitError`, `ConnectionError`, `ModuleTimeoutError`) auto-retry per Make's documented automatic-retry behavior; anything else lands in the Incomplete Executions queue for manual review/resolve or bulk-retry via the Make API.
- **ServiceMinder-specific handling:** because research confirmed ServiceMinder has no outbound push, its sync is a **scheduled poll against the Data Subscriber feed** (Appointment Completed, Invoice Generated, Entity Deleted), not an event listener — polling cadence is configurable (default every 15 minutes) and each poll's high-water-mark timestamp is stored so a Make outage doesn't cause missed events, only a delayed catch-up.
- **One Click Contractor-specific handling (highest-risk integration per research):** on receiving the contract-signed webhook (or, if webhook auth/signing proves too weak in practice — research found no confirmed HMAC signing — a scheduled poll as a fallback), the PDF is **fetched and written to thin-layer storage within the same automation run**, before anything else happens. OCC's own presigned link is never stored or referenced again after that run.

## 5. Conflict rules (added after independent review)

**Field-level system-of-record ownership, not "last write wins."** Each field in §2's tables has exactly one owning system. A sync from a non-owning system can only ever *propose* a value; the owning system's value always wins on conflict. Example: ServiceMinder owns the scheduled install date once a job is in production; if the thin layer's own record disagrees after a poll, ServiceMinder's value overwrites the thin layer's, never the reverse, and the overwrite is logged to `audit_log`.

## 6. Monitoring (added after independent review)

A dedicated scheduled Make.com scenario ("Integration Health Check," runs every 30 minutes) checks the last-successful-run timestamp of every other scenario (GHL sync, ServiceMinder poll, OCC contract capture, CompanyCam webhook listener, Helcim webhook listener) and raises an alert to office staff if any scenario has gone stale beyond its expected cadence — directly answering "how will management know it failed" for the automation layer itself, not just for business-process deadlines.

## 7. Reconciliation (added after independent review)

A nightly scheduled scenario ("Nightly Reconciliation") compares thin-layer records against ServiceMinder, OCC, CompanyCam, and Helcim for the prior 24 hours, flagging: contracts signed in OCC with no corresponding thin-layer PDF, CompanyCam projects with no thin-layer photo reference, Helcim transactions with no matching `payments` row, and ServiceMinder jobs with a status the thin layer hasn't caught up to. Discrepancies appear on the management dashboard's Integration Failures panel, never silently self-heal without a log entry.

## 8. Security, permissions, and consent

- **Customer portal access:** magic link only (validated by research — Jobber/Housecall Pro precedent), 14-day expiry, auto-renewable by request, up to 2 authorized contacts per project each with their own link, revocable by staff.
- **Staff permissions:** role-based — sales reps see only their own appointments/results; installers see only their own assigned jobs and invoice history; management sees everything including commissions/costs/margins, which customers and installers never see.
- **Consent (CASL/PIPEDA, added after independent review):** `consent_marketing` and `consent_photo_video` are first-class fields on the customer record, each with timestamp + method, retained 3+ years per CASL. Implied marketing consent from a bare inquiry expires after 6 months per CASL and must not be relied on past that window without renewal.
- **Audit trail:** every write to a contract, commission, service-call status, or consent field is appended to `audit_log` — never overwritten, matching the brief's "do not silently replace a signed contract" and "preserve edit history" requirements.
- **Data residency note (external limitation, per research):** Canadian data residency is unresolved or unconfirmed for GoHighLevel, ServiceMinder, One Click Contractor, CompanyCam, and Ingage. This is logged as an external limitation requiring written vendor confirmation (`03-requirements-register.md` §D) — the thin layer itself should be hosted with Canadian data residency as a selection criterion, since it's the one piece of infrastructure this project fully controls.

## 9. AI integration boundary

See `08-ai-readiness-and-voice-agent-design.md` for the full design. The thin layer is what makes this possible: every AI feature (drafting, classification, summarization) reads from the same structured tables above rather than needing its own separate data pipeline. The **AI draft-approval queue** (added after independent review) is a real table (`ai_drafts`: draft content, source context, status [pending/approved/edited/rejected], approved_by) surfaced on the management dashboard, not an implied step.

## 10. Make.com scenario specifications (named, buildable directly against the account holder's live credentials)

| Scenario | Trigger | Core steps | Error path |
|---|---|---|---|
| Appointment Booked → Confirm & Assign | Manual booking entered in thin layer (or GHL, per office workflow) | Create thin-layer appointment record → send GHL confirmation SMS/email → notify assigned rep | Break handler → Incomplete Execution → office alert |
| Acknowledgement Overdue Check | Scheduled (hourly, effective deadline 11:00 PM w/ exceptions) | Query unacknowledged appointments past deadline → Tier 1 SMS+email to rep → Tier 2 escalate to management if repeat/no-response | Same |
| Post-Appointment Result Overdue Check | Scheduled (hourly, effective deadline 9:00 PM w/ exceptions) | Same two-tier pattern as above | Same |
| Contract Signed → Capture & Deliver | OCC webhook (contract fully executed) | Dedup check → fetch signed PDF → store in thin layer → email customer w/ attachment or portal-only link if oversized → mark delivery status → alert office on failure | Break handler; resend action available to staff |
| CompanyCam Photo Sync | CompanyCam webhook (photo/project events) | Dedup check → store reference (not a duplicate copy) against project | HMAC signature verified per CompanyCam docs; Break handler on mismatch |
| Helcim Payment Sync | Helcim webhook (`cardTransaction`) | Dedup check → update `payments` summary → trigger payment-received message (respecting cooldown rule) | HMAC-SHA256 verified per Helcim docs; Break handler |
| ServiceMinder Poll Sync | Scheduled (default 15 min) | Query Data Subscriber feed since last high-water-mark → apply field-level-owned updates → advance high-water-mark | Failure leaves high-water-mark unchanged (safe re-poll) |
| Installation Milestone Messaging | Scheduled + status-change trigger | Send tentative/confirmed/2-week/final-reminder messages per `06-future-state-operating-model.md` §7, respecting cooldown | Break handler |
| Service-Call Intake → Notify | Customer portal submission | Create service_call record → classify urgency → if safety/leak flag, immediate human alert (SMS+call task) → else standard queue → send acknowledgement message | Break handler |
| Integration Health Check | Scheduled (30 min) | Check last-successful-run of every other scenario → alert if stale | N/A (this *is* the alerting layer) |
| Nightly Reconciliation | Scheduled (daily) | Cross-check thin layer vs. OCC/CompanyCam/Helcim/ServiceMinder → flag discrepancies | Writes to Integration Failures panel |

## 11. External limitations and exact final connection steps

For each integration above, this project has specified the trigger, payload handling, and error path in enough detail to be wired up directly once credentials exist. The exact final connection step per system:

- **GoHighLevel:** create a Private Integration Token (or Marketplace OAuth app) scoped to contacts/opportunities/custom-objects/workflows; supply to Make.com's native GHL app.
- **ServiceMinder:** obtain an org-scoped API key from Control Panel → API Keys; confirm the Data Subscriber feed's exact event list and polling auth pattern directly with ServiceMinder support (research flagged this as under-documented publicly).
- **One Click Contractor:** confirm current webhook documentation directly with OCC support (the public page 404'd during research) and confirm whether HMAC signing is available; if not, add a scheduled poll fallback for contract-signed detection.
- **CompanyCam:** confirm current plan includes API access (Pro/Premium/Elite per research) and generate an API key or OAuth app credential.
- **Ingage:** contact Ingage support directly to ask about a private/partner API, since none is publicly documented; in the meantime, treat photos/presentation data as manual export only.
- **Helcim:** generate an API token from the merchant account; confirm directly whether a customer-facing Interac e-Transfer checkout option exists (research found "Faster Deposits" payout-speed only, not a confirmed customer-facing e-Transfer checkout).
- **3D design tool:** once selected, revisit this document for an integration path; until then, the sales-rep prototype's manual upload flow is the interim mechanism and is not a placeholder to be embarrassed about — it satisfies the "every completed appointment has a design on file" requirement even without automation.
