# FSBS Operations — Application

The working implementation of the "thin layer" from `../docs/07-system-integration-design.md`: one Node.js server, one SQLite database, **zero external dependencies** (Node 22+ with built-in `node:sqlite`). All five interfaces are served by this one process:

| URL | Who | What |
|---|---|---|
| `/` | Staff | Sign in |
| `/rep/` | Sales reps | Appointments, explicit acknowledgement, conditional post-appointment results, 3D-design upload |
| `/manage/` | Office/manager/admin | KPIs, overdue tiers, projects & handoff checklists, install dates (tentative/reserved/confirmed), service calls, commissions (real tier engine), revenue by month, installer invoice approval, outbox, integration failures, AI draft queue, booking, magic-link issuing |
| `/installer/` | Installers | Rate-card invoice submission with receipts (HST back-calc), mileage, $150 bonus checklist |
| `/portal/?t=…` | Customers | Magic-link portal: status, tentative-vs-confirmed dates, documents (permanent), payments, messages, service intake with leak/safety escalation |

## Run

```bash
cd app
node server.js          # http://localhost:3000
```

First run seeds from `seed/seed.private.json` if present (real business config — git-ignored on public repos), else `seed/seed.example.json`. Sign in with a seeded user (see the seed file; change passwords immediately in production).

## Test

```bash
node --test test/api.test.js    # 22 tests: commission math (verified against the real 2026
                                # sheet rows), deadline exceptions, HST/mileage/bonus invoice
                                # math, sold-flow handoff, contract versioning, magic links,
                                # emergency escalation, webhook dedup, cooldown, permissions
```

## Business rules implemented (sources: the business's own documents)

- **Commissions (2026 sheet):** rate looked up by discount band, applied to the pre-tax amount (final ÷ 1.13); becomes *due* when measure is completed; upsell/missed items at measure adjust the effective discount and recalculate; statuses estimated→pending→due→approved→paid plus held/reversed; payout ledger; monthly rollups.
- **Installer pay (pay-sheet template):** full rate card, receipts entered as totals with HST back-calculated (÷1.13), mileage $0.40/km after 50 free km, $150 bonus on the 4-item checklist (CompanyCam photos, completion form + no service call, payment collected, 4–5★ review), HST added on top for subcontractor invoices.
- **Job revenue (2025 monthly sheets):** per-project contracted total, deposit/COD/A-R, collected, finance/cash + finance fees, Sentrel cost, commission, gross profit/margin; rolled up by install month.
- **Contract (sales-agreement structure):** subtotal → discount → total; down payment + balance at substantial completion; versioned signed-PDF storage (revisions never overwrite); email delivery with attachment (or portal-only wording if >15 MB); resend action.
- **Accountability:** explicit acknowledgement (viewing ≠ ack), 11 PM/9 PM deadlines with late-evening + day-off exceptions, two-tier escalation (rep reminder → management).
- **Cooldown:** max one non-urgent customer message per 24 h (urgent bypasses).
- **CASL/PIPEDA:** consent recorded with timestamp+method on the customer record.

## Integration boundary (connect-later)

Webhook endpoints are live and idempotent (`sync_dedup`), with failures captured to the Integration Failures queue — never dropped silently:

- `POST /webhooks/occ` — One Click Contractor `contract.signed`: creates contract + project + handoff, stores the PDF immediately (never relies on OCC's expiring link).
- `POST /webhooks/companycam` — photo/project reference + handoff-checklist photos item.
- `POST /webhooks/helcim` — matches a due payment by amount+customer, marks received.

All payloads require an `event_id` for dedup. **Final connection steps per vendor** are in `../docs/07-system-integration-design.md` §11. Outbound email/SMS goes through the `outbox` table; the single transport function in `lib/scheduler.js` (`dispatchOutbox`) is the swap-in point for GoHighLevel — until connected, messages accumulate in the outbox where staff can see exactly what would be sent.

## Deploy (one small host, ~$5–10/mo)

Any Node 22+ host with a persistent disk works. Render example:
1. Push this repo (private) to GitHub.
2. Render → New Web Service → connect repo → root dir `app`, start command `node server.js`.
3. Add a persistent disk mounted at `/data`, set env `FSBS_DATA_DIR=/data`, `BASE_URL=https://<your-domain>`, `TZ=America/Toronto`.
4. Upload/create `seed/seed.private.json` (or set it up as a secret file).
5. Point a subdomain (e.g. `projects.fivestarbathsolutions-ottawa.ca`) at it so customer links look legitimately branded — important for an older audience's trust.

## Data

SQLite database + uploaded files live in `data/` (git-ignored). Back up by copying the directory. Every sensitive change (contracts, commissions, service-call stages, consent) is in the append-only `audit_log` table.
