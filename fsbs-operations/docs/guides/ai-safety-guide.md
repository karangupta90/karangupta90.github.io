# AI Safety Guide

Full design in `08-ai-readiness-and-voice-agent-design.md`. This is the short operational version.

## The one rule that matters most
AI drafts, classifies, and summarizes. **A human approves anything that reaches a customer beyond a narrow, pre-approved FAQ lookup set.** Nothing bypasses the AI draft-approval queue on the management dashboard.

## AI may never, on its own
Change a contract value or discount, promise or move an installation date, approve a refund, make a legal or final warranty/liability call, close a serious complaint or a service call, invent information not in the approved knowledge base or the customer's own authorized project record, or expose internal notes/commissions/costs/margins/employee information to a customer.

## If you're reviewing an AI draft
- Does it promise anything (a date, a discount, a warranty outcome)? If yes, edit it out or reject it.
- Does it match what's actually in the customer's project record, or does it sound plausible but unverified? If you can't confirm it, don't approve it.
- Is the tone consistent with the plain-language, older-audience writing rules in `communications/customer-messages.md`?

## Voice-agent readiness
No voice agent is deployed in this phase. The context/escalation/logging boundary is designed to be provider-agnostic (`08-ai-readiness-and-voice-agent-design.md` §3) specifically so a future choice isn't locked in prematurely.
