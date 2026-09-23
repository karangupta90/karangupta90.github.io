"""Local state in SQLite: enrollments, every send, opt-outs and an audit log.

GoHighLevel stays the system of record for contacts and conversations. This small
database only remembers what the engine itself needs: who is in which campaign,
which variant each lead received, and which sends earned a response.
"""

from __future__ import annotations  # postpone evaluation of type hints

import json  # store lead snapshots and event payloads as JSON text
import sqlite3  # zero-setup embedded database that ships with Python
from dataclasses import asdict  # dataclass -> dict for JSON storage
from datetime import datetime, timedelta, timezone  # timestamps (always UTC)

from .models import EnrollmentStatus, Lead  # enums/records we persist
from .optimizer import ArmStats  # returned by arm_stats()

SCHEMA = """
CREATE TABLE IF NOT EXISTS enrollments (
  contact_id  TEXT NOT NULL,           -- GHL contact id
  campaign    TEXT NOT NULL,           -- campaign slug
  status      TEXT NOT NULL,           -- EnrollmentStatus value
  enrolled_at TEXT NOT NULL,           -- ISO-8601 UTC; step days count from here
  lead_json   TEXT NOT NULL,           -- snapshot of the Lead used for merge fields
  PRIMARY KEY (contact_id, campaign)   -- a lead can be in a campaign only once
);
CREATE TABLE IF NOT EXISTS sends (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id  TEXT NOT NULL,
  campaign    TEXT NOT NULL,
  step_id     TEXT NOT NULL,
  variant_id  TEXT NOT NULL,           -- the bandit arm that was used
  channel     TEXT NOT NULL,
  sent_at     TEXT NOT NULL,
  success     INTEGER NOT NULL DEFAULT 0,  -- 1 once a reply/conversion is attributed
  external_id TEXT                     -- GHL message/task id for traceability
);
CREATE TABLE IF NOT EXISTS suppression (
  contact_id TEXT PRIMARY KEY,         -- global opt-out list across ALL campaigns and channels
  reason     TEXT NOT NULL,
  at         TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id TEXT,
  kind       TEXT NOT NULL,            -- e.g. inbound_reply, conversion, opt_out, skipped
  payload    TEXT,
  at         TEXT NOT NULL
);
"""

ATTRIBUTION_WINDOW = timedelta(hours=72)  # a reply within 72h of a send is credited to that send


def utcnow() -> datetime:
    return datetime.now(timezone.utc)  # timezone-aware "now", never naive local time


class Store:
    """Thin wrapper around the SQLite file."""

    def __init__(self, path: str = "data/engagement.db"):
        # check_same_thread=False: the webhook server handles requests on worker threads.
        self.db = sqlite3.connect(path, check_same_thread=False)  # opens (or creates) the database file
        self.db.row_factory = sqlite3.Row  # rows behave like dicts: row["status"]
        self.db.executescript(SCHEMA)  # create tables on first run; no-op afterwards

    # --- enrollments ------------------------------------------------------------
    def enroll(self, campaign: str, lead: Lead, status: EnrollmentStatus) -> bool:
        """Add a lead to a campaign. Returns False if they were already in it."""
        cur = self.db.execute(
            "INSERT OR IGNORE INTO enrollments VALUES (?,?,?,?,?)",  # ignore duplicates silently
            (lead.contact_id, campaign, status.value, utcnow().isoformat(), json.dumps(asdict(lead))),
        )
        self.db.commit()  # persist immediately
        return cur.rowcount == 1  # 1 row inserted = newly enrolled

    def active(self, campaign: str) -> list[tuple[Lead, datetime]]:
        """All leads still receiving steps, with their enrollment time."""
        rows = self.db.execute(
            "SELECT lead_json, enrolled_at FROM enrollments WHERE campaign=? AND status=?",
            (campaign, EnrollmentStatus.ACTIVE.value),
        ).fetchall()
        return [(Lead(**json.loads(r["lead_json"])), datetime.fromisoformat(r["enrolled_at"])) for r in rows]

    def set_status(self, contact_id: str, status: EnrollmentStatus, campaign: str | None = None) -> None:
        """Change status in one campaign, or in every active campaign when campaign is None."""
        if campaign:
            self.db.execute("UPDATE enrollments SET status=? WHERE contact_id=? AND campaign=?",
                            (status.value, contact_id, campaign))
        else:
            self.db.execute("UPDATE enrollments SET status=? WHERE contact_id=? AND status=?",
                            (status.value, contact_id, EnrollmentStatus.ACTIVE.value))
        self.db.commit()

    def mark_conversion(self, contact_id: str) -> None:
        """A conversion ends the journey. Holdout conversions are kept separate: they are the
        baseline that proves how much lift the campaign itself created."""
        self.db.execute("UPDATE enrollments SET status=? WHERE contact_id=? AND status IN (?,?)",
                        (EnrollmentStatus.CONVERTED.value, contact_id,
                         EnrollmentStatus.ACTIVE.value, EnrollmentStatus.REPLIED.value))
        self.db.execute("UPDATE enrollments SET status=? WHERE contact_id=? AND status=?",
                        (EnrollmentStatus.HOLDOUT_CONVERTED.value, contact_id, EnrollmentStatus.HOLDOUT.value))
        self.db.commit()

    # --- sends & attribution --------------------------------------------------------
    def sent_steps(self, contact_id: str, campaign: str) -> set[str]:
        """Step ids already delivered to this lead (so nothing is ever sent twice)."""
        rows = self.db.execute("SELECT step_id FROM sends WHERE contact_id=? AND campaign=?",
                               (contact_id, campaign)).fetchall()
        return {r["step_id"] for r in rows}

    def last_send_at(self, contact_id: str, campaign: str) -> datetime | None:
        """When this lead was last touched in this campaign (None if never)."""
        row = self.db.execute("SELECT MAX(sent_at) t FROM sends WHERE contact_id=? AND campaign=?",
                              (contact_id, campaign)).fetchone()
        return datetime.fromisoformat(row["t"]) if row and row["t"] else None

    def record_send(self, contact_id: str, campaign: str, step_id: str, variant_id: str,
                    channel: str, external_id: str = "", at: datetime | None = None) -> None:
        """Log a delivered (or permanently skipped) step. 'at' defaults to the real clock."""
        self.db.execute(
            "INSERT INTO sends (contact_id,campaign,step_id,variant_id,channel,sent_at,external_id)"
            " VALUES (?,?,?,?,?,?,?)",
            (contact_id, campaign, step_id, variant_id, channel, (at or utcnow()).isoformat(), external_id),
        )
        self.db.commit()

    def attribute_success(self, contact_id: str) -> None:
        """Credit the lead's most recent send inside the attribution window as a success."""
        cutoff = (utcnow() - ATTRIBUTION_WINDOW).isoformat()  # ignore sends older than 72h
        row = self.db.execute(
            "SELECT id FROM sends WHERE contact_id=? AND sent_at>=? ORDER BY sent_at DESC LIMIT 1",
            (contact_id, cutoff),
        ).fetchone()
        if row:  # a qualifying send exists
            self.db.execute("UPDATE sends SET success=1 WHERE id=?", (row["id"],))
            self.db.commit()

    def arm_stats(self, campaign: str, step_id: str, variant_ids: list[str]) -> list[ArmStats]:
        """Bandit inputs for one step. Sends still inside the 72h window and without a
        response are not yet counted as failures - that would unfairly punish new sends."""
        cutoff = (utcnow() - ATTRIBUTION_WINDOW).isoformat()
        stats = {v: ArmStats(v) for v in variant_ids}  # start every live variant at zero
        rows = self.db.execute(
            "SELECT variant_id, COUNT(*) n, SUM(success) s FROM sends"
            " WHERE campaign=? AND step_id=? AND (success=1 OR sent_at<?) GROUP BY variant_id",
            (campaign, step_id, cutoff),
        ).fetchall()
        for r in rows:
            if r["variant_id"] in stats:  # skip retired variants
                stats[r["variant_id"]].sends = r["n"]
                stats[r["variant_id"]].successes = r["s"] or 0
        return list(stats.values())

    # --- suppression & audit ------------------------------------------------------
    def suppress(self, contact_id: str, reason: str) -> None:
        """Add to the global do-not-contact list and stop every active journey."""
        self.db.execute("INSERT OR REPLACE INTO suppression VALUES (?,?,?)",
                        (contact_id, reason, utcnow().isoformat()))
        self.db.commit()
        self.set_status(contact_id, EnrollmentStatus.OPTED_OUT)  # all campaigns at once

    def is_suppressed(self, contact_id: str) -> bool:
        return self.db.execute("SELECT 1 FROM suppression WHERE contact_id=?", (contact_id,)).fetchone() is not None

    def log(self, contact_id: str | None, kind: str, payload: dict | None = None) -> None:
        """Append-only audit trail: proves what was sent and why (useful for compliance)."""
        self.db.execute("INSERT INTO events (contact_id,kind,payload,at) VALUES (?,?,?,?)",
                        (contact_id, kind, json.dumps(payload or {}), utcnow().isoformat()))
        self.db.commit()

    def funnel(self, campaign: str) -> dict[str, int]:
        """Count of enrollments per status - the headline report, including the holdout group."""
        rows = self.db.execute("SELECT status, COUNT(*) n FROM enrollments WHERE campaign=? GROUP BY status",
                               (campaign,)).fetchall()
        return {r["status"]: r["n"] for r in rows}
