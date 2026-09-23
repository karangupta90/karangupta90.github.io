"""Settings read from environment variables (see .env.example). Secrets never live in code."""

from __future__ import annotations  # postpone evaluation of type hints

import os  # environment variable access
from dataclasses import dataclass  # typed settings object


@dataclass(frozen=True)  # frozen: settings can't be changed accidentally at runtime
class Settings:
    ghl_token: str  # GoHighLevel Private Integration token or OAuth access token
    ghl_location_id: str  # GHL sub-account (location) id
    webhook_token: str  # shared secret for unsigned GHL workflow webhooks
    phone_mode: str  # "task" = human rep gets a call task, "ai" = GHL Voice AI workflow
    voice_workflow_id: str  # GHL workflow that places the AI call (phone_mode=ai)
    email_from: str  # e.g. "Karan <karan@yourdomain.com>"; blank = GHL location default
    db_path: str  # SQLite file
    brand_path: str  # brand kit YAML
    dry_run: bool  # True = never send anything, just record what would happen

    @classmethod
    def from_env(cls) -> "Settings":
        g = os.environ.get  # shorthand
        return cls(
            ghl_token=g("GHL_TOKEN", ""),
            ghl_location_id=g("GHL_LOCATION_ID", ""),
            webhook_token=g("WEBHOOK_TOKEN", ""),
            phone_mode=g("PHONE_MODE", "task"),
            voice_workflow_id=g("VOICE_WORKFLOW_ID", ""),
            email_from=g("EMAIL_FROM", ""),
            db_path=g("DB_PATH", "data/engagement.db"),
            brand_path=g("BRAND_PATH", "brand/brand.yaml"),
            dry_run=g("DRY_RUN", "true").lower() in {"1", "true", "yes"},  # safe default: dry run ON
        )
