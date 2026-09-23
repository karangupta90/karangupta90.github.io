"""Core data structures shared by every part of the engagement center.

Everything the system does is expressed with these few objects:
a Concept (your input) becomes a Campaign plan made of Steps,
each Step has competing copy Variants, and Leads are enrolled into it.
"""

from __future__ import annotations  # allow type hints that reference classes defined later

from dataclasses import dataclass, field  # lightweight, typed containers for our records
from enum import Enum  # fixed sets of allowed values (channels, statuses)


class Channel(str, Enum):
    """The three outbound channels v1 supports."""

    SMS = "sms"  # text message sent through GoHighLevel's LC Phone / Twilio number
    EMAIL = "email"  # email sent through GoHighLevel's LC Email / Mailgun
    PHONE = "phone"  # a call: either a task for a human rep or a GHL Voice AI workflow


class EnrollmentStatus(str, Enum):
    """Where a lead is in its journey through a campaign."""

    ACTIVE = "active"  # still receiving scheduled steps
    REPLIED = "replied"  # lead answered - automation pauses and a human takes over
    CONVERTED = "converted"  # lead hit the conversion event (e.g. booked appointment)
    OPTED_OUT = "opted_out"  # lead asked us to stop - never message again
    COMPLETED = "completed"  # every step was sent with no response
    HOLDOUT = "holdout"  # control group: deliberately not messaged, used to measure lift
    HOLDOUT_CONVERTED = "holdout_converted"  # control lead that converted on its own (baseline)


@dataclass
class Variant:
    """One version of the copy for a step. Variants compete against each other."""

    id: str  # stable identifier, e.g. "d0-sms-b"; used as the bandit "arm" key
    body: str  # message text (SMS/email body or phone talk-track), may contain {merge_fields}
    subject: str = ""  # email subject line; empty for SMS and phone
    hook: str = ""  # one-line description of the angle being tested, for reporting
    active: bool = True  # False once the optimizer retires a losing variant


@dataclass
class Step:
    """A single touch in the sequence, e.g. 'Day 3 - phone call'."""

    id: str  # unique within the campaign, e.g. "d3-phone"
    day: int  # days after enrollment when this step becomes due
    channel: Channel  # which channel sends it
    purpose: str  # what this touch is meant to achieve; guides the copywriter
    variants: list[Variant] = field(default_factory=list)  # competing copy options


@dataclass
class Concept:
    """Your input: the idea/strategy for a campaign. Loaded from campaigns/*.yaml."""

    name: str  # human-readable campaign name
    objective: str  # the single action we want the lead to take
    audience_tag: str  # GHL tag that selects which contacts are enrolled
    angle: str  # the core message / reason for reaching out now
    offer: str = ""  # optional incentive
    booking_link: str = ""  # where leads convert (GHL calendar / funnel link)
    conversion_event: str = "appointment_booked"  # webhook event that counts as a win
    channels: list[Channel] = field(default_factory=lambda: list(Channel))  # allowed channels
    variants_per_step: int = 3  # how many copy variants to test per step
    holdout_pct: float = 0.10  # share of leads held back as a control group
    notes: str = ""  # anything else the copywriter should know (objections, context)


@dataclass
class Lead:
    """The slice of a GoHighLevel contact the engine needs."""

    contact_id: str  # GHL contact id - the primary key everywhere
    first_name: str = ""  # used for {first_name} personalisation
    email: str = ""  # required for email steps
    phone: str = ""  # required for SMS and phone steps
    timezone: str = "America/New_York"  # contact's local timezone for quiet hours
    dnd: bool = False  # GHL "Do Not Disturb" flag - if True we never contact
    tags: list[str] = field(default_factory=list)  # GHL tags on the contact
    custom: dict[str, str] = field(default_factory=dict)  # extra merge fields (e.g. service_interest)
