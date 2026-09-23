# Research: best-in-class engagement systems & what we borrowed

Research date: September 2026. Purpose: design a communication center that takes a
*concept* as input and runs the full email + SMS + phone execution against old leads,
with a consistent brand, continuous copy testing, and GoHighLevel as the CRM.

---

## 1. How the leading platforms are built

| Platform | What they do best | Pattern we adopted |
|---|---|---|
| **Braze / Customer.io / Iterable** | Build a journey once and run it on every channel; real-time decisioning picks message, channel and timing per person; AI drafts copy inside brand-voice guardrails | One **plan** drives all channels; brand kit is injected into every AI prompt; a **compliance/brand gate** sits in front of every send |
| **Bloomreach / "agentic marketing" tools** | Continuous multi-armed-bandit experiments instead of one-off A/B tests. Traffic shifts to winners while challengers keep getting tested | **Thompson-sampling bandit** per step + automatic **challenger generation** (`evolve`) |
| **Infobip / omnichannel CPaaS** | Journeys with AI chat and escalation to humans | A reply **pauses automation** and hands off to a human (tag `ce-replied` → GHL workflow alerts rep) |
| **Database-reactivation specialists (GHL ecosystem)** | SMS opens the conversation, email adds substance, phone/AI voice converts; ~3-week sequence | Default **21-day, 9-touch SMS → email → phone cadence** |

Key design principle across all of them: **decouple strategy (what to say) from
execution (who/when/where)**. That is exactly the "concept in, execution out" model:
you write the concept; the planner, copywriter, bandit and orchestrator do the rest.

## 2. Old-lead reactivation: what the data says

- **SMS leads**: SMS gets ~98% open rates vs 21-28% for email. On a cleaned list, reactivation
  SMS usually gets a **2-8% reply rate**, and bookings typically arrive within 7-14 days.
  Reported averages: ~4.4% of dormant leads booked, with peaks near 9%.
- **Multichannel beats single-channel**: the strongest results come from coordinated
  SMS + email + phone over about 3 weeks.
- **Recency matters**: leads contacted within 90 days of going cold are much more likely to
  reactivate. So **segment by recency** and start with the warmest segment.
- **Timing**: Tue-Thu, 10am-12pm and 2-4pm local time work best. Our quiet-hours logic
  reschedules to 10am local and skips weekends.
- **Pacing protects the number**: sending 20k messages on day one burns the list and the
  sender reputation. Start with a few hundred a day, watch reply and opt-out rates, then scale.
- **The "9-word email"** (Dean Jackson): a very short, personal question about the
  original enquiry ("Are you still looking for X?"). It's the model for our Day-0 SMS and
  Day-1 email purposes. The rule is to resist adding more.

## 3. Businesses that execute engagement exceptionally well

| Company | What they do | Lesson encoded in this project |
|---|---|---|
| **Chewy** | Handwritten notes, pet birthday cards, condolence flowers; the contact center is empowered to act like family | Messages must read as **from one real person** (`sender_name` in brand kit), and a reply goes to a **human**, not a bot |
| **Duolingo** | Streak reminders, a strong and consistent voice, relentless experimentation on notification copy | **One voice everywhere** (brand kit) + **always-on testing** of copy (bandit + challengers) |
| **Warby Parker** | Customers can text for help and complete purchases inside the chat | Two-way SMS is the **primary conversation channel**, and replies land in the GHL inbox |
| **Sephora** | Personalised recommendations and rewards tied to preferences | Merge fields and custom fields (`service_interest`, etc.) reference **what the lead originally wanted** |

## 4. Compliance (US) - built into code, not left to memory

- **Opt-out by any reasonable means** (FCC rule, in force 2025-26): STOP keywords *and*
  plain-English requests ("please stop texting me") must be honoured across **all**
  automated channels → `compliance.is_opt_out` + global suppression + GHL DND sync.
- **Quiet hours**: TCPA allows 8am-9pm local time, but FL, OK, WA and others require 8am-8pm.
  We use **8am-8pm everywhere**.
- **A2P 10DLC**: unregistered long-code traffic has been blocked by carriers since Feb 2025.
  Register the brand and campaign in GHL (LC Phone → Trust Center) **before** going live.
- **Consent**: keep documented consent. Old leads that came in through forms must have seen
  a disclosure that covers SMS marketing.
- **AI voice**: the FCC treats AI-generated voices as "artificial" under the TCPA, so AI
  outbound calls need **prior express written consent**. Use `PHONE_MODE=task` (human rep)
  unless consent is documented.
- First SMS includes "Reply STOP to opt out." and every email includes an unsubscribe line.

*Not legal advice. Have counsel review your consent language and the states you operate in.*

## 5. GoHighLevel integration facts used

- API v2 base URL: `https://services.leadconnectorhq.com`. It needs a `Version` header:
  `2021-07-28` for contacts, `2021-04-15` for conversations.
- Rate limit: about 100 requests per 10 seconds per location. The client backs off on HTTP 429.
- Send: `POST /conversations/messages` (`type: SMS | Email`). Replies thread into the GHL inbox.
- Contacts: `POST /contacts/search`, `POST /contacts/{id}/tags`, `PUT /contacts/{id}` (DND),
  `POST /contacts/{id}/tasks`, `POST /contacts/{id}/workflow/{workflowId}`.
- Webhooks are signed with `X-GHL-Signature` (Ed25519). The legacy `X-WH-Signature` (RSA) is
  deprecated from 1 Sep 2026. GHL retries up to 12 times with back-off, so every handler here
  is idempotent.

## Sources

- HighLevel API docs: https://marketplace.gohighlevel.com/docs
- HighLevel webhook integration guide: https://marketplace.gohighlevel.com/docs/webhook/WebhookIntegrationGuide/index.html
- Send a new message (GHL): https://marketplace.gohighlevel.com/docs/ghl/conversations/send-a-new-message/index.html
- Upsert contact (GHL): https://marketplace.gohighlevel.com/docs/ghl/contacts/upsert-contact
- GHL webhooks + API guide: https://ecosire.com/blog/gohighlevel-webhooks-api-integration
- Database reactivation how-to (2026): https://leadsnow.ai/how-to-run-a-database-reactivation-campaign/
- GHL database reactivation: https://hlgrowthpartner.com/post/gohighlevel-database-reactivation-campaign-2026
- SMS lead reactivation: https://www.audienceintent.ai/insights/what-s-the-best-way-to-reactivate-dormant-customers-(the-answer-is-already-in-your-phone)/
- Dean Jackson, the 9-word email: https://deanjackson.com/blog/the-9-word-email/
- Braze omnichannel engagement: https://www.braze.com/resources/articles/omnichannel-customer-engagement
- Customer.io omnichannel AI personalisation: https://customer.io/learn/omnichannel/ai-powered-personalization-omnichannel
- Bandit optimisation for SMS: https://www.hellyeahai.com/blog/ai-for-sms-marketing-automation
- Agentic marketing definition: https://cdp.com/glossary/agentic-marketing/
- Chewy handwritten notes: https://brandunited.com/article/chewys-handwritten-notes-highlight-the-power-of-personalization/
- Duolingo case study: https://nogood.io/2023/10/09/duolingo-case-study/
- Warby Parker business texting: https://www.heymarket.com/blog/10-brands-that-use-business-text-messaging/
- TCPA / 10DLC 2026 guide: https://www.infobip.com/blog/tcpa-compliance-sms
- State mini-TCPA patchwork: https://beancount.io/blog/2026/06/04/tcpa-a2p-10dlc-sms-marketing-compliance-2026-small-business-text-program-the-campaign-registry-consent-stop-help-keyword-state-mini-tcpa-florida-ftsa-texas-sb140-guide
