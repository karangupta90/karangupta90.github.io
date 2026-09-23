"""Command-line entry point.

    python -m engagement.cli plan    campaigns/old-lead-reactivation.yaml   # concept -> reviewed plan
    python -m engagement.cli enroll  campaigns/<slug>.plan.yaml            # pull leads from GHL
    python -m engagement.cli run     campaigns/<slug>.plan.yaml            # one send tick (cron it)
    python -m engagement.cli evolve  campaigns/<slug>.plan.yaml            # retire losers, add challengers
    python -m engagement.cli report  campaigns/<slug>.plan.yaml            # funnel, lift, A/B results
    python -m engagement.cli serve                                         # webhook server
"""

from __future__ import annotations  # postpone evaluation of type hints

import argparse  # parse sub-commands
import sys  # exit codes
from pathlib import Path  # file paths

from .brand import BrandKit
from .config import Settings
from .ghl import GHLClient
from .models import EnrollmentStatus as S
from .optimizer import prob_best
from .orchestrator import enroll, evolve, tick
from .planner import draft_plan, load_concept, load_plan, save_plan, slugify
from .store import Store, utcnow


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="engagement")
    ap.add_argument("command", choices=["plan", "enroll", "run", "evolve", "report", "serve"])
    ap.add_argument("path", nargs="?", help="concept or plan YAML")
    ap.add_argument("--auto-approve", action="store_true", help="evolve: activate challengers immediately")
    args = ap.parse_args(argv)

    cfg = Settings.from_env()  # env vars -> settings
    brand = BrandKit.load(cfg.brand_path)  # the brand kit every message must follow
    Path(cfg.db_path).parent.mkdir(parents=True, exist_ok=True)  # make sure data/ exists
    store = Store(cfg.db_path)
    ghl = GHLClient(cfg.ghl_token, cfg.ghl_location_id, dry_run=cfg.dry_run)

    if args.command == "serve":
        import uvicorn  # imported lazily: only the server needs it
        from .webhooks import create_app
        uvicorn.run(create_app(store, ghl, cfg.webhook_token), host="0.0.0.0", port=8000)
        return 0

    if args.command == "plan":  # concept -> AI-drafted, human-reviewable plan
        from .copywriter import Copywriter  # imported lazily: only planning calls Claude
        concept = load_concept(args.path)
        steps = draft_plan(concept, Copywriter(brand))
        out = Path(args.path).parent / f"{slugify(concept.name)}.plan.yaml"
        save_plan(out, concept, steps)
        print(f"Plan written to {out}. Review every message, then set 'approved: true'.")
        return 0

    concept, steps, approved = load_plan(args.path)  # every other command works on a plan
    slug = slugify(concept.name)

    if args.command == "enroll":
        print(enroll(slug, concept, ghl, store))
    elif args.command == "run":
        if not approved:  # hard stop: nothing reaches customers without human sign-off
            print("Plan is not approved. Set 'approved: true' in the plan file first.")
            return 1
        print(tick(slug, concept, steps, ghl, store, brand, utcnow(), cfg.phone_mode,
                   cfg.voice_workflow_id, cfg.email_from))
        if cfg.dry_run:
            print("(dry run - nothing was actually sent; set DRY_RUN=false to go live)")
    elif args.command == "evolve":
        from .copywriter import Copywriter
        changes = evolve(slug, concept, steps, store, Copywriter(brand), args.auto_approve)
        save_plan(args.path, concept, steps, approved)  # keep the approval state
        print("\n".join(changes) or "No clear losers yet - keep collecting data.")
    elif args.command == "report":
        f = store.funnel(slug)
        treated = sum(f.get(s.value, 0) for s in (S.ACTIVE, S.REPLIED, S.CONVERTED, S.COMPLETED, S.OPTED_OUT))
        control = f.get(S.HOLDOUT.value, 0) + f.get(S.HOLDOUT_CONVERTED.value, 0)
        t_rate = f.get(S.CONVERTED.value, 0) / treated if treated else 0.0
        c_rate = f.get(S.HOLDOUT_CONVERTED.value, 0) / control if control else 0.0
        print(f"Funnel: {f}")
        print(f"Conversion: campaign {t_rate:.1%} vs holdout {c_rate:.1%} -> lift {t_rate - c_rate:+.1%}")
        for step in steps:
            arms = store.arm_stats(slug, step.id, [v.id for v in step.variants if v.active])
            pb = prob_best(arms) if arms else {}
            print(f"\n{step.id}")
            for a in arms:
                print(f"  {a.variant_id:<14} sends={a.sends:<5} responses={a.successes:<4} "
                      f"rate={a.rate:.1%}  P(best)={pb.get(a.variant_id, 0):.0%}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
