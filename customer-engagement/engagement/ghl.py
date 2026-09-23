"""GoHighLevel (LeadConnector) API v2 client - the CRM integration layer.

Only this file talks to GoHighLevel, so moving to another CRM later means writing
one new client with the same method names.

Reference: https://marketplace.gohighlevel.com/docs
Auth: a Private Integration token (Settings -> Private Integrations) scoped to the
sub-account, or an OAuth access token from a Marketplace app.
"""

from __future__ import annotations  # postpone evaluation of type hints

import time  # back-off sleeps on rate limits
from datetime import datetime, timezone  # task due dates

import requests  # HTTP client

from .models import Lead  # we convert GHL contacts into Lead records

BASE_URL = "https://services.leadconnectorhq.com"  # API v2 host
VERSION_DEFAULT = "2021-07-28"  # "Version" header required by contacts/opportunities endpoints
VERSION_CONVERSATIONS = "2021-04-15"  # conversations endpoints use the older version string


class GHLError(RuntimeError):
    """Raised when GoHighLevel returns a non-success response."""


class GHLClient:
    def __init__(self, token: str, location_id: str, dry_run: bool = False):
        self.location_id = location_id  # the GHL sub-account we operate on
        self.dry_run = dry_run  # True = log what would happen, never call write endpoints
        self.http = requests.Session()  # re-uses TCP connections across calls
        self.http.headers.update({  # headers sent on every request
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
            "Content-Type": "application/json",
        })

    # --- low-level request with rate-limit handling ----------------------------------
    def _req(self, method: str, path: str, version: str = VERSION_DEFAULT, **kw) -> dict:
        """Send one request. GHL allows ~100 requests / 10s per location; on HTTP 429 we
        wait and retry with exponential back-off instead of failing the whole run."""
        for attempt in range(5):  # up to 5 tries
            resp = self.http.request(method, BASE_URL + path, headers={"Version": version}, timeout=30, **kw)
            if resp.status_code == 429:  # rate limited
                time.sleep(2 ** attempt)  # 1s, 2s, 4s, 8s, 16s
                continue
            if resp.status_code >= 400:  # any other error is surfaced to the caller
                raise GHLError(f"{method} {path} -> {resp.status_code}: {resp.text[:300]}")
            return resp.json() if resp.content else {}  # some endpoints return an empty body
        raise GHLError(f"{method} {path} still rate-limited after retries")

    # --- reading contacts ----------------------------------------------------------
    def contacts_with_tag(self, tag: str, page_limit: int = 100) -> list[Lead]:
        """All contacts carrying a tag (e.g. 'lead-cold'), paging through results.
        Uses POST /contacts/search (the advanced search that replaced GET /contacts)."""
        leads: list[Lead] = []  # accumulated results
        page = 1  # GHL search pages are 1-based
        while True:
            body = {
                "locationId": self.location_id,
                "page": page,
                "pageLimit": page_limit,
                "filters": [{"field": "tags", "operator": "contains", "value": tag}],
            }
            data = self._req("POST", "/contacts/search", json=body)  # one page of contacts
            batch = data.get("contacts", [])  # list of contact dicts
            leads.extend(self._to_lead(c) for c in batch)  # convert each to our Lead type
            if len(batch) < page_limit:  # a short page means we reached the end
                return leads
            page += 1  # otherwise fetch the next page

    @staticmethod
    def _to_lead(c: dict) -> Lead:
        """Map GHL's contact JSON onto our Lead record."""
        custom = {  # flatten custom fields to {id or key: value} for merge fields
            str(f.get("key") or f.get("id")): str(f.get("value", ""))
            for f in c.get("customFields", []) or []
        }
        return Lead(
            contact_id=c["id"],
            first_name=(c.get("firstName") or "").strip().title(),  # "JOHN " -> "John"
            email=c.get("email") or "",
            phone=c.get("phone") or "",
            timezone=c.get("timezone") or "America/New_York",  # sensible default if unset
            dnd=bool(c.get("dnd")),  # GHL global Do-Not-Disturb
            tags=c.get("tags") or [],
            custom=custom,
        )

    # --- writing: messages ----------------------------------------------------------
    def send_sms(self, contact_id: str, text: str) -> str:
        """Send an SMS through the location's LC Phone/Twilio number. Returns the message id."""
        if self.dry_run:
            return "dry-run"
        data = self._req("POST", "/conversations/messages", version=VERSION_CONVERSATIONS,
                         json={"type": "SMS", "contactId": contact_id, "message": text})
        return data.get("messageId", "")

    def send_email(self, contact_id: str, subject: str, html: str, email_from: str = "") -> str:
        """Send an email through the location's LC Email/Mailgun setup. Returns the message id.
        Sending from the conversations API means replies land in the GHL inbox thread."""
        if self.dry_run:
            return "dry-run"
        body = {"type": "Email", "contactId": contact_id, "subject": subject, "html": html}
        if email_from:
            body["emailFrom"] = email_from  # e.g. "Karan <karan@yourdomain.com>"
        data = self._req("POST", "/conversations/messages", version=VERSION_CONVERSATIONS, json=body)
        return data.get("messageId", "")

    # --- writing: phone ---------------------------------------------------------------
    def create_call_task(self, contact_id: str, title: str, script: str, due: datetime) -> str:
        """Phone step, 'human' mode: a task in the rep's GHL task list with the talk-track."""
        if self.dry_run:
            return "dry-run"
        data = self._req("POST", f"/contacts/{contact_id}/tasks", json={
            "title": title,
            "body": script,
            "dueDate": due.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "completed": False,
        })
        return (data.get("task") or {}).get("id", "")

    def add_to_workflow(self, contact_id: str, workflow_id: str) -> None:
        """Phone step, 'ai' mode: enrol the contact in a GHL workflow that places the call
        (e.g. a Voice AI outbound-call action or a power-dialer queue)."""
        if not self.dry_run:
            self._req("POST", f"/contacts/{contact_id}/workflow/{workflow_id}", json={})

    # --- writing: CRM hygiene ----------------------------------------------------------
    def add_tags(self, contact_id: str, tags: list[str]) -> None:
        """Tag contacts so the CRM shows campaign state (e.g. 'ce-replied', 'ce-opted-out')."""
        if not self.dry_run:
            self._req("POST", f"/contacts/{contact_id}/tags", json={"tags": tags})

    def set_dnd(self, contact_id: str) -> None:
        """Mirror an opt-out into GHL so GHL's own workflows also stop messaging the lead."""
        if not self.dry_run:
            self._req("PUT", f"/contacts/{contact_id}", json={"dnd": True})
