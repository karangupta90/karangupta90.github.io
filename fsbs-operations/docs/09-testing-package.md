# Testing Package — Five Star Bath Solutions of Ottawa

Two layers of testing were actually performed against the working prototypes in this project (not just described): (1) an automated headless-browser smoke test exercising real interaction paths, and (2) a manual scenario walkthrough against the brief's required test matrix, reasoning against the documented workflow rules where no live backend exists to execute against. Anything that could not be executed (because it depends on live vendor credentials) is marked **Not executable in this environment** rather than claimed as tested.

## 1. Automated smoke test (actually executed)

Run via Playwright/Chromium headlessly against the four working prototypes in `prototype/`. Script: `smoke-test.js` (kept in the session scratchpad, not committed — see note at the end of this section). Each test asserts on real DOM state after real user interactions, and fails on any JS console/page error.

| Test | Steps executed | Result |
|---|---|---|
| Sales-rep: acknowledge + submit result | Load page → confirm 3 appointment cards render → expand an unacknowledged appointment → click "Received & reviewed" → confirm acknowledgement text updates → open post-appointment result form on an already-acknowledged appointment → select "Pitch and miss" → check photos-uploaded → enter initial/lowest price → confirm live discount calculation shows $2,000 / 16.7% → submit | **Pass**, 0 errors |
| Customer portal: navigate + submit service request | Open magic link → confirm Overview populates (stage, next step, balance) → open More menu → go to Service & Support → select a category → submit → confirm confirmation screen appears → go to Documents → confirm 4 documents render | **Pass**, 0 errors |
| Service-call intake: safety gate + full flow | Load standalone intake page → dismiss safety gate ("not urgent") → select a category → confirm Continue button enables only after selection → fill description → submit → confirm final confirmation screen with reference number | **Pass**, 0 errors |
| Management dashboard: renders | Load dashboard → confirm 8 KPI tiles render → confirm 3 service-call rows render in the table | **Pass**, 0 errors |

**Result: all 4 automated tests passed with zero console or page errors on first corrected run.** (The only failure during test *development* was the test harness pointing at the wrong local Chromium binary path — a test-script issue, not a defect in the prototypes themselves; corrected before the run above.)

*Note on reproducibility:* the smoke-test script itself is a throwaway verification tool, not a project deliverable, so it was written to the session scratchpad rather than committed to the repository. Its logic (interactions and assertions) is fully described in the table above so it can be reconstructed or re-run against the committed prototypes at any time.

## 2. Manual scenario walkthrough (per the brief's required test matrix)

Executed by reasoning against the documented rules in `06-future-state-operating-model.md` and `07-system-integration-design.md`, since a live backend/vendor connection doesn't exist in this environment. Each row states the expected behavior *as designed* and whether the current prototype/doc set actually implements it.

### Sales workflow tests

| Scenario | Expected behavior | Implemented? |
|---|---|---|
| Appointment assigned normally | Rep sees it in list, must acknowledge | ✅ prototype |
| Appointment assigned late evening | 2-hour/appointment-start exception applies, not blanket 11 PM | ✅ documented rule (§2); prototype doesn't yet simulate the clock, since it's a static mock — flagged as a real gap, see §4 |
| Appointment not acknowledged | Tier 1 rep reminder, then Tier 2 management escalation | ✅ documented + shown as escalated state in management dashboard mock data |
| Rep reports conflict | One of 5 explicit acknowledgement responses | ✅ prototype |
| Customer reschedules/cancels | Rescheduling/cancellation message sent, appointment record updated | ✅ communication copy exists (`communications/customer-messages.md` #3–4); no reschedule button in the static prototype — flagged, see §4 |
| Appointment completed, results submitted | Structured conditional form, saved | ✅ prototype (tested above) |
| Results not submitted by deadline | Tier 1/2 escalation | ✅ documented, shown in mock overdue state |
| Proposal created but not sold | Retained for follow-up, never discarded | ✅ data model (`07-system-integration-design.md` §2 `proposals` table) |
| Contract signed | Captured, PDF retrieved immediately, never reliant on OCC's link | ✅ documented integration design (§4) |
| Contract email fails | Alert to office, resend action | ✅ documented (`06-future-state-operating-model.md` §6, communications #6b) |
| Missing 3D design / photo | Flagged to management, not silently lost | ✅ prototype (design-upload confirm dialog) + management dashboard mock |
| Deposit missing | Handoff marked incomplete | ✅ management dashboard mock shows this exact state (Fournier project) |
| Duplicate customer record | Held in review queue, not auto-merged | ✅ documented (`07-system-integration-design.md` §3) — **Not executable in this environment** (requires live CRM data) |

### Customer portal tests (older, less technical customer)

Walked through each item in the brief's list against the actual working portal prototype:

| Can the customer... | Result |
|---|---|
| Open the magic link | ✅ single button, no password, tested |
| Understand the first screen | ✅ Overview leads with plain-language stage + "what's next," per independent-review fix (§5) |
| Find the appointment / contract / proposal / design | ✅ all reachable within 2 taps via the More menu |
| Understand tentative vs. confirmed | ✅ explicit pill labels (`pill-tentative` vs `pill-confirmed`) on every date shown |
| Understand project status | ✅ plain-language timeline, current stage highlighted |
| Find payment information | ✅ Payments section with a visual progress bar plus plain numbers |
| Ask a question / call the office | ✅ tap-to-call button on every screen (sticky header) |
| Submit a service issue | ✅ tested end-to-end above |
| Request a new magic link | ✅ present on the gate screen |

**Accessibility findings applied:** 18px base font, 48px minimum tap targets, high-contrast navy/teal palette, no sliders, no unexplained jargon, one primary action per card — directly reflecting the NN/g and WCAG 2.2 findings in `02-research-report.md` §A7. **Not independently tested with an actual older-adult user panel** — this project used the cited published research (NN/g's 87 guidelines, AARP survey data, WCAG 2.2) as the basis for design decisions rather than conducting new usability sessions, which this environment cannot arrange. This is reported as a limitation, not glossed over.

### Production tests

Missing measurement, material delay, damaged material, installer reassignment, customer unavailable, payment outstanding, incomplete work, and a service call opened before project closure are all addressed structurally: the `projects` table's `handoff_checklist` and the separate `service_calls` table (never merged into the project timeline, per `06-future-state-operating-model.md` §4 rule "any open service call is shown as its own item, never merged into the project timeline") satisfy the last case specifically. **Not executable in this environment** — these require live production data; the design is verified for correctness against the brief's rules, not against a running system.

### Service-call tests

Walked against the standalone service-call intake prototype:

| Scenario | Result |
|---|---|
| General question / cosmetic concern | ✅ selectable categories, tested |
| Active leak / safety issue | ✅ safety gate intercepts *before* the form, routes to a phone call — tested |
| Missing photo | ✅ photo upload is optional, form still submits without one — tested |
| Warranty unclear / manufacturer issue / installer callback | ✅ categories exist; classification-to-warranty-determination is explicitly a human decision per `08-ai-readiness-and-voice-agent-design.md` §2, not automated |
| Repeat / reopened service call | ✅ data model tracks `reopened_count`; portal service history mock shows a resolved prior call for the same customer |
| Customer unable to use the portal | ✅ every screen has a tap-to-call fallback; the standalone service-call page (this test) is also reachable independently of the full portal, e.g. via a QR code on a completion document, for exactly this reason |

### Integration failure tests

All addressed at the design level in `07-system-integration-design.md` (idempotency/dedup, Break error handler → Incomplete Executions, field-level conflict ownership, Integration Health Check scenario, Nightly Reconciliation scenario) and surfaced concretely in the management dashboard mock (an OCC webhook retry-exhausted state is shown as a real dashboard item, not hypothetical). **Not executable in this environment** — these require live webhook traffic and Make.com scenario execution, which needs the actual vendor credentials this environment doesn't have (see `03-requirements-register.md` §D).

### AI tests

Each scenario in the brief (normal question, ambiguous question, complaint, refund request, legal threat, warranty question, installation-date request, pricing negotiation, active leak, "get me a human," insufficient information) maps to the same rule in `08-ai-readiness-and-voice-agent-design.md` §2: AI drafts or classifies, a human approves anything customer-facing beyond the narrow approved FAQ set, and AI never independently promises a date, offers a discount, or makes a warranty/liability call. The AI draft-approval queue added after independent review (visible in the management dashboard prototype) is the concrete mechanism enforcing this. **No live AI model is wired into this prototype** — this is a designed control, not a tested model behavior, and is reported as such.

## 3. Defects found and corrected during this project

| Defect | Found during | Correction |
|---|---|---|
| Alert-fatigue risk from a flat 11 PM/9 PM overdue rule with no escalation tiers | Independent review (home-services-operator persona) | Added Tier 1/Tier 2 escalation, §5 of `05-independent-review.md`, applied to `06-future-state-operating-model.md` |
| No idempotency/dedup mechanism despite webhook retry behavior being explicitly documented for CompanyCam | Independent review (automation/reliability persona) | Added `sync_dedup` table and rule, `07-system-integration-design.md` §4 |
| Flat 9-tab portal navigation risked overwhelming the target older-user audience | Independent review (CX-leader persona) | Rebuilt portal navigation around an Overview-first hierarchy with a secondary "More" menu, reflected directly in `prototype/portal/index.html` |
| No consent-capture step despite CASL/PIPEDA requirements being researched | Independent review (Canadian-context persona) | Added `consent_marketing`/`consent_photo_video` fields and a recording step, `06-future-state-operating-model.md` §13, `07-system-integration-design.md` §2/§8 |
| Payment-reminder message could resemble an e-Transfer phishing attempt to an older customer | Independent review (CX-leader persona) | Added explicit anti-phishing framing rule to `communications/customer-messages.md` |

## 4. Known gaps in the current prototypes (explicitly not hidden)

- The static prototypes use fixed mock data and do not simulate real time passing (e.g., the 11 PM deadline logic is documented and unit-testable in principle, but the prototype doesn't run a live clock against it).
- No reschedule/cancel button exists yet in the sales-rep or portal prototypes — the message content exists, but the UI action to trigger it does not.
- No real backend, authentication, or persistence exists — every prototype resets to its mock state on reload. This is expected for a static-prototype phase and is the first thing Phase 1–5 implementation replaces with the thin-layer API from `07-system-integration-design.md`.
