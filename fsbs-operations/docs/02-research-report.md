# Research Report — Five Star Bath Solutions of Ottawa

Two independent research passes were run: (A) how leading home-services / appointment-based residential-service companies handle customer experience and operations, and (B) the actual documented capabilities of this business's specific tool stack (GoHighLevel, ServiceMinder, One Click Contractor, CompanyCam, Ingage, Helcim, Make.com). Every claim below is labeled **Verified** (primary source, e.g., official docs/gov pages), **Observed practice** (documented but from vendor marketing or secondary sources), or **Unverified** (could not confirm — flagged, not assumed). No statistic or capability is stated without a source; where research hit a dead end, that is reported as a gap rather than filled with a guess.

---

## Part A — Industry and Customer-Experience Research

### A1. Customer portals in home services

- **Verified** — Renewal by Andersen's *myPROJECT* portal (comparable direct-in-home-sales window/door business) auto-provisions after purchase and shows real-time progress, appointment reminders, a documents tab (contract/addenda/warranties), a service-request channel, and past-project history. [renewalbyandersen.com/campaign/explore-myproject](https://www.renewalbyandersen.com/campaign/explore-myproject)
- **Verified** — ServiceTitan's Customer Portal (underlies many HVAC/plumbing/roofing franchises) shows invoice history/online payment, a memberships/contracts tab, and appointment-request submission. Account creation is email+password, **not** magic-link by default. [help.servicetitan.com/docs/customer-portal-overview](https://help.servicetitan.com/docs/customer-portal-overview)
- **Verified, directly applicable** — Two leading field-service SaaS platforms have both standardized on **magic-link-only customer authentication**: Jobber's Client Hub (email/SMS link, re-verification via email or last-4-of-phone after 14 days) and Housecall Pro's Customer Portal (7-day link lifespan, auto-resend on expiry click). This is strong precedent for an older, low-password-tolerance customer base and directly informed our magic-link design (`03-requirements-register.md` item B7). [help.getjobber.com](https://help.getjobber.com/hc/en-us/articles/360046586294) · [help.housecallpro.com](https://help.housecallpro.com/en/articles/8474580-customer-guide-to-the-portal)
- **Unverified/likely does not exist** — Bath Fitter (closest direct competitor) does not appear to offer a genuine customer-facing project-tracking portal; only internal franchise-employee tools were found. **This is a real competitive opening**, not something to copy.
- **Observed practice, useful negative example** — PODS' portal explicitly does **not** offer real-time tracking once a delivery window passes — a documented gap we deliberately avoid by keeping the portal's "what happens next" language honest about what is/isn't live-tracked.
- **Observed practice** — Servpro/ServiceMaster Restore rely on structured *human* callback cadences (e.g., agent callback within 24 hours) rather than a self-service portal — reinforces that a portal alone isn't sufficient; the communication cadence around it (this project's `06-future-state-operating-model.md`) matters as much as the portal itself.

### A2. Appointment communication

- **Verified** — ServiceTitan's Contractor Playbook and product docs document the converged industry pattern: automated confirmation → night-before reminder → "on our way" dispatch text, with optional GPS ETA. This pattern is echoed in Jobber/Housecall Pro's combined appointment-and-billing thread design. This directly shaped `communications/customer-messages.md` items 1–4.

### A3. Sales-rep accountability / speed-to-lead

- **Verified, correcting a common misattribution** — The "leads contacted in 5 minutes are 100x more reachable" stat traces to a 2007 MIT/InsideSales study, not HBR as often cited. The genuine HBR source (Oldroyd, McElheran & Elkington, *"The Short Life of Online Sales Leads,"* HBR March 2011, 2,241 companies audited) found **average response time was 42 hours**, **23% of companies never responded at all**, and firms responding within 1 hour were **7x more likely to qualify** the lead. [hbr.org/2011/03/the-short-life-of-online-sales-leads](https://hbr.org/2011/03/the-short-life-of-online-sales-leads)
- **Evidence gap** — No documented Leaf Home-specific (or other in-home-sales franchise) internal accountability-system data was found; do not attribute specific numbers to a named competitor without a primary source.
- **Design implication (our inference, not a cited stat):** the 11:00 PM / 9:00 PM accountability windows in this project exist precisely because the literature shows response-time discipline correlates with outcomes, even though no single "correct" deadline number exists in the sources.

### A4. Contract/proposal delivery

- **Verified, directly validates the brief's stated problem** — DocuSign's own support docs confirm unauthenticated-recipient links **expire after 5 clicks or 48 hours**, whichever comes first, unless recipient authentication is enabled or the recipient has a DocuSign account to log in directly. Community threads corroborate real customer confusion from exactly this failure mode. This is the same class of problem as One Click Contractor's expiring link (see Part B), and confirms the fix (durable portal storage + immediate PDF capture) is addressing a documented, common industry failure — not a hypothetical one. [support.docusign.com](https://support.docusign.com/s/articles/Email-link-expiration-FAQ)
- **Verified** — PandaDoc's own security guidance recommends unique per-recipient links with optional identity verification and audit trails for sensitive documents — consistent with this project's approach.

### A5. Service-call / warranty-callback handling

- **Verified, range not a single figure** — Industry-average First-Time-Fix Rate is commonly cited around 75–80% (Aberdeen Group figure), with best-in-class providers at 88–98% (ServiceTitan). A failed first visit is estimated (lower-confidence, secondary source) to add ~14 days and 2 extra visits to resolve.
- **Verified** — ServiceTitan's Contractor Playbook defines a callback/recall as a tech error/omission within 30 days of service or 1 year of an install, with a healthy warranty-cost target of 0.5–3% of revenue, and a workflow of flag → fix → 24-hour customer follow-up → review in tech meetings. This directly informed the service-call lifecycle and reporting metrics in this project (`06-future-state-operating-model.md` §8, `11-success-metrics.md`).
- **Low confidence** — A commonly cited "$80,000/year in callback costs for a $2M contractor at 5% callback rate" figure traces to a secondary citation of ACCA research that could not be independently verified — reported here only as a low-confidence figure, not used as a design input.

### A6. AI and voice-agent adoption in home services (2025–2026)

- **Verified, current, primary source** — ServiceTitan's own 2026 "State of AI in the Trades" survey (1,032 contractors, 7 trades): ~25% residential AI adoption; 62% of adopters report measurable efficiency gains; contractors reporting measurable AI business impact rose from 17% (2025) to 38% (2026); top barriers are lack of training (44%) and integration complexity (44%). This is direct evidence for this project's phased, human-in-the-loop AI approach (`08-ai-readiness-and-voice-agent-design.md`) rather than a big-bang AI rollout.
- **Verified** — Housecall Pro's "CSR AI" is a real, shipping 24/7 AI phone/chat answering product for trades, configurable for primary or after-hours coverage.
- **Correction to a common trade-press conflation** — "Numa," sometimes cited as a home-services AI answering example, is actually built for **auto dealership** service departments, not contractors. It is not cited as a comparable in this project.

### A7. Older-customer / accessibility research

- **Verified, authoritative** — Nielsen Norman Group's senior-citizen UX research (three rounds over 19 years, 87 guidelines): sliders/dropdowns are disproportionately hard on touch interfaces for users with reduced motor skills; tiny tap targets and unexplained browser jargon are recurring failure patterns. Directly shaped this project's tap-target sizing (48px minimum), plain-language rule, and avoidance of slider-style controls in the prototypes.
- **Verified, strong justification for the entire accessibility posture of this project** — AARP's 2024 Tech Trends survey: **64% of adults 50+ do not feel technology today is designed with their age in mind.** This is the single strongest citation for why this system treats "design for the least technically confident customer" as non-negotiable rather than a nice-to-have.
- **Verified** — WCAG 2.2 (W3C, Oct 2023/Dec 2024) specifically improved focus-indicator visibility and touch-target sizing — both directly reflected in `prototype/assets/style.css`.

### A8. Canadian-specific considerations

- **Verified, strong case for e-Transfer as a first-class payment rail** — Interac e-Transfer volume exceeded 1.4 billion transactions in 2024; ~90% of Canadians use Interac; ~50% of Canadian businesses already use it; the "Request Money" invoicing feature alone saw 89.2 million transactions in 2024. This directly supports keeping e-transfer as an equal, first-class payment method in this project (not a card-first design with e-transfer as an afterthought).
- **Verified, official OPC source** — PIPEDA requires "meaningful consent" disclosed at or before collection; OPC has treated photographing/video of a person's private space (e.g., their home) as personal-information collection requiring notice/consent (Case Summary #2006-349) — directly relevant to CompanyCam photo/video capture and this project's consent-recording requirement (see `07-system-integration-design.md` §Security & Consent).
- **Verified, official CRTC/ISED source** — CASL is opt-in (unlike US CAN-SPAM), covers SMS as well as email, requires sender ID + working unsubscribe honored within 10 business days, requires 3-year proof-of-consent retention, and implied consent from an inquiry is time-limited to 6 months. Penalties up to $10M per violation for a corporation. This is a hard compliance requirement, not a design preference — every automated SMS/email in this project's communication library must have a recorded consent basis and a working opt-out.

---

## Part B — Vendor Stack Capability Research

Full detail lives in `07-system-integration-design.md`; findings summarized here per tool, each flagged by confidence.

| Tool | Outbound events | Confirmed native bridge to other stack tools | Key risk found |
|---|---|---|---|
| **GoHighLevel** | REST API v2 (OAuth2 + Private Integration Tokens), documented webhooks incl. Document Sent/Signed, Custom Objects API | Native Make.com app (contacts/opportunities/tasks/notes) | **Verified**: rate limit 100 req/10s burst, 200,000/day per app. **Unverified/contradictory**: one source claims a Montreal AWS data-residency region; GHL's own compliance page states US-only infrastructure — do not rely on Canadian residency until confirmed in writing with GHL. |
| **ServiceMinder** | API-key auth; **inbound-only webhooks** (data pushed *into* SM); outbound events only via a **poll-based "Data Subscriber"** feed (Appointment Completed, Invoice Generated, Entity Deleted) | **No confirmed native GHL integration exists** | Architecturally poll-based, not event-driven — sync design must schedule polling, not assume instant push (see `07-system-integration-design.md`). SOC2/data-residency: not publicly documented. |
| **One Click Contractor** | Webhooks documented (per a cached/secondary source — the official page 404'd during this research and should be re-confirmed directly with OCC) | Zapier app exists but only exposes Estimate/Job triggers — **no signature-completion trigger** | **This is the highest-risk integration point**: signed-contract download link reported as short-lived (secondary source says ~5 minutes) with weak/no HMAC webhook signing. Design mandates immediate re-download of the PDF into durable storage the instant the webhook fires — never store or rely on OCC's temporary link. |
| **CompanyCam** | REST API + OAuth2, well-documented webhooks (project/photo/comment/document events), HMAC-SHA1 signed | — | **Verified**: exponential-backoff retries (max 10), auto-disable after 25 accumulated errors. API access gated to Pro/Premium/Elite plans — confirm current plan includes API access. SOC2 Type II certified; Canadian residency not documented. |
| **Ingage** | **No public API, webhook, or Make/Zapier connector found** | OCC lists Ingage as a partner (one-directional claim from OCC's side only) | Treat as manual-export-only unless direct vendor confirmation of a private integration is obtained. |
| **Helcim** | REST Payment/Invoice/Terminal API, HMAC-SHA256 signed webhooks (`cardTransaction`, `terminalCancel` only — **no confirmed invoice-paid webhook event**) | No native Make.com/Zapier app — DIY via generic HTTP module | PCI-DSS Level 1, Canadian-headquartered (best Canadian-fit of the stack), but customer-facing Interac e-Transfer checkout (vs. payout-speed "Faster Deposits") is **unverified** — confirm before assuming customers can pay a deposit via e-Transfer inside Helcim itself. |
| **Make.com** | N/A — orchestration layer | Native GHL app + generic HTTP/webhook modules for the rest | **Verified**: webhooks left unattached >5 days auto-deactivate (HTTP 410); queue capacity scales with plan (~667 items/10,000 credits, 10,000 hard cap); Data Store per-record cap is 512KB (fine for a dedup/state table, **not** for storing PDFs/photos); Incomplete Executions + Break error handler give a real retry/error-visibility mechanism this project relies on directly. |
| 3D design tool | Not researched — tool not yet named | — | Revisit once selected. |

## Cross-cutting risk found in research (shapes the whole architecture)

1. **ServiceMinder is poll-oriented, not push-oriented**, on outbound events — this alone rules out a naive "everything is instant webhooks" design and is the single biggest reason the option comparison does not treat "force everything through GoHighLevel in real time" as viable.
2. **No confirmed native ServiceMinder↔GoHighLevel integration exists anywhere** — this must be built as a custom Make.com bridge, not assumed to be a supported connector.
3. **One Click Contractor's short-lived signed-document link is the most fragile point in the entire stack** and is the direct evidence behind this project's "capture and re-store the PDF the instant the webhook fires, never rely on OCC's own link" rule.
4. **Canadian data residency is unresolved for most of the stack** — only Helcim (Canadian HQ) has an inherently strong claim; this is logged as an external limitation requiring written vendor confirmation (`03-requirements-register.md` §D), not something this project can resolve by design alone.
5. **Ingage has no discoverable integration surface** — the "connect the tools so reps aren't re-entering data" objective from the brief is only partially achievable for Ingage until a private API/partner path is confirmed directly with the vendor.

## Conclusions driving the option comparison

- GoHighLevel is well-suited as the communication hub (as the brief specifies) but should **not** be the operational database, both because the brief says so and because the research shows no clean native path to make it one for ServiceMinder-owned job data.
- A **thin, purpose-built data layer/portal backend** (not "put everything in GHL," not "build a full custom CRM") is the only option that can hold the proposal/contract/3D-design/service-call/commission records this project needs, given the fragmented and partially-undocumented native integrations found. This is developed in `04-option-comparison.md`.
- The magic-link portal pattern is validated by two direct industry comparables (Jobber, Housecall Pro), not invented from scratch.
- The specific overdue-response deadlines, contract-delivery rules, and service-call escalation rules in this project are grounded in the research above, even where an exact "right" number doesn't exist in the literature (in which case a reasonable, documented, configurable default was chosen — see requirements register).
