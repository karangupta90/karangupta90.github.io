# Error-Handling and Integration Guide

For whoever operates the Make.com account and thin-layer API day to day.

## Core principles (from `07-system-integration-design.md`)
- **Every webhook-driven write is deduplicated** against the `sync_dedup` table before it's applied — if you're debugging a "missing" record, check whether it was silently (and correctly) skipped as a duplicate before assuming it was lost.
- **Field-level ownership, not last-write-wins.** If a field looks "wrong" after a sync, check which system owns that field (`07-system-integration-design.md` §2) before editing it directly in the thin layer — your edit may just get overwritten on the next sync if you're not also correcting it at the owning system.
- **ServiceMinder is polled, not pushed.** Don't expect instant updates from ServiceMinder; the default poll cadence is 15 minutes. If something needs to be faster, that's a conversation about poll frequency, not a sign something's broken.
- **One Click Contractor's signed-PDF link is short-lived by design (per vendor research) and must never be stored.** The moment the contract-signed event fires, the PDF is fetched and written to thin-layer storage in the same automation run. If you ever see a raw OCC link stored anywhere long-term, that's a defect — fix it immediately.

## When something fails
1. Check the Integration Health Check scenario's latest run — did it flag a stale scenario?
2. Check the Incomplete Executions queue in Make.com for the specific scenario in question.
3. Check the Nightly Reconciliation output for the affected record type.
4. Manual correction is always allowed and always logged to `audit_log` with a reason — never silently patch data without a reason recorded.

## Adding a new integration
Before wiring anything new in, confirm directly with the vendor (don't assume from a marketing page): does it support webhooks or only polling? Is there HMAC/signature verification? What's the rate limit? Add the answer to `07-system-integration-design.md` §11 rather than letting institutional knowledge live only in someone's head.
