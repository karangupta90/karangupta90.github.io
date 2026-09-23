"""Orchestrator: runs the campaign. Call tick() on a schedule (e.g. every 15 minutes).

On each tick, for every active lead it:
  1. finds the next step the lead hasn't received and checks it is due,
  2. runs the compliance gate (opt-outs, DND, quiet hours, missing address),
  3. lets the bandit pick which copy variant to send,
  4. renders it through the brand kit and lints it,
  5. sends through GoHighLevel (SMS / email / call task or Voice AI workflow),
  6. records the send so replies can be credited to the right variant.
"""

from __future__ import annotations  # postpone evaluation of type hints

import hashlib  # deterministic holdout assignment
import random  # bandit randomness
from datetime import datetime, timedelta  # due-date maths

from . import compliance  # the send gate
from .brand import BrandKit  # rendering + lint
from .ghl import GHLClient  # CRM integration
from .models import Channel, Concept, EnrollmentStatus, Lead, Step  # records
from .optimizer import choose, leader, losers  # bandit maths
from .store import Store  # local state

MIN_GAP = timedelta(hours=20)  # never touch the same lead twice within 20 hours


def in_holdout(contact_id: str, pct: float) -> bool:
    """Stable coin-flip: the same contact always lands in the same group."""
    bucket = int(hashlib.sha256(contact_id.encode()).hexdigest(), 16) % 10_000  # 0..9999
    return bucket < pct * 10_000  # e.g. pct=0.10 -> buckets 0..999 are holdout


def enroll(slug: str, concept: Concept, ghl: GHLClient, store: Store) -> dict[str, int]:
    """Pull every contact with the audience tag from GHL and enrol them."""
    counts = {"enrolled": 0, "holdout": 0, "skipped": 0}  # summary for the CLI
    for lead in ghl.contacts_with_tag(concept.audience_tag):
        if lead.dnd or store.is_suppressed(lead.contact_id):  # never enrol opted-out contacts
            counts["skipped"] += 1
            continue
        status = EnrollmentStatus.HOLDOUT if in_holdout(lead.contact_id, concept.holdout_pct) else EnrollmentStatus.ACTIVE
        if store.enroll(slug, lead, status):  # False = already enrolled earlier
            counts["holdout" if status is EnrollmentStatus.HOLDOUT else "enrolled"] += 1
    return counts


def _next_step(steps: list[Step], sent: set[str]) -> Step | None:
    """First step (in day order) this lead has not received yet."""
    return next((s for s in sorted(steps, key=lambda s: s.day) if s.id not in sent), None)


def _fields(lead: Lead, concept: Concept) -> dict[str, str]:
    """Merge-field values for one lead."""
    return {"first_name": lead.first_name or "there", "booking_link": concept.booking_link,
            "offer": concept.offer, **lead.custom}


def tick(slug: str, concept: Concept, steps: list[Step], ghl: GHLClient, store: Store,
         brand: BrandKit, now: datetime, phone_mode: str = "task", voice_workflow_id: str = "",
         email_from: str = "", rng: random.Random | None = None) -> dict[str, int]:
    """One pass over all active leads. Safe to run as often as you like - it is idempotent."""
    rng = rng or random.Random()
    by_id = {s.id: s for s in steps}  # quick lookup of step by id
    counts: dict[str, int] = {}  # outcome tally for logging

    def bump(k: str) -> None:
        counts[k] = counts.get(k, 0) + 1

    for lead, enrolled_at in store.active(slug):
        sent = store.sent_steps(lead.contact_id, slug)  # what this lead already received
        step = _next_step(steps, sent)
        if step is None:  # sequence finished with no reply
            store.set_status(lead.contact_id, EnrollmentStatus.COMPLETED, slug)
            bump("completed")
            continue
        if now < enrolled_at + timedelta(days=step.day):  # not due yet
            bump("not_due")
            continue
        last = store.last_send_at(lead.contact_id, slug)
        if last and now - last < MIN_GAP:  # respect spacing even if steps piled up
            bump("spacing")
            continue

        ok, reason = compliance.can_send(lead, step.channel, now, store.is_suppressed(lead.contact_id))
        if not ok:
            if reason.startswith("missing"):  # can't ever send this step -> move past it
                store.record_send(lead.contact_id, slug, step.id, "skipped", step.channel.value, at=now)
            bump(reason)  # quiet hours etc. simply retry on a later tick
            continue

        live = [v for v in step.variants if v.active]  # retired variants don't compete
        if not live:
            bump("no_variants")
            continue
        arms = store.arm_stats(slug, step.id, [v.id for v in live])  # results so far
        picked = choose(arms, rng)  # bandit pick (sample once, then look it up)
        variant = next(v for v in live if v.id == picked)
        fields = _fields(lead, concept)

        if step.channel is Channel.SMS:
            first_sms = not any(by_id[s].channel is Channel.SMS for s in sent if s in by_id)
            text = brand.render_sms(variant.body, fields, first_touch=first_sms)
            problems = brand.lint(Channel.SMS, text)
            if problems:
                store.log(lead.contact_id, "lint_blocked", {"variant": variant.id, "problems": problems})
                bump("lint_blocked")
                continue
            ext = ghl.send_sms(lead.contact_id, text)
        elif step.channel is Channel.EMAIL:
            subject = brand.fill(variant.subject, fields)
            body = brand.fill(variant.body, fields)
            problems = brand.lint(Channel.EMAIL, body, subject)
            if problems:
                store.log(lead.contact_id, "lint_blocked", {"variant": variant.id, "problems": problems})
                bump("lint_blocked")
                continue
            ext = ghl.send_email(lead.contact_id, subject, brand.render_email_html(variant.body, fields), email_from)
        else:  # phone
            script = brand.fill(variant.body, fields)
            if phone_mode == "ai" and voice_workflow_id:  # GHL Voice AI / dialer workflow places the call
                ghl.add_to_workflow(lead.contact_id, voice_workflow_id)
                ext = voice_workflow_id
            else:  # a human rep gets a task with the talk-track, due now
                ext = ghl.create_call_task(lead.contact_id, f"Call {lead.first_name or 'lead'} - {concept.name}",
                                           script, now)

        store.record_send(lead.contact_id, slug, step.id, variant.id, step.channel.value, ext, at=now)
        store.log(lead.contact_id, "sent", {"step": step.id, "variant": variant.id})
        bump(f"sent_{step.channel.value}")
    return counts


def evolve(slug: str, concept: Concept, steps: list[Step], store: Store, copywriter,
           auto_approve: bool = False) -> list[str]:
    """Continuous optimisation: retire clear losers and write challengers modelled on winners.

    New challengers are added inactive (auto_approve=False) so a human can review them in
    the plan file first; set auto_approve=True once you trust the brand guard."""
    changes: list[str] = []
    for step in steps:
        live = [v for v in step.variants if v.active]
        arms = store.arm_stats(slug, step.id, [v.id for v in live])
        dead = set(losers(arms))  # variants <5% likely to be best after enough sends
        if not dead:
            continue
        for v in step.variants:
            if v.id in dead:
                v.active = False  # stop sending it
                changes.append(f"retired {v.id}")
        best_id = leader([a for a in arms if a.variant_id not in dead])
        winner = next(v for v in step.variants if v.id == best_id)
        for new in copywriter.write_challenger(concept, step, winner, [v for v in step.variants if v.id in dead]):
            new.active = auto_approve  # human review by default
            step.variants.append(new)
            changes.append(f"added challenger {new.id}{'' if auto_approve else ' (pending review)'}")
    return changes
