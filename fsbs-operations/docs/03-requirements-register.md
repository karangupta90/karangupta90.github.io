# Requirements Register — Five Star Bath Solutions of Ottawa

This register separates what was explicitly instructed (confirmed), what had to be assumed to make the system buildable (assumptions — each with a chosen default and a way to reconfigure it), what is only possible in a later phase because it depends on access this environment doesn't have, and ideas explicitly deferred.

## A. Confirmed requirements (directly from the brief — not open for reinterpretation)

- Appointment setting stays manual; the system adds accountability, not automated booking.
- Sales rep must take an **explicit acknowledgement action**; merely opening/viewing an appointment does not count.
- Acknowledgement overdue threshold: **11:00 PM** same day → SMS + email to rep, flagged overdue to management.
- Post-appointment structured result overdue threshold: **9:00 PM** same day → SMS + email to rep, flagged overdue to management.
- A **proposal** exists for every appointment outcome, sold or not; a **contract** exists only when sold. These are never merged into one record.
- Unsold proposals are retained for follow-up/nurture/analysis, never discarded.
- Signed contract must be **emailed to the customer as a PDF attachment immediately on signing** and also stored durably in the customer portal — the current expiring-link-only pattern is being replaced, not merely supplemented.
- Contract delivery failure must alert staff and support manual resend.
- Every completed sales appointment must produce an associated 3D design; missing designs must be flagged to management, not silently dropped.
- Customer portal is the single customer-facing destination; access via **magic link**, no required password.
- Installation dates must be explicitly labeled to the customer as tentative, reserved, or confirmed — never presented as guaranteed until confirmed.
- Service calls are tracked as a workflow fully separate from sales/production, with their own classification, urgency, and lifecycle.
- Active leaks / safety concerns escalate immediately.
- AI may draft/assist/classify but may not autonomously promise dates, offer discounts/refunds, make warranty/liability decisions, or close serious complaints without human confirmation.
- No QuickBooks integration or accounting implementation of any kind.
- Cash payments out of scope initially; e-transfer, cheque, credit card in scope.
- GoHighLevel is the customer communication hub; it is **not automatically** the operational system of record for production, cost, commission, installer, or service data — that's decided per-workflow in the option comparison, not assumed.
- Do not invent commission rates, payment terms, warranty terms, or installation commitments — commission/warranty rules must be configurable by an authorized admin rather than hard-coded by this project.

## B. Assumptions made to keep the project moving (each with default + how to reconfigure)

| # | Unknown | Default assumption | Why this default | How to reconfigure |
|---|---|---|---|---|
| 1 | Exact ServiceMinder role/data model | Treated as the system of record for scheduled jobs/appointments and franchise-required reporting; GoHighLevel treated as the comms/orchestration layer that mirrors a summary into ServiceMinder | ServiceMinder is described as a franchise ops platform; most bath-franchise operators use it for job records; GHL is confirmed as comms-only | Confirm with ServiceMinder admin console + support; adjust `07-system-integration-design.md` field-ownership table |
| 2 | Exact commission structure (tiers, %, discount clawback rules) | A configurable 3-tier flat-rate-on-net-sale model (documented in `06-future-state-operating-model.md` §Commissions) used only as a placeholder structure | Brief explicitly forbids inventing real rates; a configurable shape is needed to build the tracking workflow | Admin edits tier table in the commission config screen (prototype: management dashboard "Commission Rules" panel) |
| 3 | Exact job-cost categories/pricing | Standard categories from the brief (wall system, base/tub, door/glass, fixtures, installer labour, plumbing, freight, other materials, service/rework) with no dollar defaults | Brief lists these categories explicitly; no cost data was provided | Admin edits the cost-category list; costs entered per job |
| 4 | 3D design tool identity/API | Treated as a manual-export tool (image/PDF/link) with no assumed API | No tool named; can't assume integration capability that doesn't exist | Once tool is named, revisit `07-system-integration-design.md` §3D Design for automated push |
| 5 | Whether GHL has a native client-portal product suitable for this use case | Assumed **not sufficient on its own** for the full portal spec (documents, payments, tentative/confirmed dates, service intake) — pending research confirmation | Portal requirements (magic link, plain-language multi-section layout, older-user accessibility) exceed what a generic CRM portal template usually offers | See `04-option-comparison.md`; reverse this if research confirms GHL portal meets the full spec |
| 6 | Installer invoice submission medium | Simple mobile web form (no native app) feeding an approval queue | Matches "extremely simple, mobile-friendly" pattern used elsewhere in the brief | Swap medium later if installers prefer SMS-photo-based submission |
| 7 | Magic-link lifetime | 14 days per link, auto-renewable by requesting a new one via SMS/email at any time; sensitive documents (signed contract) always re-verifiable via a fresh link rather than a single permanent token | Balances "don't require a password" against "don't use a permanent unsecured URL" | Configurable expiry in portal-issuer service config |
| 8 | Multiple homeowners / additional authorized contacts | Support up to 2 authorized contacts per project by default, each with their own magic link tied to the same project record | Reasonable default for a couple who jointly own the home | Admin can add/revoke additional authorized contacts per project |
| 9 | Review-platform target | Google Business Profile as primary ask, with a private-feedback fork for detractors before any public review ask | Universal default for local home-services businesses; avoids gating/deceptive review practices per the explicit prohibition | Swap/add platforms (e.g., HomeStars, which is prominent in Canada) in review-request config |
| 10 | Voice-agent provider | None selected; design keeps a provider-agnostic context/API boundary (see `08-ai-readiness-and-voice-agent-design.md`) | Brief explicitly forbids locking into a provider without strong reason | Select provider in a later phase against the documented interface |
| 11 | Customer language (Ottawa is bilingual English/French) | `language_preference` field added to the customer record from Phase 1 on; English-only message content ships first, French translation is a fast-follow rather than a Phase-1 blocker | Added after independent review (`05-independent-review.md` §5) — Ottawa's bilingual context was missed in the initial design; retrofitting a language field later would touch every table | Add French templates to `communications/customer-messages.md` and set the field per customer |

## C. Configurable business rules (exposed to an authorized admin, not hard-coded)

- Acknowledgement/result overdue thresholds (default 11:00 PM / 9:00 PM, with late-evening-appointment exception windows — see future-state doc §Exceptions).
- Commission tiers and rates.
- Job-cost categories.
- Magic-link expiry and renewal window.
- Number of authorized contacts per project.
- Review-platform choice and satisfaction-survey cadence (to prevent survey fatigue).
- Service-call urgency rules (which categories auto-flag as emergency).
- Installation communication cadence (which reminders fire at which offsets).

## D. External limitations in this environment (documented, not treated as blockers)

- No live credentials/API keys for GoHighLevel, ServiceMinder, One Click Contractor, CompanyCam, Ingage, Helcim, or Make.com exist in this environment. Every integration is therefore designed and specified precisely (endpoints/triggers, payloads, retry rules) and **built against mocked data and static prototypes**, with the exact final connection step documented per integration in `07-system-integration-design.md`.
- No access to the business's actual ServiceMinder schema, GoHighLevel sub-account, or historical job data — defaults above stand in until confirmed.
- No sandbox for Make.com scenario execution — scenarios are specified in enough operational detail (trigger, modules, error path, retry policy) to be built directly by whoever holds the Make.com account.

## E. Future-phase ideas (explicitly deferred, not built now)

- Automated appointment booking / lead routing.
- Fully automated AI customer responses beyond narrow, approved cases.
- Voice-agent deployment.
- Automated ServiceMinder-native two-way sync beyond the documented direction rules.
- Predictive analytics on callback/profitability patterns.
- Native mobile apps (current phase uses mobile web, deliberately, for zero-install adoption).
