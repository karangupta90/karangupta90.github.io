"""Offline tests: no network, no GHL account, no Claude calls."""

import base64
import random
from datetime import datetime, timedelta, timezone
from pathlib import Path

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
from fastapi.testclient import TestClient

from engagement import compliance, optimizer
from engagement.brand import BrandKit
from engagement.copywriter import Copywriter, DraftSet, DraftVariant
from engagement.models import Channel, EnrollmentStatus, Lead
from engagement.orchestrator import enroll, evolve, in_holdout, tick
from engagement.planner import build_steps, load_concept, load_plan, save_plan
from engagement.store import Store
from engagement.webhooks import create_app, handle_event, verify_signature

ROOT = Path(__file__).resolve().parents[1]
BRAND = BrandKit.load(ROOT / "brand/brand.yaml")
CONCEPT = load_concept(ROOT / "campaigns/old-lead-reactivation.yaml")
TUESDAY_11AM_NY = datetime(2026, 9, 22, 15, 0, tzinfo=timezone.utc)  # 11:00 in New York


def next_tuesday_11am_ny() -> datetime:
    """A send-window time that is after 'now' (enrollments are stamped with the real clock)."""
    d = datetime.now(timezone.utc).replace(hour=15, minute=0, second=0, microsecond=0) + timedelta(days=1)
    while d.weekday() != 1:  # 1 = Tuesday
        d += timedelta(days=1)
    return d


class FakeGHL:
    """Records calls instead of hitting the API."""

    def __init__(self, leads):
        self.leads, self.calls = leads, []

    def contacts_with_tag(self, tag):
        return self.leads

    def send_sms(self, cid, text):
        self.calls.append(("sms", cid, text)); return "m1"

    def send_email(self, cid, subject, html, email_from=""):
        self.calls.append(("email", cid, subject)); return "m2"

    def create_call_task(self, cid, title, script, due):
        self.calls.append(("task", cid, title)); return "t1"

    def add_to_workflow(self, cid, wf):
        self.calls.append(("workflow", cid, wf))

    def add_tags(self, cid, tags):
        self.calls.append(("tags", cid, tuple(tags)))

    def set_dnd(self, cid):
        self.calls.append(("dnd", cid))


class FakeCopywriter:
    def write_step(self, concept, step, n):
        from engagement.models import Variant
        return [Variant(id=f"{step.id}-{c}", body=f"Hi {{first_name}}, still interested? ({c})",
                        subject="quick question" if step.channel is Channel.EMAIL else "", hook=c)
                for c in "abc"[:n]]

    def write_challenger(self, concept, step, winner, retired):
        from engagement.models import Variant
        return [Variant(id=f"{step.id}-z", body="Hi {first_name}, new angle?", hook="challenger")]


def plan():
    steps = build_steps(CONCEPT)
    fc = FakeCopywriter()
    for s in steps:
        s.variants = fc.write_step(CONCEPT, s, 3)
    return steps


# --- compliance ---------------------------------------------------------------------
def test_opt_out_detection():
    for msg in ["STOP", "stop.", "Unsubscribe", "please stop texting me", "Remove me from your list",
                "don't call me again", "wrong number"]:
        assert compliance.is_opt_out(msg), msg
    for msg in ["Yes still interested", "stop by tomorrow?", "call me friday"]:
        assert not compliance.is_opt_out(msg), msg


def test_quiet_hours_and_weekends():
    assert not compliance.in_quiet_hours(TUESDAY_11AM_NY, "America/New_York")
    assert compliance.in_quiet_hours(TUESDAY_11AM_NY.replace(hour=1), "America/New_York")  # 9pm NY
    assert compliance.in_quiet_hours(datetime(2026, 9, 26, 15, tzinfo=timezone.utc), "America/New_York")  # Sat
    nxt = compliance.next_send_window(datetime(2026, 9, 26, 15, tzinfo=timezone.utc), "America/New_York")
    assert not compliance.in_quiet_hours(nxt, "America/New_York")


def test_can_send_gate():
    lead = Lead("c1", phone="+15550000000")
    assert compliance.can_send(lead, Channel.SMS, TUESDAY_11AM_NY, False) == (True, "ok")
    assert compliance.can_send(lead, Channel.EMAIL, TUESDAY_11AM_NY, False)[1] == "missing email address"
    assert compliance.can_send(lead, Channel.SMS, TUESDAY_11AM_NY, True)[1] == "opted_out"


# --- brand ----------------------------------------------------------------------------
def test_brand_lint_and_render():
    assert BRAND.lint(Channel.SMS, "Act now! This is GUARANTEED") != []
    assert BRAND.lint(Channel.SMS, "Hi Sam, still thinking about the project?") == []
    sms = BRAND.render_sms("Hi {first_name}, still looking?", {"first_name": "Sam"}, first_touch=True)
    assert sms.endswith("Reply STOP to opt out.") and "Sam" in sms
    html = BRAND.render_email_html("Hi {first_name}\n\nOne question <b>", {"first_name": "Sam"})
    assert "&lt;b&gt;" in html and "Customer Success" in html


# --- optimizer ------------------------------------------------------------------------
def test_bandit_prefers_winner_and_flags_loser():
    arms = [optimizer.ArmStats("a", 200, 40), optimizer.ArmStats("b", 200, 8)]
    picks = [optimizer.choose(arms, random.Random(i)) for i in range(500)]
    assert picks.count("a") > 450
    assert optimizer.losers(arms) == ["b"]
    assert optimizer.losers([optimizer.ArmStats("a", 10, 2), optimizer.ArmStats("b", 10, 1)]) == []


# --- orchestration end-to-end -----------------------------------------------------------
def test_enroll_tick_reply_and_opt_out(tmp_path):
    store = Store(str(tmp_path / "t.db"))
    leads = [Lead(f"c{i}", first_name="Sam", email=f"s{i}@x.co", phone="+1555000") for i in range(40)]
    ghl = FakeGHL(leads)
    counts = enroll("olr", CONCEPT, ghl, store)
    assert counts["enrolled"] + counts["holdout"] == 40 and counts["holdout"] >= 1
    assert enroll("olr", CONCEPT, ghl, store)["enrolled"] == 0  # idempotent

    steps = plan()
    now = next_tuesday_11am_ny()
    out = tick("olr", CONCEPT, steps, ghl, store, BRAND, now, rng=random.Random(1))
    assert out["sent_sms"] == counts["enrolled"]
    holdout_ids = {l.contact_id for l in leads if in_holdout(l.contact_id, CONCEPT.holdout_pct)}
    assert not any(c[1] in holdout_ids for c in ghl.calls)  # control group never contacted
    first = next(c for c in ghl.calls if c[0] == "sms")
    assert first[2].endswith("Reply STOP to opt out.")

    # Same tick again: nothing is sent twice.
    assert "sent_sms" not in tick("olr", CONCEPT, steps, ghl, store, BRAND, now)

    active_id = next(l.contact_id for l in leads if l.contact_id not in holdout_ids)
    assert handle_event({"type": "InboundMessage", "contactId": active_id, "body": "yes, tell me more"},
                        store, ghl) == "reply"
    assert sum(a.successes for a in store.arm_stats("olr", "d0-sms", [v.id for v in steps[0].variants])) == 1

    other = [l.contact_id for l in leads if l.contact_id not in holdout_ids][1]
    assert handle_event({"type": "InboundMessage", "contactId": other, "body": "STOP"}, store, ghl) == "opt_out"
    assert store.is_suppressed(other) and ("dnd", other) in ghl.calls

    # Day 1: the email step goes to everyone still active (not the replier or opt-out).
    out = tick("olr", CONCEPT, steps, ghl, store, BRAND, now + timedelta(days=1))
    assert out["sent_email"] == counts["enrolled"] - 2

    # A holdout lead that books on its own is tracked as the baseline.
    h = next(iter(holdout_ids))
    handle_event({"type": "AppointmentCreate", "appointment": {"contactId": h}}, store, ghl)
    assert store.funnel("olr")[EnrollmentStatus.HOLDOUT_CONVERTED.value] == 1


def test_evolve_retires_loser_and_adds_pending_challenger(tmp_path):
    store = Store(str(tmp_path / "t.db"))
    steps = plan()
    old = (datetime.now(timezone.utc) - timedelta(days=5)).isoformat()
    for vid, wins in [("d0-sms-a", 30), ("d0-sms-b", 2), ("d0-sms-c", 25)]:
        for i in range(100):
            store.db.execute("INSERT INTO sends (contact_id,campaign,step_id,variant_id,channel,sent_at,success)"
                             " VALUES (?,?,?,?,?,?,?)", (f"{vid}{i}", "olr", "d0-sms", vid, "sms", old, int(i < wins)))
    changes = evolve("olr", CONCEPT, steps, store, FakeCopywriter())
    assert "retired d0-sms-b" in changes
    new = steps[0].variants[-1]
    assert new.id == "d0-sms-z" and new.active is False  # waits for human review


def test_plan_roundtrip(tmp_path):
    p = tmp_path / "p.yaml"
    save_plan(p, CONCEPT, plan())
    concept, steps, approved = load_plan(p)
    assert concept.name == CONCEPT.name and len(steps) == 9 and approved is False


# --- copywriter (Claude call mocked) --------------------------------------------------------
def test_copywriter_filters_off_brand_drafts():
    class Resp:
        stop_reason = "end_turn"
        parsed_output = DraftSet(variants=[
            DraftVariant(hook="curiosity", subject="", body="Hi {first_name}, still thinking about it?"),
            DraftVariant(hook="spammy", subject="", body="ACT NOW, this is GUARANTEED!!!"),
        ])

    class FakeMessages:
        def parse(self, **kw):
            assert kw["model"] == "claude-opus-5" and "BRAND KIT" in kw["system"][0]["text"]
            return Resp()

    class FakeClient:
        messages = FakeMessages()

    step = build_steps(CONCEPT)[0]
    out = Copywriter(BRAND, client=FakeClient()).write_step(CONCEPT, step, 2)
    assert [v.hook for v in out] == ["curiosity"] and out[0].id == "d0-sms-a"


# --- webhook security -------------------------------------------------------------------
def test_signature_and_token_auth(tmp_path):
    priv = Ed25519PrivateKey.generate()
    pub = base64.b64encode(priv.public_key().public_bytes(Encoding.DER, PublicFormat.SubjectPublicKeyInfo)).decode()
    body = b'{"type":"InboundMessage","contactId":"c1","body":"hi"}'
    assert verify_signature(body, base64.b64encode(priv.sign(body)).decode(), pub)
    assert not verify_signature(body + b" ", base64.b64encode(priv.sign(body)).decode(), pub)

    client = TestClient(create_app(Store(str(tmp_path / "t.db")), FakeGHL([]), token="s3cret"))
    assert client.post("/webhooks/ghl", content=body).status_code == 401
    assert client.post("/webhooks/ghl?token=wrong", content=body).status_code == 401
    assert client.post("/webhooks/ghl?token=s3cret", content=body).json() == {"result": "reply"}
