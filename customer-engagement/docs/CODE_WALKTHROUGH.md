# Code walkthrough

Every source file has a comment on each meaningful line explaining what it does.
Read this page first for the big picture of each file, then read the file itself.

## `engagement/models.py`: the vocabulary
- `Channel`: `sms`, `email` or `phone`.
- `EnrollmentStatus`: the states a lead moves through: `active`, then `replied`,
  `converted`, `opted_out` or `completed`. `holdout` and `holdout_converted` are the
  control group.
- `Variant`: one version of copy (`id`, `body`, `subject`, `hook` = the hypothesis it tests,
  `active`).
- `Step`: one touch (`day`, `channel`, `purpose`, `variants`).
- `Concept`: your input file, parsed.
- `Lead`: the GHL contact fields the engine needs (`first_name`, `email`, `phone`, `timezone`,
  `dnd`, custom fields).

## `engagement/brand.py`: consistent branding
- `BrandKit.load()` reads `brand/brand.yaml`.
- `prompt_block()` dumps the kit with sorted keys. The text is byte-identical on every call,
  so Claude's prompt cache can reuse it.
- `fill()` replaces `{merge_fields}`. Unknown fields stay visible on purpose, so the linter
  catches them.
- `render_sms()` adds the opt-out footer to the first SMS only.
- `render_email_html()` escapes the copy and wraps it in a deliberately plain template
  (personal notes beat designed newsletters for old leads). It also adds the signature and
  the unsubscribe line.
- `lint()` returns a list of problems: banned phrases, unfilled fields, SMS length, too many
  "!" and ALL-CAPS words. An empty list means the copy is on-brand.

## `engagement/compliance.py`: the send gate
- `is_opt_out()`: a single-word carrier keyword (STOP, CANCEL…) **or** plain-English phrasing
  ("take me off your list"). "Stop by tomorrow?" is correctly *not* treated as an opt-out.
- `in_quiet_hours()`: converts to the lead's timezone, blocks weekends, and allows only 08:00-19:59.
- `next_send_window()`: finds the next allowed moment, preferring 10am local.
- `can_send()`: one function every message passes. It checks, in order: suppression, DND,
  missing address, then quiet hours (SMS and phone only).

## `engagement/optimizer.py`: continuous testing
- `ArmStats`: sends and successes for one variant.
- `choose()`: Thompson sampling. For each variant, draw a plausible response rate from
  Beta(1+successes, 1+failures) and send the variant with the highest draw. Good variants win
  more often, and uncertain ones still get explored.
- `prob_best()`: runs `choose` 4,000 times to estimate each variant's chance of being the winner.
- `losers()`: once every variant has at least 50 sends, flags any with P(best) under 5%.
- `leader()`: the variant most likely to be best.

## `engagement/store.py`: memory
- Four tables: `enrollments`, `sends`, `suppression` (global do-not-contact) and `events`
  (an audit log).
- `enroll()` uses `INSERT OR IGNORE`, so re-running enrollment never duplicates a lead.
- `attribute_success()` credits the most recent send within 72h when a lead replies or books.
- `arm_stats()` counts a send as a failure only after its 72h window has closed. That's the
  key to fair testing.
- `suppress()` adds the lead to the global list and stops **every** active campaign for them.
- `mark_conversion()` keeps holdout conversions separate so lift can be measured.

## `engagement/ghl.py`: the CRM integration
- `_req()` handles every HTTP call: auth header, the per-endpoint `Version` header, and
  exponential back-off on 429.
- `contacts_with_tag()` pages through `POST /contacts/search`. `_to_lead()` maps GHL's JSON
  onto `Lead`.
- `send_sms()` and `send_email()` go through `/conversations/messages`, so replies land in the
  GHL inbox thread.
- `create_call_task()` (human caller) and `add_to_workflow()` (Voice AI or dialer workflow)
  handle the phone step.
- `add_tags()` and `set_dnd()` mirror state back into GHL so its own workflows react to it.
- `dry_run=True` makes every write a no-op.

## `engagement/copywriter.py`: the AI copywriter
- The system prompt contains the role, the hard rules (never invent offers) and the full brand
  kit. It is marked `cache_control` so repeat calls are cheap.
- `_ask()` calls Claude (`claude-opus-5`) with **structured outputs** (`output_format=DraftSet`),
  so the response is validated JSON, not free text. Adaptive thinking lets it reason about
  angles. `fallbacks: "default"` retries on a fallback model if a safety classifier declines.
  A refusal or empty output raises a clear error.
- `_accept()` runs each draft through the brand linter and drops anything off-brand.
- `write_step()` asks for N variants that test **different hypotheses**, so each test teaches
  something.
- `write_challenger()` shows Claude the winner and the retired losers, then asks for one new
  variant that changes one meaningful thing.

## `engagement/planner.py`: concept to plan
- `DEFAULT_CADENCE`: 9 touches over 21 days (the reasoning is in RESEARCH.md §2).
- `build_steps()` filters the cadence to the channels your concept allows.
- `draft_plan()` asks the copywriter for each step's variants.
- `save_plan()` and `load_plan()` handle the YAML file. `approved` defaults to `false`.

## `engagement/orchestrator.py`: execution
- `in_holdout()` hashes the contact id, so the same lead always lands in the same group.
- `enroll()` pulls leads by tag, skips DND and suppressed contacts, and assigns holdouts.
- `tick()` is explained step by step in its docstring: next step, due?, spacing, compliance,
  bandit pick, render, lint, send, record. A step that can never be sent (no email address)
  is marked skipped so the sequence moves on. A quiet-hours block just retries next tick.
- `evolve()` retires losers and adds challengers. They are inactive until you review them,
  unless you pass `--auto-approve`.

## `engagement/webhooks.py`: closing the loop
- `verify_signature()` checks Ed25519 against HighLevel's published public key.
- Unsigned workflow webhooks must carry `?token=`. The comparison runs in constant time.
- `handle_event()`:
  - `InboundMessage` → opt-out? Suppress, set DND and tag. Otherwise it's a reply: credit the
    variant, pause the lead and tag.
  - `AppointmentCreate`, or `OpportunityStatusUpdate` with status won → a conversion.
  - Every branch is idempotent, because GHL retries deliveries up to 12 times.

## `engagement/cli.py` and `engagement/config.py`
- `config.py` reads settings from environment variables. `DRY_RUN` defaults to **true**.
- `cli.py` provides `plan`, `enroll`, `run`, `evolve`, `report` and `serve`. `run` refuses to
  send while the plan is unapproved. `report` prints the funnel, lift vs. holdout, and
  per-variant P(best).

## `tests/test_engine.py`
Offline tests with a fake GHL and a fake Claude. They cover opt-out wording, quiet hours and
weekends, the brand linter, bandit convergence, full enroll → send → reply → opt-out →
day-1 email flow, holdout isolation, evolve, the plan round-trip, copywriter filtering, and
webhook authentication.
