"""Compliance gate: decides whether a message may be sent right now.

Rules implemented (US focus, conservative by design - this is not legal advice):
  * Quiet hours: 8am-8pm in the lead's local time (TCPA allows 8am-9pm, but
    Florida, Oklahoma and others require 8pm, so we use the stricter window everywhere).
  * Opt-outs by "any reasonable means" (FCC 2025 rule): STOP keywords AND plain-English
    requests such as "please stop texting me" are honoured across all channels.
  * GHL Do-Not-Disturb flag is always respected.
  * A lead must have the right contact detail for the channel.
"""

from __future__ import annotations  # postpone evaluation of type hints

import re  # pattern matching for opt-out language
from datetime import datetime, time, timedelta  # clock maths for quiet hours
from zoneinfo import ZoneInfo  # IANA timezone database (built into Python 3.9+)

from .models import Channel, Lead  # channel + lead records

QUIET_START = time(20, 0)  # no messages at or after 8:00pm local time
QUIET_END = time(8, 0)  # ...or before 8:00am local time
WEEKEND_OK = False  # old-lead outreach performs best Tue-Thu; weekends are skipped

# Carrier-standard keywords (CTIA) - an exact single-word reply means opt-out.
STOP_WORDS = {"stop", "stopall", "unsubscribe", "cancel", "end", "quit", "optout", "revoke"}

# Natural-language opt-outs the FCC says must also be honoured.
STOP_PATTERNS = [
    r"\bstop (texting|messaging|calling|emailing|contacting)\b",
    r"\b(remove|take) me (off|from)\b",
    r"\bdo not (text|call|email|contact)\b",
    r"\bdon'?t (text|call|email|contact)\b",
    r"\bunsubscribe\b",
    r"\bleave me alone\b",
    r"\bwrong number\b",
]


def is_opt_out(message: str) -> bool:
    """True when an inbound reply should be treated as a request to stop."""
    text = message.strip().lower()  # normalise case and whitespace
    if re.sub(r"[^a-z]", "", text) in STOP_WORDS:  # "STOP", "Stop.", "stop!" all count
        return True
    return any(re.search(p, text) for p in STOP_PATTERNS)  # plain-English variants


def has_address(lead: Lead, channel: Channel) -> bool:
    """Does the lead have the contact detail this channel needs?"""
    if channel is Channel.EMAIL:
        return bool(lead.email)  # email needs an address
    return bool(lead.phone)  # SMS and phone both need a number


def in_quiet_hours(now_utc: datetime, tz: str) -> bool:
    """True if 'now' falls outside the allowed sending window in the lead's timezone."""
    local = now_utc.astimezone(ZoneInfo(tz))  # convert server time to lead's local time
    if not WEEKEND_OK and local.weekday() >= 5:  # Saturday=5, Sunday=6
        return True
    return not (QUIET_END <= local.time() < QUIET_START)  # inside 08:00-19:59 is allowed


def next_send_window(now_utc: datetime, tz: str) -> datetime:
    """The earliest UTC moment at or after now_utc that is inside the sending window."""
    zone = ZoneInfo(tz)  # lead's timezone
    candidate = now_utc.astimezone(zone)  # start from the current local time
    for _ in range(8):  # at most a week of days to scan - always finds a slot
        if not in_quiet_hours(candidate.astimezone(ZoneInfo("UTC")), tz):
            return candidate.astimezone(ZoneInfo("UTC"))  # already inside the window
        # Jump to 10:00am local the next eligible day (10am-12pm is a proven response window).
        if candidate.time() < QUIET_END and candidate.weekday() < 5:
            candidate = candidate.replace(hour=10, minute=0, second=0, microsecond=0)  # later today
        else:
            candidate = (candidate + timedelta(days=1)).replace(hour=10, minute=0, second=0, microsecond=0)
    return candidate.astimezone(ZoneInfo("UTC"))  # fallback (unreachable in practice)


def can_send(lead: Lead, channel: Channel, now_utc: datetime, opted_out: bool) -> tuple[bool, str]:
    """Single gate every outbound message passes. Returns (allowed, reason)."""
    if opted_out:  # our own suppression list wins over everything
        return False, "opted_out"
    if lead.dnd:  # GHL Do-Not-Disturb flag
        return False, "dnd"
    if not has_address(lead, channel):  # nothing to send to
        return False, f"missing {channel.value} address"
    if channel is not Channel.EMAIL and in_quiet_hours(now_utc, lead.timezone):  # SMS/calls only
        return False, "quiet_hours"
    return True, "ok"
