# Roadmap - from old-lead reactivation to primary customer communication center

**North star:** every customer conversation the business has (new leads, old leads,
customers, reviews, referrals) runs through one brand-consistent, self-optimising center.

## v1 - Old-lead reactivation (this PR)
- [x] Concept → AI-drafted, human-approved 21-day SMS/email/phone plan
- [x] Brand kit + linter enforced on every message
- [x] Compliance gate: quiet hours, opt-outs in any wording, DND, missing channel
- [x] GoHighLevel v2 integration: contacts by tag, SMS/email via conversations, call tasks or Voice AI workflow, tags, DND
- [x] Webhooks: replies, bookings, won deals and opt-outs close the loop
- [x] Thompson-sampling bandit per step, plus weekly challenger generation
- [x] Holdout control group and lift reporting
- [ ] **Go-live checklist**: A2P 10DLC registered, sending domain authenticated (SPF, DKIM, DMARC),
      consent source verified, 50-lead pilot, then ramp up by a few hundred per day

## v2 - Smarter targeting & reply handling
- Recency and engagement scoring: start with the warmest segment and pace volume automatically
- AI reply assistant: classify inbound replies (interested, question, objection, not now)
  and draft the rep's response in brand voice. A human approves it at first.
- Send-time optimisation per lead, based on their past reply times
- Channel preference learning (some leads only answer email)
- Dashboard (web page) that replaces `cli report`

## v3 - New-lead speed-to-lead
- Form, ad or call webhook → a first SMS within 60 seconds → AI qualification → booking
- Same brand kit, bandit and compliance gate; a new cadence template

## v4 - Full lifecycle: primary communication center
- Onboarding, appointment reminders, no-show recovery, review requests, referral asks,
  win-back of past customers
- Unified inbox view across campaigns, and one global frequency cap per contact
- Multi-CRM adapters (the `ghl.py` interface), plus a warehouse export for BI
- Organisation-wide brand kits for multiple locations or brands
