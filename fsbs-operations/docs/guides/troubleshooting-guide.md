# Troubleshooting Guide

| Symptom | Likely cause | What to do |
|---|---|---|
| Customer says their magic link doesn't work | Link expired (14 days) or was forwarded/reused past its intent | Use "Request a new link" on the portal gate screen, or have office staff issue one manually — never share one customer's link with another |
| Customer can't find their signed contract | Check delivery status on the project record — was there a bounce/failure? | Use the one-click resend; also confirm it's stored in the portal Documents tab independent of email |
| Rep says an appointment never showed up on their list | Check assignment and whether the rep was marked unavailable that day | If marked unavailable, the system intentionally skips the chase and should have alerted management to reassign instead — check that alert fired |
| Management dashboard shows an "overdue" item the rep says they completed | Check for a Tier 1 vs. Tier 2 timing mismatch, or a submission stuck as a draft rather than submitted | Confirm with the rep whether they tapped "Submit" vs. "Save draft" — a draft still shows overdue by design |
| A 3D design is flagged missing but the rep insists they uploaded it | Check whether it was associated with the correct appointment/customer, not just uploaded somewhere | Use the management "missing designs" list to manually re-associate if needed — never treat this as the rep's fault by default without checking |
| Integration Health Check flags a stale scenario | A Make.com scenario paused, hit an error threshold, or the webhook auto-deactivated (Make deactivates unattended webhooks after ~5 days per vendor documentation) | Re-activate/re-attach the scenario/webhook in Make.com; check the Incomplete Executions queue for what backed up while it was down |
| A payment shows in Helcim but not on the portal | Sync delay or a failed webhook | Check Helcim webhook delivery status; manually trigger a reconciliation pass if needed rather than waiting for the nightly job |
| Duplicate customer record suspected | Compound-key (email+phone) match failed, likely due to a typo or a new email address | Resolve manually in the "needs review" queue — never auto-merge without confirming with the customer or office records |
