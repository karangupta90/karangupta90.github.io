"""Brand guard: loads the brand kit, renders messages in the brand's look, and lints copy.

Consistent branding is enforced in code, not left to memory: every message is
rendered through BrandKit and must pass lint() before it can be sent.
"""

from __future__ import annotations  # postpone evaluation of type hints

import html  # escape plain text safely before placing it inside HTML
import re  # regular expressions for simple copy checks
from dataclasses import dataclass  # typed container for the loaded kit
from pathlib import Path  # filesystem paths that work on every OS

import yaml  # parse brand/brand.yaml

from .models import Channel  # channel enum decides which rules apply


@dataclass
class BrandKit:
    """In-memory copy of brand/brand.yaml."""

    raw: dict  # the full parsed YAML, kept so new keys are usable without code changes

    @classmethod
    def load(cls, path: str | Path) -> "BrandKit":
        """Read the YAML file and wrap it."""
        with open(path, encoding="utf-8") as fh:  # open the brand file as UTF-8 text
            return cls(raw=yaml.safe_load(fh))  # safe_load never executes arbitrary YAML tags

    # --- convenience accessors -------------------------------------------------
    @property
    def sms_max(self) -> int:
        return int(self.raw["sms"]["max_chars"])  # maximum SMS length allowed

    @property
    def banned(self) -> list[str]:
        return [p.lower() for p in self.raw.get("banned_phrases", [])]  # lower-case for matching

    def prompt_block(self) -> str:
        """The brand rules formatted for the AI copywriter's system prompt."""
        return yaml.safe_dump(self.raw, sort_keys=True)  # sorted = byte-stable, so prompt caching works

    # --- rendering ------------------------------------------------------------
    def fill(self, text: str, fields: dict[str, str]) -> str:
        """Replace {merge_fields}; unknown fields are left visible so lint() can catch them."""
        merged = {  # brand-level fields every message can use
            "business_name": self.raw["business_name"],
            "sender_name": self.raw["sender_name"],
            "sender_title": self.raw["sender_title"],
            **fields,  # lead/campaign fields override nothing above unless explicitly set
        }
        # Swap each {name} for its value, keep the token when the value is unknown.
        return re.sub(r"\{(\w+)\}", lambda m: str(merged.get(m.group(1), m.group(0))), text)

    def render_sms(self, body: str, fields: dict[str, str], first_touch: bool) -> str:
        """Final SMS text: merge fields plus the opt-out footer on the first message."""
        text = self.fill(body, fields).strip()  # personalise and trim whitespace
        if first_touch:  # carriers and the TCPA expect opt-out language up front
            text = f"{text} {self.raw['sms']['opt_out_footer']}"  # append "Reply STOP to opt out."
        return text

    def render_email_html(self, body: str, fields: dict[str, str]) -> str:
        """Wrap a plain-text email body in the branded, deliberately simple HTML template."""
        e = self.raw["email"]  # email section of the brand kit
        text = self.fill(body, fields)  # personalise
        # Turn blank-line-separated paragraphs into <p> tags, escaping any HTML in the copy.
        paras = "".join(
            f"<p style=\"margin:0 0 14px\">{html.escape(p.strip()).replace(chr(10), '<br>')}</p>"
            for p in text.split("\n\n") if p.strip()
        )
        signature = self.fill(e["signature_html"], fields)  # branded signature block
        return (  # plain, personal-looking layout: old-lead emails convert better when they look 1:1
            f"<div style=\"font-family:{e['font_family']};font-size:15px;line-height:1.5;"
            f"color:#222;max-width:560px\">{paras}{signature}"
            f"<p style=\"margin-top:28px;font-size:12px;color:#888\">{html.escape(e['unsubscribe_text'])}</p></div>"
        )

    # --- linting --------------------------------------------------------------
    def lint(self, channel: Channel, text: str, subject: str = "") -> list[str]:
        """Return a list of brand violations; an empty list means the copy is on-brand."""
        problems: list[str] = []  # collected violations
        low = f"{subject} {text}".lower()  # check subject and body together, case-insensitively
        for phrase in self.banned:  # every banned phrase is a hard fail
            if phrase in low:
                problems.append(f"banned phrase: '{phrase}'")
        if re.search(r"\{\w+\}", text + subject):  # an unfilled {merge_field} would look broken
            problems.append("unfilled merge field")
        if channel is Channel.SMS and len(text) > self.sms_max:  # SMS length budget
            problems.append(f"sms too long ({len(text)}>{self.sms_max})")
        if text.count("!") > 2:  # shouty copy is off-voice
            problems.append("too many exclamation marks")
        if re.search(r"\b[A-Z]{5,}\b", text):  # long ALL-CAPS words read as spam
            problems.append("all-caps word")
        return problems
