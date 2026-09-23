"""AI copywriter: turns your concept + the brand kit into on-brand copy variants using Claude.

Two jobs:
  1. write_step()      - first drafts: N distinct variants for one step of the sequence.
  2. write_challenger() - continuous optimisation: when a variant loses, write a new one
                          that learns from the current winner but tests a different angle.

The brand kit is placed in the system prompt, so every call follows the same voice rules.
Output is forced into a schema (structured outputs), so we never have to parse free text.
"""

from __future__ import annotations  # postpone evaluation of type hints

import anthropic  # official Anthropic SDK
from pydantic import BaseModel, Field  # schema for structured output

from .brand import BrandKit  # voice rules + linting
from .models import Channel, Concept, Step, Variant  # records we read and produce

MODEL = "claude-opus-5"  # Claude model used for copywriting

CHANNEL_RULES = {  # channel-specific writing constraints given to Claude
    Channel.SMS: "SMS: 1-3 short sentences, under 280 characters (a footer is added later). "
                 "No links in the very first SMS. End with one easy question.",
    Channel.EMAIL: "Email: plain, personal, 40-120 words, looks like a 1:1 note, no images. "
                   "Subject: 2-6 words, lower-case feel, no clickbait.",
    Channel.PHONE: "Phone: a talk-track for the caller (human or Voice AI): opener that references "
                   "their original enquiry, one discovery question, the offer, how to handle "
                   "'not interested', and a voicemail version under 20 seconds.",
}


class DraftVariant(BaseModel):
    """What Claude must return for each variant."""

    hook: str = Field(description="One line naming the angle this variant tests")
    subject: str = Field(description="Email subject line; empty string for SMS and phone")
    body: str = Field(description="The message. May use {first_name} and {booking_link}")


class DraftSet(BaseModel):
    variants: list[DraftVariant]  # Claude returns a list of variants


class Copywriter:
    def __init__(self, brand: BrandKit, client: anthropic.Anthropic | None = None):
        self.brand = brand  # the brand kit shared by every prompt
        self.client = client or anthropic.Anthropic()  # reads ANTHROPIC_API_KEY from the environment
        self.system = [{  # system prompt as a block so it can be cached across calls
            "type": "text",
            "text": (
                "You are the senior copywriter for a small business's customer engagement center. "
                "You write outreach to OLD leads: people who enquired months ago and went quiet. "
                "The goal is a genuine reply, not a hard sell. Messages must read like they came "
                "from one real person who remembers the lead. Never invent offers, prices, "
                "deadlines or facts that are not in the concept. Allowed merge fields: "
                "{first_name}, {booking_link}, {business_name}, {sender_name}.\n\n"
                "BRAND KIT (follow exactly):\n" + brand.prompt_block()
            ),
            "cache_control": {"type": "ephemeral"},  # identical on every call -> cheap cache reads
        }]

    def _ask(self, prompt: str) -> DraftSet:
        """One structured-output call to Claude."""
        resp = self.client.messages.parse(
            model=MODEL,
            max_tokens=16000,
            system=self.system,
            thinking={"type": "adaptive"},  # let Claude reason about angles before writing
            messages=[{"role": "user", "content": prompt}],
            output_format=DraftSet,  # response is validated against the DraftSet schema
            # If a safety classifier declines, re-run on Anthropic's recommended fallback model.
            extra_headers={"anthropic-beta": "server-side-fallback-2026-07-01"},
            extra_body={"fallbacks": "default"},
        )
        if resp.stop_reason == "refusal" or resp.parsed_output is None:  # nothing usable came back
            raise RuntimeError(f"copywriter returned no usable output (stop_reason={resp.stop_reason})")
        return resp.parsed_output  # validated DraftSet

    def _accept(self, step: Step, drafts: DraftSet, prefix: str, start: int) -> list[Variant]:
        """Keep only drafts that pass the brand linter; name them d0-sms-a, d0-sms-b, ..."""
        out: list[Variant] = []
        for i, d in enumerate(drafts.variants):
            sample = self.brand.fill(d.body, {"first_name": "Alex", "booking_link": "https://x.co"})
            if self.brand.lint(step.channel, sample, d.subject):  # any violation -> discard draft
                continue
            letter = chr(ord("a") + start + i)  # a, b, c ...
            out.append(Variant(id=f"{prefix}-{letter}", body=d.body.strip(),
                               subject=d.subject.strip(), hook=d.hook.strip()))
        return out

    def write_step(self, concept: Concept, step: Step, n: int) -> list[Variant]:
        """First drafts for one step: n variants, each testing a clearly different angle."""
        prompt = (
            f"CAMPAIGN: {concept.name}\nOBJECTIVE: {concept.objective}\nANGLE: {concept.angle}\n"
            f"OFFER: {concept.offer or 'none'}\nNOTES: {concept.notes or 'none'}\n\n"
            f"STEP: day {step.day}, channel {step.channel.value}. Purpose: {step.purpose}\n"
            f"{CHANNEL_RULES[step.channel]}\n\n"
            f"Write {n} variants. Each must test a DIFFERENT hypothesis (e.g. curiosity vs. "
            f"helpfulness vs. offer-led vs. social proof), so the A/B test teaches us something."
        )
        return self._accept(step, self._ask(prompt), step.id, 0)

    def write_challenger(self, concept: Concept, step: Step, winner: Variant, retired: list[Variant]) -> list[Variant]:
        """One new variant that keeps what works in the winner but tests a fresh angle."""
        losers = "\n".join(f"- {v.hook}: {v.body}" for v in retired) or "none"
        prompt = (
            f"CAMPAIGN: {concept.name}\nOBJECTIVE: {concept.objective}\nANGLE: {concept.angle}\n"
            f"STEP: day {step.day}, channel {step.channel.value}. Purpose: {step.purpose}\n"
            f"{CHANNEL_RULES[step.channel]}\n\n"
            f"CURRENT WINNER ({winner.hook}):\n{winner.body}\n\nRETIRED LOSERS:\n{losers}\n\n"
            "Write 1 challenger variant: keep the winner's strengths, avoid the losers' patterns, "
            "and change ONE meaningful thing so we learn from the test."
        )
        n_existing = len(step.variants)  # continue the letter sequence after existing variants
        return self._accept(step, self._ask(prompt), step.id, n_existing)
