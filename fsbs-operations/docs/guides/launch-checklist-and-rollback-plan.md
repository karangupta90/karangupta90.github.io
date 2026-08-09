# Launch Checklist and Rollback Plan

## Launch checklist (per phase, see `10-implementation-phases.md` for the full sequence)

**Before any phase goes live:**
- [ ] The relevant rule/threshold is confirmed or deliberately left at its documented default (not silently skipped).
- [ ] Staff affected by the phase have read the relevant guide (`docs/guides/`).
- [ ] A rollback path exists and has been named (see below) before real customer data touches the new workflow.

**Phase 1 (sales accountability) specifically:**
- [ ] Acknowledgement/result deadlines and exceptions configured.
- [ ] Reps know the difference between "save draft" and "submit."
- [ ] Management dashboard escalation tiers are visible and understood.

**Phase 4/5 (contract delivery + portal) specifically:**
- [ ] Confirmed OCC's actual current webhook/retrieval behavior directly with OCC support (research flagged the public docs as unreliable/404'd) before relying on it in production.
- [ ] Magic-link issuance tested with a real (non-mock) email/SMS send.
- [ ] Consent-capture step is live before any photo/video or marketing message is sent under this system.

## Rollback plan

Each phase is additive and reversible without breaking the others, by design:
- **Phase 1–2 rollback:** disable the acknowledgement/result overdue automations; appointment booking and manual communication continue exactly as before this project — no data is lost since the thin layer only adds records, it doesn't remove existing ones from GHL/ServiceMinder/OCC.
- **Phase 3–4 rollback:** if automated contract capture proves unreliable, staff can resume manually forwarding OCC's link as an interim step while the integration is fixed — the durable-portal-storage requirement (no more expiring-link-only delivery) should still be treated as a hard requirement to restore quickly, since it directly fixes a named customer-trust problem.
- **Phase 5+ rollback:** the portal is a read layer over existing systems of record; disabling it doesn't touch the underlying data in GHL/ServiceMinder/OCC/CompanyCam/Helcim.
- **Any phase:** because every write carries an audit trail (`audit_log`), a bad rollout can always be diagnosed and reversed by examining exactly what changed and when, rather than guessing.

## Future-development backlog (deferred by design, not forgotten)

- Automated lead routing / appointment booking.
- Full AI auto-response beyond the narrow approved FAQ set.
- Voice-agent deployment against the provider-agnostic boundary already built.
- Native ServiceMinder two-way real-time sync (blocked until/unless ServiceMinder ships true outbound webhooks).
- Predictive profitability/callback analytics.
- Full French-language communication set (the data field exists from Phase 1; the translated content itself is a fast-follow).
- Native mobile apps, if mobile-web adoption data ever justifies the added maintenance cost.
