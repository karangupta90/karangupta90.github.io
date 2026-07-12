# Implementation Phases — Five Star Bath Solutions of Ottawa

Sequenced by value-to-complexity ratio and dependency order (you can't confirm installation dates reliably before the sold-job handoff exists; you can't track profitability before job-cost capture exists). Each phase is usable on its own — this is not a big-bang rollout.

## Phase 1 — Sales appointment accountability (highest value, lowest complexity)
Explicit acknowledgement action, 11:00 PM overdue rule + exceptions, structured post-appointment result with conditional fields, 9:00 PM overdue rule, management overdue visibility. *Built in this project as the sales-rep prototype.*
**Why first:** fixes the most immediate accountability gap with no dependency on other systems.

## Phase 2 — Customer appointment communication
Confirmation, reminder, reschedule, cancellation messages tied to the booked appointment. *Content built in this project (`communications/customer-messages.md`); wiring is a GoHighLevel workflow.*

## Phase 3 — Proposal, contract, and 3D-design capture
Structured proposal record (sold or not), contract capture tied to the proposal, required 3D-design upload with missing-item flagging. *Data model and upload UX built in this project (sales-rep prototype + system design doc).*

## Phase 4 — Post-sale communication and signed-contract delivery
Replace the expiring-link pattern: PDF email attachment + durable portal storage, delivery-failure alerting and resend. *Fully specified in `06-future-state-operating-model.md` §6; requires One Click Contractor's actual document-retrieval capability to wire live (see external limitations).*

## Phase 5 — Customer portal
Magic-link access to overview/appointments/design/documents/payments/status/messages/prep/service. *Built as a working static prototype in this project; production version needs a backing data API (see `07-system-integration-design.md`).*

## Phase 6 — Installation communication
Tentative/reserved/confirmed date lifecycle, 2-week and pre-arrival reminders, delay notices. *Content and status model built in this project; scheduling data comes from ServiceMinder/production system once confirmed.*

## Phase 7 — Service calls
Separate intake, classification, urgency, lifecycle, reporting. *Built as a working prototype in this project.*

## Phase 8 — Payment visibility
Deposit/balance/receipt display in portal and management dashboard, reminders. *Built into portal + management prototypes; live data needs Helcim webhook wiring.*

## Phase 9 — Commissions and profitability
Configurable commission tiers, job-cost capture, installer invoices feeding profitability. *Data model + management-dashboard views built in this project with placeholder configurable rates (never invented real ones).*

## Phase 10 — AI assistance (Layer 1 only)
Draft responses, categorization, summarization, missing-document checks, voice-note-to-draft-result — always human-approved. *Design done in this project (`08-ai-readiness-and-voice-agent-design.md`); no AI is deployed live here.*

## Phase 11 — Voice-agent readiness
Provider-agnostic context/escalation/logging boundary exists from Phase 1 onward (structured data), but an actual voice agent is deliberately **not** scoped for this rollout.

## Sequencing notes
- Phases 1–2 can go live in parallel; both only need the existing appointment-booking step as an input trigger.
- Phase 4 depends on Phase 3 (can't deliver a durable contract without the contract-capture record existing).
- Phase 5 (portal) is most valuable once Phases 3–4 exist (nothing to show otherwise) but the portal shell itself can launch alongside Phase 2 with "your appointment is booked" as the only content, then grow.
- Phase 9 depends on Phase 3 (contract $ figures) and Phase 6/7 (install/service cost inputs).
- Do not start Phase 10 before Phases 1–3 are stable — AI drafting from messy/incomplete data produces unreliable drafts and erodes trust in the tool.
