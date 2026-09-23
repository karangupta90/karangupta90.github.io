# Customer Engagement Center

**Your input is a concept. The system handles the rest:** a multichannel (SMS, email, phone)
execution plan in your brand voice, sent through **GoHighLevel**, with every message's copy
continuously A/B tested and improved.

**v1 goal:** convert old, dormant leads.
**North star:** become the business's primary customer communication center (see [ROADMAP](docs/ROADMAP.md)).

## How it works in 60 seconds

```
concept.yaml ──► plan (Claude writes 3 variants per step, brand-linted) ──► you approve
      ──► enroll leads by GHL tag (10% held out as control)
      ──► every 15 min: next due step → compliance gate → bandit picks variant → send via GHL
      ──► GHL webhooks: reply / booking / opt-out → credit the winning copy, stop or hand to human
      ──► weekly: retire losing copy, Claude writes challengers from the winner
```

Details: [Architecture](docs/ARCHITECTURE.md) · [Research & sources](docs/RESEARCH.md) ·
[Code walkthrough](docs/CODE_WALKTHROUGH.md)

## Quick start

```bash
cd customer-engagement
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # fill in ANTHROPIC_API_KEY, GHL_TOKEN, GHL_LOCATION_ID ...
set -a && . ./.env && set +a

# 1. Edit your brand once
$EDITOR brand/brand.yaml

# 2. Write a concept (example included)
$EDITOR campaigns/old-lead-reactivation.yaml

# 3. Generate the plan, review every message, then set approved: true
python -m engagement.cli plan campaigns/old-lead-reactivation.yaml
$EDITOR campaigns/old-lead-reactivation.plan.yaml

# 4. Enroll and run (DRY_RUN=true by default - nothing is sent until you flip it)
python -m engagement.cli enroll campaigns/old-lead-reactivation.plan.yaml
python -m engagement.cli run    campaigns/old-lead-reactivation.plan.yaml
python -m engagement.cli report campaigns/old-lead-reactivation.plan.yaml

# 5. Webhook server for replies/bookings/opt-outs
python -m engagement.cli serve

# Tests (offline)
pytest -q
```

## GoHighLevel setup checklist

1. **Private Integration token** (sub-account → Settings → Private Integrations). Scopes:
   contacts read and write, conversations and messages write, workflows, tasks.
2. **A2P 10DLC** brand and campaign registered for your LC Phone number. Carriers block
   unregistered traffic.
3. **Email domain** authenticated (SPF, DKIM, DMARC) in LC Email.
4. Tag the target contacts, e.g. `lead-cold`: a smart list of leads with no activity in 60+
   days → bulk-add tag.
5. **Webhooks → this server** (`https://<host>/webhooks/ghl?token=<WEBHOOK_TOKEN>`):
   *Customer Replied* and *Appointment Booked* workflows with a Webhook action. Or install as a
   Marketplace app to get signed events.
6. **Hand-off workflow**: trigger on tag `ce-replied` → notify the rep and create an opportunity.
7. Phone: `PHONE_MODE=task` (rep call tasks) by default. `PHONE_MODE=ai` enrolls the lead in
   your Voice AI workflow, but only use it where you have prior express written consent.

## Project layout

```
brand/brand.yaml              brand kit - voice, banned phrases, SMS/email styling
campaigns/*.yaml              concepts (you write) and *.plan.yaml (generated, you approve)
engagement/                   the engine (see docs/CODE_WALKTHROUGH.md)
tests/                        offline test suite
docs/                         research, architecture, roadmap, walkthrough
```
