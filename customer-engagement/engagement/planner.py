"""Planner: turns a Concept (your idea) into a full multi-channel execution plan.

The default cadence is a 21-day, 9-touch sequence based on what works for
database reactivation: SMS opens the conversation, email adds substance, the phone
converts interest into a booking, and a polite "break-up" message closes the loop.

Plans are saved as YAML (campaigns/<slug>.plan.yaml) so a human can review and edit
every word before anything is sent - the approval gate between AI and customers.
"""

from __future__ import annotations  # postpone evaluation of type hints

import re  # build URL/file-safe slugs
from dataclasses import asdict  # dataclass -> dict for YAML
from pathlib import Path  # file paths

import yaml  # read concepts / write plans

from .models import Channel, Concept, Step, Variant  # records used by the plan

# (day, channel, purpose) - the proven reactivation skeleton. Edit freely per campaign.
DEFAULT_CADENCE: list[tuple[int, Channel, str]] = [
    (0, Channel.SMS, "Pattern-interrupt opener in the style of a 9-word email: a short, personal "
                     "question about their original enquiry. No pitch, no link."),
    (1, Channel.EMAIL, "Short personal check-in that references their original enquiry and asks "
                       "one question. Plain text feel."),
    (3, Channel.PHONE, "Friendly call to reconnect; learn what changed and offer to book a time."),
    (5, Channel.SMS, "Give value: a useful tip or insight related to their original interest."),
    (8, Channel.EMAIL, "Social proof: a short story of a similar customer and the result they got."),
    (12, Channel.SMS, "Present the offer clearly with the booking link and a genuine reason to act now."),
    (15, Channel.PHONE, "Second call attempt focused on the offer; leave a voicemail if no answer."),
    (18, Channel.EMAIL, "Break-up email: 'should I close your file?' - respectful, easy to reply to."),
    (21, Channel.SMS, "Final break-up text: one line, zero pressure, door left open."),
]


def slugify(name: str) -> str:
    """'Old Lead Reactivation Q4' -> 'old-lead-reactivation-q4'."""
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def load_concept(path: str | Path) -> Concept:
    """Read a concept YAML file written by you."""
    with open(path, encoding="utf-8") as fh:
        raw = yaml.safe_load(fh)  # plain dict from YAML
    raw["channels"] = [Channel(c) for c in raw.get("channels", [c.value for c in Channel])]  # str -> enum
    return Concept(**raw)  # validate fields by constructing the dataclass


def build_steps(concept: Concept) -> list[Step]:
    """Apply the cadence, keeping only the channels this concept allows."""
    steps = []
    for day, channel, purpose in DEFAULT_CADENCE:
        if channel in concept.channels:  # e.g. a concept can switch phone off entirely
            steps.append(Step(id=f"d{day}-{channel.value}", day=day, channel=channel, purpose=purpose))
    return steps


def draft_plan(concept: Concept, copywriter) -> list[Step]:
    """Build every step and ask the copywriter for variants for each one."""
    steps = build_steps(concept)
    for step in steps:
        step.variants = copywriter.write_step(concept, step, concept.variants_per_step)
    return steps


def save_plan(path: str | Path, concept: Concept, steps: list[Step], approved: bool = False) -> None:
    """Write concept + steps to YAML for human review."""
    doc = {
        "concept": {**asdict(concept), "channels": [c.value for c in concept.channels]},
        "approved": approved,  # the orchestrator refuses to send until a human sets this to true
        "steps": [{**asdict(s), "channel": s.channel.value} for s in steps],
    }
    with open(path, "w", encoding="utf-8") as fh:
        yaml.safe_dump(doc, fh, sort_keys=False, allow_unicode=True, width=100)


def load_plan(path: str | Path) -> tuple[Concept, list[Step], bool]:
    """Read a reviewed plan back. Returns (concept, steps, approved)."""
    with open(path, encoding="utf-8") as fh:
        doc = yaml.safe_load(fh)
    if "concept" not in doc:  # user passed a concept file instead of a generated plan
        raise SystemExit(f"{path} is not a plan file - run 'plan' on the concept first.")
    c = doc["concept"]
    c["channels"] = [Channel(x) for x in c["channels"]]
    concept = Concept(**c)
    steps = [
        Step(id=s["id"], day=s["day"], channel=Channel(s["channel"]), purpose=s["purpose"],
             variants=[Variant(**v) for v in s["variants"]])
        for s in doc["steps"]
    ]
    return concept, steps, bool(doc.get("approved"))
