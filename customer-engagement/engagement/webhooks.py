"""Webhook receiver: GoHighLevel tells us when leads reply, book, or opt out.

This is what closes the optimisation loop. Every reply or booking is credited to the
variant that caused it, and every opt-out is honoured instantly across all channels.

Point GHL at POST https://<your-host>/webhooks/ghl, either from a Marketplace app
(events are signed with X-GHL-Signature, Ed25519) or from a Workflow "Webhook" action
(unsigned, so add ?token=<WEBHOOK_TOKEN> to the URL).
"""

from __future__ import annotations  # postpone evaluation of type hints

import base64  # signatures and the public key are base64-encoded
import hmac  # constant-time comparison for the shared token
import json  # parse the raw body after verifying it

from cryptography.exceptions import InvalidSignature  # raised on a bad signature
from cryptography.hazmat.primitives.serialization import load_der_public_key  # parse GHL's key
from fastapi import FastAPI, HTTPException, Request  # web framework
from starlette.concurrency import run_in_threadpool  # run blocking DB/GHL calls off the event loop

from .compliance import is_opt_out  # "STOP", "remove me", ...
from .ghl import GHLClient  # mirror outcomes back into the CRM
from .models import EnrollmentStatus  # status values
from .store import Store  # local state

# HighLevel's published Ed25519 webhook public key (marketplace.gohighlevel.com/docs, Webhook Integration Guide).
GHL_PUBLIC_KEY = "MCowBQYDK2VwAyEAi2HR1srL4o18O8BRa7gVJY7G7bupbN3H9AwJrHCDiOg="

CONVERSION_TYPES = {"AppointmentCreate"}  # events that count as a conversion
WON_STATUSES = {"won"}  # opportunity status that also counts as a conversion


def verify_signature(raw: bytes, signature_b64: str, public_key_b64: str = GHL_PUBLIC_KEY) -> bool:
    """True if the body was signed by HighLevel's private key."""
    try:
        key = load_der_public_key(base64.b64decode(public_key_b64))  # DER-encoded Ed25519 key
        key.verify(base64.b64decode(signature_b64), raw)  # raises if the signature is wrong
        return True
    except (InvalidSignature, ValueError):
        return False


def _contact_id(evt: dict) -> str:
    """Different GHL events put the contact id in different places."""
    return evt.get("contactId") or (evt.get("appointment") or {}).get("contactId") or ""


def handle_event(evt: dict, store: Store, ghl: GHLClient) -> str:
    """Apply one webhook event. Returns a short label describing what happened.
    Every branch is idempotent because GHL retries deliveries up to 12 times."""
    kind = evt.get("type", "")  # e.g. InboundMessage, AppointmentCreate
    cid = _contact_id(evt)
    if not cid:
        return "ignored:no_contact"

    if kind == "InboundMessage":  # the lead replied by SMS, email, etc.
        body = evt.get("body") or evt.get("message") or ""
        if is_opt_out(body):  # honour opt-outs in any wording, on every channel
            store.suppress(cid, f"inbound: {body[:80]}")
            ghl.set_dnd(cid)  # GHL's own automations stop too
            ghl.add_tags(cid, ["ce-opted-out"])
            store.log(cid, "opt_out", {"body": body})
            return "opt_out"
        store.attribute_success(cid)  # credit the variant that earned the reply
        store.set_status(cid, EnrollmentStatus.REPLIED)  # pause automation: a human takes over
        ghl.add_tags(cid, ["ce-replied"])  # trigger a GHL workflow to alert the rep / create an opportunity
        store.log(cid, "inbound_reply", {"channel": evt.get("messageType"), "body": body[:500]})
        return "reply"

    is_won = kind == "OpportunityStatusUpdate" and str(evt.get("status", "")).lower() in WON_STATUSES
    if kind in CONVERSION_TYPES or is_won:  # booked appointment or won deal
        store.attribute_success(cid)
        store.mark_conversion(cid)  # holdout conversions are tracked separately for lift
        ghl.add_tags(cid, ["ce-converted"])
        store.log(cid, "conversion", {"type": kind})
        return "conversion"

    return f"ignored:{kind}"


def create_app(store: Store, ghl: GHLClient, token: str = "") -> FastAPI:
    """Build the web app. Started by: python -m engagement.cli serve"""
    app = FastAPI(title="Customer Engagement Center")

    @app.get("/health")
    def health() -> dict:
        return {"ok": True}  # uptime checks

    @app.post("/webhooks/ghl")
    async def ghl_webhook(request: Request) -> dict:
        raw = await request.body()  # verify against the exact bytes GHL signed
        sig = request.headers.get("x-ghl-signature")
        if sig:  # Marketplace app delivery
            if not verify_signature(raw, sig):
                raise HTTPException(401, "bad signature")
        elif not (token and hmac.compare_digest(request.query_params.get("token", ""), token)):
            raise HTTPException(401, "missing signature or token")  # reject unauthenticated calls
        return {"result": await run_in_threadpool(handle_event, json.loads(raw), store, ghl)}

    return app
