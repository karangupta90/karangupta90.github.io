# FSBS Operations — Five Star Bath Solutions of Ottawa

Operating-system design, research, independent review, and working prototypes for Five Star Bath Solutions of Ottawa's business automation, customer-experience, and AI-readiness overhaul.

Start here: [`docs/00-executive-summary.md`](docs/00-executive-summary.md)

**Working implementation:** [`app/`](app/README.md) — a real, tested Node.js + SQLite application (zero external dependencies) implementing the full system: sales-rep accountability, customer magic-link portal, service calls, commissions (real 2026 tier engine), installer invoicing, revenue reporting, webhook integration boundary. `cd app && node server.js` to run; `node --test test/api.test.js` for the 22-test suite. Real business config (rates, tiers) lives in a git-ignored private seed file.

## Contents

### Documentation (`docs/`)
| File | What it covers |
|---|---|
| `00-executive-summary.md` | Start here — what was done, what wasn't, and why |
| `01-current-state-business-map.md` | Today's process, systems, people, failure points |
| `02-research-report.md` | Cited industry research + vendor-stack capability research |
| `03-requirements-register.md` | Confirmed requirements vs. assumptions vs. configurable rules vs. external limitations |
| `04-option-comparison.md` | Four architecture options scored and compared; selected approach + rationale |
| `05-independent-review.md` | Five independent review perspectives, findings, and changes made |
| `06-future-state-operating-model.md` | Workflows, roles, deadlines, escalation, statuses, exceptions |
| `07-system-integration-design.md` | Data model, sync rules, conflict handling, Make.com scenarios, security |
| `08-ai-readiness-and-voice-agent-design.md` | AI guardrails, layered rollout, voice-agent boundary |
| `09-testing-package.md` | Automated + manual test results against the prototypes |
| `10-implementation-phases.md` | Phased rollout plan |
| `11-success-metrics.md` | The initial metric set |
| `guides/` | Admin, staff/sales-rep, installer, service-call, customer-comms, error-handling/integration, AI-safety, troubleshooting, launch checklist/rollback/backlog |

### Working prototypes (`prototype/`)
Open any `index.html` directly in a browser (mobile-width viewport recommended — these are built mobile-first).
- `sales-rep/index.html` — appointment acknowledgement + structured post-appointment result form
- `portal/index.html` — magic-link customer portal (Overview-first navigation)
- `service-call/index.html` — standalone service-issue intake with a safety/leak gate
- `management/index.html` — operations dashboard incl. AI draft-approval queue

### Customer communications (`communications/`)
`customer-messages.md` — the complete email/SMS content library for every touchpoint in the brief, plain-language, older-audience-tested against cited accessibility research.

## Status
All four prototypes pass an automated headless-browser interaction test (see `docs/09-testing-package.md` §1). No live vendor integration exists — this environment has no credentials for GoHighLevel, ServiceMinder, One Click Contractor, CompanyCam, Ingage, or Helcim; every integration is specified precisely enough to wire up directly once credentials are available (`docs/07-system-integration-design.md` §11).
