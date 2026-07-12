# Current-State Business Map — Five Star Bath Solutions of Ottawa

Status: Derived from the business owner's process description (this document's source of truth) plus reasonable inference about how the named tools are typically used together. Tool-specific claims are marked **[inferred]** where not independently verified against vendor documentation (see `02-research-report.md`).

## 1. End-to-end process as it exists today

```
Lead in → Appointment booked (manual) → Rep assigned (manual) →
In-home consultation (CompanyCam + Ingage + 3D tool + One Click Contractor + Helcim) →
Proposal created → [Sold?] → Contract signed → Deposit collected →
Post-sale handoff (informal) → Production/materials → Installation scheduled →
Installation completed → Final payment → Review request →
[Later] Service call, if needed
```

## 2. Systems in use today and their apparent role

| System | Apparent role today | Who touches it |
|---|---|---|
| GoHighLevel | CRM / marketing / some customer messaging | Office, marketing, sales |
| ServiceMinder | Franchise operations system of record (jobs, scheduling) **[inferred — role not fully confirmed, see research report]** | Office/management |
| One Click Contractor | Proposal + contract creation, e-signature, delivers customer a temporary download link | Sales rep, customer |
| CompanyCam | Job-site photos | Sales rep, installer |
| Ingage | In-home sales presentation | Sales rep |
| Helcim | Deposit / payment processing | Sales rep, office |
| 3D design tool (unnamed) | Visual bathroom design produced in-home | Sales rep |
| Make.com | Automation glue between the above (extent unclear) | Admin/ops |
| Email / SMS | Ad hoc customer and staff communication | Everyone |

## 3. People involved

- **Sales representatives** — run in-home consultations, create proposals/contracts/3D designs/photos, collect deposits.
- **Office / admin staff** — book appointments manually, coordinate scheduling, chase paperwork.
- **Management** — needs visibility into acknowledgements, results, handoffs, payments, commissions, profitability, service calls; today this visibility is largely informal.
- **Production / installation staff** — need a clean handoff package (contract, design, photos, measurements) to schedule and execute installs.
- **Installers** — perform the physical work, need a simple way to submit invoices for pay.
- **Customers** — receive a temporary contract-download link, otherwise have no persistent view of their project.

## 4. Manual actions today (the load this system must reduce, not eliminate where a human judgment call is required)

- Appointment booking and rep assignment (**intentionally staying manual per instruction** — this system adds accountability around it, not automation of the booking decision itself).
- Chasing sales reps for appointment acknowledgement and post-appointment results.
- Chasing 3D designs and photos after appointments.
- Manually re-keying proposal/contract data between One Click Contractor and other systems.
- Manually forwarding the expiring signed-contract link before it dies, and re-sending on customer request.
- Manual production handoff (implied to be informal messages/spreadsheets today).
- Manual tracking of tentative vs. confirmed installation dates and customer notification.
- Manual service-call intake, presumably by phone, with no separate tracking lifecycle from sales/production.
- Manual commission calculation.
- Manual, ad hoc job-cost/profitability reconciliation.
- Installer invoice submission with no described structured workflow.

## 5. Known failure points (explicitly named in the brief, treated as confirmed pain points)

1. **Expiring contract link** — customer's only path to their signed contract disappears after a few days; no durable access.
2. **No separation of proposal vs. contract** — risk that unsold proposals are discarded/ignored instead of being retained for follow-up and analysis.
3. **No accountability loop on appointment acknowledgement** — a booked appointment can silently go unacknowledged by the assigned rep with no one finding out until the customer complains or the appointment is missed.
4. **No accountability loop on post-appointment results** — outcome, proposal amount, 3D design, and photos can go unsubmitted with no visibility until much later.
5. **3D designs can go missing** — nothing today guarantees the design exists, is associated with the right customer/appointment/project, or is retained in a durable place.
6. **No unified customer destination** — customer status information is scattered across systems the customer never sees (ServiceMinder, GoHighLevel, One Click Contractor), forcing customers to call the office for basic status questions.
7. **Tentative vs. confirmed installation dates are not distinguished in customer communication today** — risk of the business either over-promising or the customer distrusting any date given.
8. **Service calls are not tracked as a distinct workflow** — risk of warranty/callback work getting mixed into sales or production pipelines, losing root-cause and repeat-call visibility.
9. **No structured commission or job-cost tracking** — management lacks visibility into per-job profitability and commission liability.
10. **No structured installer invoice workflow** — payment requests are presumably ad hoc.
11. **Integration failures (sync errors, webhook drops, duplicate records) have no documented visibility mechanism today.**

## 6. Duplicate entry / repeated data entry risk points

- Customer identity (name, address, contact info) potentially re-entered across GoHighLevel, ServiceMinder, One Click Contractor, CompanyCam, Helcim.
- Appointment date/time potentially re-entered or re-confirmed across GoHighLevel and ServiceMinder.
- Proposal/contract dollar amounts potentially re-keyed into a commission or job-cost spreadsheet.
- Photos and 3D designs potentially need manual attachment to the "right" customer record in more than one system.

## 7. Customer trust gaps (explicitly named + inferred)

- Customer cannot reliably retrieve their own signed contract after a few days.
- Customer has no way to check project status without calling the office.
- Customer has no clear signal of whether an installation date is real or provisional.
- Customer has no structured, low-friction way to report a post-installation issue (e.g., an active leak) with any acknowledgement guarantee.
- No consistent, branded communication pattern — messages likely vary by whoever is sending them.

## 8. Explicit boundaries carried forward from the brief (not problems to "fix," but constraints)

- Manual appointment setting stays manual.
- GoHighLevel is being positioned as communication hub, not forced into being the operational database.
- ServiceMinder integration should go through GoHighLevel *where reliable* — not as a rule that overrides data integrity.
- QuickBooks / accounting implementation is explicitly out of scope.
- Cash payments are out of scope for now.
