# AI-Readiness and Voice-Agent Design — Five Star Bath Solutions of Ottawa

Principle: **AI assists employees first.** Nothing in this design lets AI finalize a customer-facing commitment on its own. Every AI output in this system is either (a) an internal draft a human approves, (b) a classification/routing decision with human override, or (c) a narrow, pre-approved low-risk auto-response (e.g., "here's your portal link" style lookups) — never a promise, discount, refund, warranty ruling, or complaint closure.

## 1. Layered rollout (matches phased implementation, see `10-implementation-phases.md`)

**Layer 0 — Structured data foundation (build now, no AI yet).** AI is only as good as the context it's given. This system's data model (appointments, results, proposals, contracts, projects, service calls — see `07-system-integration-design.md`) is designed so every record has: a clear owner, a status, a timestamp, and a link back to the customer/project. This is what makes every later AI layer possible without a rebuild.

**Layer 1 — Employee-assisting AI (near-term, human-in-the-loop):**
- Draft a reply to an incoming customer message for staff to review/send (not auto-send).
- Categorize incoming messages (question / scheduling / complaint / service issue / payment) to route to the right person.
- Summarize a customer conversation thread for a handoff between reps or shifts.
- Detect negative sentiment or urgency keywords ("leak," "no hot water," "can't use my shower") to bump a message to priority queue.
- Convert a sales rep's short voice note into a **draft** post-appointment result form for the rep to review and submit — the rep remains the one who submits.
- Verify required documents exist (3D design present? contract fully executed? photos attached?) and flag gaps — a checklist function, not a judgment call.
- Summarize a service call's history for the technician before a visit.
- Detect a likely repeat/callback pattern (same address, same issue category within N days) and flag it for management review.
- Draft an internal handoff summary from proposal + result data when a job is sold.

**Layer 2 — Narrow approved auto-response (only after Layer 1 is proven reliable):**
- Answering a small, explicitly approved FAQ set (e.g., "what's my balance," "when's my next appointment," "where's my contract") by pulling live project data and replying with a portal link — informational lookups only, never negotiation.
- Auto-acknowledging a service-call submission with "we got this, here's what happens next" (the acknowledgement itself, not a diagnosis or promise).

**Layer 3 — Future voice-agent readiness (not deployed now):**
See §3 below.

## 2. Guardrails (hard rules, not suggestions)

AI in this system must never, without a human confirming first:
- Change a contract value, discount, or scope.
- Promise or move an installation date.
- Approve a refund.
- Make a legal interpretation.
- Make a final warranty/liability decision.
- Close a service call or a serious complaint.
- Invent information not present in the approved knowledge base or the customer's authorized project record.
- Expose internal notes, commissions, costs, margins, or other employees' information to a customer.

Every AI-drafted customer-facing message is logged with: what was drafted, who approved/edited/sent it, and when — this is the audit trail required for both trust and later error analysis.

## 3. Voice-agent readiness (provider-independent)

We are **not** deploying a voice agent now. What we are building now is the boundary a future voice agent (any vendor) would plug into, so switching or adding a provider later doesn't require a rebuild:

- **Context API surface**: a read-only, scoped endpoint returning: customer identity, appointment info, project stage, installation status, open service-call status, and communication history — the same context object the customer portal already renders from (see `07-system-integration-design.md` §Data Model). One data shape, multiple consumers (portal, staff dashboard, future voice agent).
- **Approved FAQ set**: the same Layer 2 FAQ answers, provider-agnostic, stored as structured Q→A pairs rather than baked into any one vendor's prompt format.
- **Escalation/routing rules**: a shared routing table (which issue categories/urgency levels go to which human/department) reused by chat AI, service-call intake, and any future voice agent — defined once in `06-future-state-operating-model.md` §8, not duplicated per channel.
- **Interaction logging contract**: any future voice interaction (recorded where legally permitted, transcribed, summarized) is written into the same communication-history record structure as email/SMS/chat, tagged with customer, project, and service-call IDs, and categorized/escalated using the same rules above — so "voice" is just another channel writing to one history, not a separate silo.
- **No vendor lock-in**: this boundary is a plain data contract (context in, structured intent/response out) rather than a vendor SDK embedded throughout the system, so a specific voice-agent vendor can be evaluated and swapped later against this same interface.

## 4. What "AI readiness" concretely buys the business today, before any AI ships

- Consistent structured data (thanks to Layer 0) is itself an immediate reliability and reporting win, independent of AI.
- The escalation/routing rules and FAQ set double as staff training material even with zero AI in production.
- The audit-trail requirement is good practice regardless of AI and is already required elsewhere in this design (contract delivery, commission adjustments, service-call status changes).
