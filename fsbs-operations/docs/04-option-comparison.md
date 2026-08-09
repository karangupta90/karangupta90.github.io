# Option Comparison — Five Star Bath Solutions of Ottawa

Grounded in `02-research-report.md`. Four architecture options are compared, then applied per-workflow, because the research shows the right answer genuinely differs by workflow (e.g., communication vs. document-of-record vs. field data capture).

## The four options

**Option 1 — Configuration-first (use existing systems only).** Configure GoHighLevel + ServiceMinder + One Click Contractor + CompanyCam + Helcim more fully, with Make.com stitching them together. No new interfaces built.

**Option 2 — Low-code/no-code operating layer.** Add a no-code app/database layer (e.g., a lightweight portal + form/workflow builder) as the system of record for what the existing tools can't reliably hold (proposals+contracts+3D-designs+service-calls+commissions+profitability), still using Make.com as the connective tissue.

**Option 3 — Custom/semi-custom interface.** Build bespoke web applications (sales-rep app, customer portal, management dashboard, service-call system) backed by a custom data model and API.

**Option 4 — Hybrid.** Use existing systems for what they're already good at and verifiably reliable for (GHL=comms, CompanyCam=photos, Helcim=payments, OCC=proposal/contract authoring), and add a **purpose-built thin layer** — not a full custom CRM, not a generic no-code database — specifically for the things research showed have no reliable home today: the unified project/status record, the 3D-design association, the service-call lifecycle, commissions, and the customer portal presentation layer. Make.com remains the integration/orchestration layer throughout.

## Evaluation

Scored 1 (poor) – 5 (excellent) against the criteria the brief specifies. These scores reflect the *architecture as a whole*, not any single tool in isolation.

| Criterion | Opt 1: Config-first | Opt 2: No/low-code layer | Opt 3: Full custom | Opt 4: Hybrid |
|---|---|---|---|---|
| Ease of use (staff) | 2 — reps juggle 5+ separate tools with no unified task list | 4 | 4 | **5** |
| Ease of use (customer) | 1 — no unified customer view exists in any single existing tool | 4 | 4 | **5** |
| Reliability | 2 — ServiceMinder is poll-based, OCC's link is fragile, no error visibility exists today | 3 | 4 | **4** |
| Customer experience | 1 | 4 | 4 | **5** |
| Staff adoption risk | 3 — no new tool to learn, but no coherence either | 3 | 2 — steepest learning curve, longest build | **4** |
| Mobile usability | 2 | 4 | 4 | **5** |
| Integration complexity | 3 — fewer new pieces, but forcing incompatible data models into GHL is itself complex | 3 | 2 — most integration surface to build and maintain | **4** |
| Maintenance burden | 3 | 3 | 2 — a full custom stack is the most expensive to keep running | **4** |
| Cost | **4** (cheapest, uses what's already paid for) | 3 | 1 (highest) | 3 |
| Time to implement | **4** | 3 | 1 | 3 |
| Scalability | 2 — hits the same walls as today, just automated | 3 | **5** | 4 |
| Data ownership | 2 — data trapped across 5+ vendor silos | 3 | **5** | 4 |
| Vendor lock-in | 2 | 3 | **5** | 4 |
| AI readiness | 2 — no structured data model to feed AI | 3 | 4 | **4** |
| Voice-agent readiness | 2 | 3 | 4 | **4** |
| Security/permissions control | 2 | 3 | **5** | 4 |
| Failure recovery/visibility | 1 — nothing today | 3 | 4 | **4** |
| Suitability for older customers | 1 — no customer-facing surface exists at all | 4 | 4 | **5** |
| **Total (/90)** | 37 | 58 | 65 | **71** |

## Why Option 4 (Hybrid) wins — and why not the highest-scoring pieces of Option 3

Option 3 (full custom) scores well on scalability/ownership/security in the abstract, but the brief explicitly instructs "prefer a smaller reliable system over a larger complicated system" and "do not select the most technically sophisticated option unless it also produces the best business outcome." A fully custom system means rebuilding CompanyCam-grade photo tooling, Helcim-grade PCI-compliant payments, and OCC-grade e-signature/estimating from scratch — all solved problems the business already pays for and that reps already use. That is complexity for its own sake, explicitly prohibited.

Option 1 (config-only) fails the reliability and customer-experience bar outright: the research confirms ServiceMinder can't push events in real time, OCC's contract link is fragile, and *no* existing tool in the stack offers the kind of unified, older-customer-friendly portal the brief requires (Bath Fitter, the closest comparable, doesn't have one either).

**Option 4 keeps every tool doing only what it's independently good at and verified to do reliably**, and adds the smallest possible new surface — one thin operational layer holding the records that today have no reliable home (unified project status, 3D-design association + versioning, service-call lifecycle, commission/job-cost tracking, and the portal presentation itself) — connected via Make.com, which the research confirms has adequate (if not perfect) retry/error-visibility primitives (Incomplete Executions, Break handler, Data Store for dedup) to build the reliability guarantees the brief requires.

## Per-workflow decisions (the option can differ by workflow, per the brief)

| Workflow | System of record | Why |
|---|---|---|
| Customer communication (email/SMS, confirmations, reminders) | **GoHighLevel** | Brief mandates this; GHL's API/webhook/workflow engine is confirmed capable |
| Sales-rep appointment acknowledgement + post-appointment result | **Thin layer (new)**, mirrored into GHL for comms triggers and a ServiceMinder summary via scheduled sync | No existing tool captures structured, conditional, deadline-tracked results; GHL custom objects *could* technically hold this, but a purpose-built mobile form (this project's prototype) is simpler for reps than configuring GHL custom-object forms for every conditional branch |
| Proposal + contract capture | **One Click Contractor remains source of truth for the document itself**; the thin layer stores the **retrieved PDF + structured metadata** (never OCC's temporary link) the moment the webhook fires | Matches the brief ("OCC should remain an important source") while fixing the fragile-link problem the research confirmed |
| 3D design | **Thin layer**, since the tool is unnamed/unintegrated; manual upload from the sales-rep prototype | No integration possible until the tool is chosen; must not be lost in the meantime |
| Photos | **CompanyCam remains source of truth**; thin layer stores a reference/link, not a duplicate copy | CompanyCam's API/webhooks are the best-documented and most reliable in the entire stack — no reason to duplicate its job |
| Payments | **Helcim remains source of truth for transactions**; thin layer stores payment status/history summary for portal display | Helcim is PCI-DSS Level 1 and Canadian-headquartered; duplicating payment processing anywhere else would be a security and compliance regression |
| Scheduled jobs / franchise reporting | **ServiceMinder remains source of truth**; thin layer holds a status summary synced on a schedule (poll-based, per research) | Confirmed as the franchise ops system; research shows it cannot push in real time, so the sync design accounts for that rather than pretending otherwise |
| Service calls | **Thin layer (new)** | Brief requires full separation from sales/production; no existing tool in the stack has this lifecycle |
| Commissions / job-cost / profitability | **Thin layer (new)** | Explicitly out of scope for GHL-as-database per the brief; no other tool in the stack does this at all |
| Installer invoices | **Thin layer (new)**, simple mobile form | Matches "extremely simple, mobile-friendly" requirement; no existing tool covers this |
| Customer portal | **Thin layer (new)**, presentation layer only, reads from the systems above | No existing tool in the stack (or in the researched competitive set) offers the full spec; magic-link precedent confirmed by Jobber/Housecall Pro research |

## Rejected approaches (and why)

- **Native GHL Client Portal/Communities as the sole customer destination:** Considered directly (GHL does ship this — confirmed in research). Rejected as the *sole* portal because it's built around courses/community/membership content, not project-status/document/payment presentation with the specific tentative-vs-confirmed-date and service-intake requirements this brief specifies; also its branded-mobile-app add-on pricing is unconfirmed and the underlying data (proposals, 3D designs, service calls) doesn't live in GHL by design. Kept as a *fallback/consideration* for Phase 5 if building even a thin custom portal proves infeasible for the business to maintain long-term — documented as a configurable option, not a rejection of GHL generally.
- **Forcing all ServiceMinder data through GHL as the single pipe:** Rejected per explicit brief instruction and confirmed by research showing ServiceMinder has no reliable outbound push — a poll-based direct integration is more honest than pretending GHL can mediate events ServiceMinder itself can't emit in real time.
- **Zapier instead of Make.com:** Not seriously evaluated — Make.com is already in place per the brief, and research found no case where Zapier's thinner OCC/ServiceMinder/Helcim connectors would outperform a direct HTTP-module build in Make.com.

## Selected option

**Option 4 (Hybrid), with per-workflow system-of-record assignments above.** Documented in full in `07-system-integration-design.md`.
