# Controlled parser-drift recovery runbook

> Operator runbook for an evidence-first parser contract change. It is deliberately conservative: diagnose, capture a sanitized regression, make the smallest source-specific change, verify, and stop at an approval gate. This document does not authorize a live probe, reparse, deploy, cleanup, push, or PR by itself.

## 1. Non-negotiable boundaries

1. **No guessing location.** Never use `body`, `innerText`, page title, card title, description outside an allowlisted property field, the first matching address, a party address, notification text, or arbitrary JSON/XML text as a property address or region. A missing typed field remains `missing`.
2. **No automatic selector edits.** A drift signal may create an incident and a candidate fixture; it must not rewrite selectors, modify source code, redeploy, reparse, or clean data automatically.
3. **No broad retries.** Use the source adapter's existing bounded behavior only for the controlled run. Do not add loops, parallel fan-out, rotating identities, or repeated live attempts to make a bad run look healthy. A 401/403/429/451, TLS error, CAPTCHA/WAF signal, or repeated timeout is evidence to classify, not a reason for an unbounded retry.
4. **No AI runtime.** Runtime parsing, selector choice, incident classification, fixture sanitization, and recovery must be deterministic code and human-reviewed evidence. AI may not be introduced as a parser fallback or as an unattended repair actor.
5. **No raw secrets or PII.** Do not put tokens, cookies, authorization headers, environment dumps, raw response bodies, names, phone numbers, emails, addresses, tax identifiers, account identifiers, or unredacted logs in an issue, fixture, artifact, commit, or chat. Preserve only synthetic values and the minimum structural evidence.
6. **Preserve unrelated dirty work.** The lead worktree may contain unrelated changes. Do not use destructive reset/clean commands and do not modify files outside the approved ownership area for the current wave.

## 2. Evidence and status vocabulary

The shared location contract is fail-closed:

- `confirmed_address`: an explicit property field yielded a normalized address.
- `confirmed_region_only`: an explicit property-region field exists, but no trusted full address exists.
- `missing`: no trusted property field exists.

Run-scoped persistence has two levels:

- `parser_run.status`: `running`, `cancelling`, `succeeded`, `degraded`, `failed`, `cancelled`.
- `parser_run_source.status`: `queued`, `running`, `success`, `success_empty`, `degraded`, `blocked`, `schema_changed`, `failed`, `cancelled`.
- `parser_run_source.error_class`: `transient`, `rate_limited`, `blocked`, `anti_bot`, `http_block`, `schema_changed`, `permanent`, `cancelled`.
- persisted `error_message` is not free text: it is a bounded controlled code such as `parser.http_block`; raw adapter/queue messages, URLs, response bodies, credentials and stack text are rejected or replaced before persistence.
- `parser_run_source.detail_supported`: immutable adapter capability captured by the worker; listing-only is explicit, never inferred from zero counters.

Use the exact `run_id`, `source_slug`, `stage` (`scan` or `details`), and `identity_key` from the persisted run records. Do not replace them with a timestamp, process name, or an approximate source label.

## 3. Approval gate before any live action

Before opening a live page, starting a parser job, or changing code, record an explicit approval containing:

- source slug and stage;
- exact incident/run ID and reason code;
- read-only diagnosis scope and maximum sample size;
- named operator and independent reviewer;
- whether the approval covers only diagnosis, a canary, a reparse, a deploy, or cleanup.

These are separate approvals. Approval for diagnosis does **not** imply approval for a canary, reparse, deploy, push, PR, or cleanup.

## 4. Exact run-integrity preflight

Perform this sequence in order. It is read-only until a separate approval is granted.

### 4.1 Freeze the identity and local worktree

Set only non-secret identifiers in the shell; do not paste credentials into commands or output:

```sh
export RUN_ID='recorded-run-id'
export SOURCE_SLUG='schema-slug'
export STAGE='scan-or-details'
```

The values above are run identifiers, not credentials. Replace them with the approved record values; never replace a credential placeholder in a command because this runbook contains no credential command.

Confirm the repository state without changing it:

```sh
git status --short --branch
git diff --name-only
git diff --check
git rev-parse HEAD
```

Expected result: the lead's pre-existing dirty files are known, the recovery scope is limited to the approved files, and whitespace errors are absent. If an unrelated file is touched by the recovery, stop and return it to the owning agent; do not stage or reset it.

### 4.2 Validate the source and stage against the contracts

Read the Source schema and the persisted source record. Require all of the following:

- `SOURCE_SLUG` equals the persisted source record's `slug`, and that record's `parser` is one of the adapter identifiers in the Source schema enumeration;
- the parser package and adapter path are known from `services/services.json` or are explicitly marked as an activation discrepancy;
- `STAGE` is exactly `scan` or `details`;
- the persisted source record's `slug` equals `SOURCE_SLUG`;
- the intended contract row in `docs/parser-source-contracts.md` identifies the exact allowlisted address/region fields;
- no operator is treating an `unknown` or `TODO` contract as a confirmed live field.

If the source is `fedresurs`, stop for an activation decision before scheduling work: local seed data, service registration, and operational notes do not currently agree on its active state.

### 4.3 Validate the parent run and source-stage row

Use the read-only administrative view or the verified local database path for the environment. Inspect only the following allowlisted fields from `parser_runs` and `parser_run_sources`:

**Parent run:** `run_id`, `mode`, `trigger`, `profile_scope`, `filter_snapshot_hash`, `filter_snapshot_schema_version`, `status`, `started_at`, `heartbeat_at`, `finished_at`.

**Source-stage row:** `identity_key`, `source_slug`, `stage`, `job_id`, `status`, `listed`, `eligible`, `existing`, `pre_filtered`, `details_attempted`, `details_ok`, `created`, `skipped`, `failed`, `started_at`, `heartbeat_at`, `finished_at`, `error_class`.

Do not export `filter_snapshot` itself, `error_message`, raw payloads, URLs with query strings, or user/profile data. Check these integrity invariants before continuing:

```text
parent.run_id is the requested RUN_ID
source_stage.source_slug is SOURCE_SLUG
source_stage.stage is STAGE
source_stage.identity_key is unique and names this exact run/source/stage
source_stage.job_id is the expected queue job (or is absent before enqueue)
all counters are integers >= 0
created + skipped + failed <= details_attempted when details_attempted is populated
finished_at is set only for a terminal source-stage status
heartbeat_at is current for a running row, or the row is classified stale
```

A duplicate identity key, a running/cancelling parent run when a new run is being requested, a stale heartbeat, a negative/impossible counter, or a source-stage row belonging to another run is a **stop condition**. Mark the evidence as an integrity problem; do not repair by inserting a second row or by re-running the whole source.

### 4.4 Check queue and worker state without exposing environment data

Confirm that no other job owns the same `RUN_ID` + `SOURCE_SLUG` + `STAGE`. If the queue has a duplicate or an active owner, stop. Do not cancel another owner's job without a separate approval.

For PM2, collect only the safe operational fields shown by the process list:

```sh
pm2 list --no-color
```

Record a sanitized table containing only `name`, `status`, `pid`, `uptime`, `restarts`, `cpu`, and `memory`. Do **not** run or attach `pm2 env`, `pm2 report`, an environment dump, command-line arguments, or raw logs. A PM2 process being `online` is not proof that a parser run succeeded; reconcile it with the persisted run and source-stage records.

### 4.5 Capture the preflight result

The evidence bundle may contain:

- `run_id`, source slug, stage, identity key, job ID;
- parent/source-stage statuses and allowlisted counters;
- `error_class` and a short controlled reason code;
- PM2 safe fields listed above;
- current repository commit SHA and exact changed-file list;
- hashes of sanitized fixtures and generated reports.

It must not contain raw logs, raw HTML/JSON/XML, cookies, headers, environment values, raw addresses, or personal/party data.

## 5. Classify the drift before editing

Use the smallest evidence that distinguishes the contract failure:

| signal | classification | immediate action |
|---|---|---|
| Expected allowlisted selector/JSON/XML field is absent for the controlled sample, while the source page/API response is otherwise structurally readable | `schema_changed` candidate | Stop the run; preserve a sanitized shape fixture; do not broaden selectors. |
| Explicit property field exists but is empty or the source returns no eligible records | `success_empty` or `degraded`, depending on counters and contract | Verify filters and source status; do not infer an address from unrelated text. |
| 401/403/429/451, CAPTCHA/WAF/QRator signal, or repeated rate-limit response | `blocked` / `rate_limited` | Stop live attempts; do not bypass or broaden retries. Record only status/reason class. |
| TLS/certificate/connection failure without a parser contract change | `blocked` or `failed` with a transport reason | Stop; do not disable certificate verification. Current source-specific TLS behavior remains `unknown` unless code/docs prove it. |
| Parser process exits or throws without a source-shape signal | `failed` / `permanent` | Preserve only the allowlisted error class and controlled code; debug locally without copying raw stack/error text into persisted telemetry. |
| Counters complete but typed location statuses regress or party-address sentinel appears | `degraded` / `schema_changed` candidate | Treat as a data-integrity failure; never accept a body/title/first-address fallback. |

A broad drop in counts is a signal, not proof of drift. Require a typed field-level mismatch or a deterministic parser failure before changing selectors.

## 6. Sanitized fixture protocol

Create a fixture only after the integrity preflight and only from an approved sample.

1. Keep the DOM/API/XML shape, element names, stable selector attributes, field labels, pagination markers, and the minimum values needed to reproduce the parser decision.
2. Replace every real address, person/company name, phone, email, tax identifier, account identifier, lot/procedure ID, cookie, token, URL query value, and free-text description with deterministic synthetic tokens such as `PROPERTY_ADDRESS_A`, `PARTY_ADDRESS_B`, and `LOT_ID_A`.
3. Preserve adversarial separation: put `PARTY_ADDRESS_B` in the organizer/debtor/pledgee/customer/contact domain and `PROPERTY_ADDRESS_A` only in the allowlisted property field. A correct parser must not mix them.
4. Preserve the absence case: a fixture with only title/body/party geography must produce `missing`.
5. Store the fixture under the owning parser package's existing test fixture area or inline test harness. Do not create a live snapshot or retain raw response material.
6. Record only a fixture ID, source path/selector, sanitizer version or method, and SHA-256. Verify that the sanitized output contains no email, phone, cookie, authorization header, or raw personal address before review.

## 7. RED-GREEN repair loop

### RED: reproduce the contract failure

1. Add or select a source-specific test in the owning parser package.
2. Use a sanitized fixture with one allowlisted property field, one adversarial party field, and one absence case where applicable.
3. Assert the exact `status`, normalized address/region, `source_kind`, and `source_path`; assert that the party sentinel is absent from the result.
4. Run the smallest relevant test before changing production code. The expected RED result must be a deterministic assertion failure or missing-field failure, not an unavailable network.
5. If the test cannot fail for the intended reason, stop and fix the fixture/test harness first; do not change selectors speculatively.

### GREEN: smallest source-specific change

1. Change only the owning adapter's allowlist or typed field mapping justified by the sanitized fixture.
2. Keep address, region, and coordinates separate; preserve `confirmed_region_only` when only an explicit region exists.
3. Keep organizer/debtor/pledgee/customer/contact fields outside the property-location extractor.
4. Do not add `body`, `title`, `innerText`, first-address, generic regex, or arbitrary payload fallback.
5. Do not add AI, auto-selector generation, broad retries, TLS verification bypass, or automatic deployment.
6. Re-run the RED test until it is GREEN, then run the source package's full extraction test and build.

## 8. Full verification before acceptance

Run locally or in the approved test environment; do not start a server or run a live probe as part of this documentation-only recovery step. The repository exposes the following deterministic commands:

```sh
for test_file in \
  services/parser-aggregator-bankrot/src/__tests__/extraction.test.ts \
  services/parser-alfalot/src/__tests__/extraction.test.ts \
  services/parser-etprf/src/__tests__/extraction.test.ts \
  services/parser-m-ets/src/__tests__/extraction.test.ts \
  services/parser-investmoscow/src/__tests__/extraction.test.ts \
  services/parser-invest-mosreg/src/__tests__/extraction.test.ts \
  services/parser-torgi-gov/src/__tests__/extraction.test.ts \
  services/parser-sberbank-ast/src/__tests__/extraction.test.ts \
  services/parser-fabrikant/src/__tests__/extraction.test.ts \
  services/parser-roseltorg/src/__tests__/extraction.test.ts
do
  npm test -- "$test_file"
done
```

`parser-fedresurs` has an offline `src/__tests__/extraction.test.ts` regression that mocks `child_process.execFile` and proves Python-client failure is rethrown instead of returned as an empty successful listing. Then run the repository test suite and builds:

```sh
npm test
npm --prefix api test
npm --prefix api run build
for package in \
  parser-aggregator-bankrot parser-alfalot parser-etprf parser-fabrikant \
  parser-fedresurs parser-invest-mosreg parser-investmoscow parser-m-ets \
  parser-roseltorg parser-sberbank-ast parser-torgi-gov
do
  npm --prefix "services/$package" run build
done
git diff --check
```

Record command, exit code, test count, build result, and sanitized failure class. Do not paste raw logs into the evidence bundle. A failed unrelated test is not a pass; isolate it and obtain reviewer approval before declaring the source repair acceptable.

## 9. Controlled canary and reparse gate

A deployed release registers one hourly orchestrator. It acquires the existing pipeline lifecycle lock and, only at the configured three-hour pre-digest window, fans out exact `operation=probe` jobs for active sources with 1–3 samples. The scheduler, manual admin endpoint, and any release containing them require explicit code/deploy approval before activation; individual recurring cron ticks do not ask for interactive approval.

Canary invariants:

1. Use exact source job IDs and bounded adapter limits; do not wait on unrelated queue state.
2. Do not create/update Property records or launch analyze/digest/reparse.
3. Compare only typed counters, safe reason codes and semantic fingerprints; never persist raw page text, address or URL diagnostics.
4. Stop/classify on `blocked`, `schema_changed`, unexpected party-address contamination or a counter invariant violation. No selector change, retry fan-out, cleanup or deploy is automatic.
5. A successful canary does not authorize a full reparse, cleanup or another deploy. Obtain those approvals separately.
6. `detail_supported=false` is an explicit listing-only contract: a successful bounded listing sample may be `healthy` with `details_attempted=0`; it must not synthesize a failed detail phase. Adapters with a real detail method remain fail-closed: HTTP/navigation/extraction failure is thrown and cannot hydrate stale listing data as a successful detail result.
7. A probe deadline is cooperative: timeout requests cancellation but the queue handler does not report terminal completion before its current bounded adapter operation settles and cleanup runs. The orchestrator waits a bounded cancellation-ack window, then reports a safe degraded outcome without clearing another lifecycle owner.
8. Lifecycle release is owner-checked against the canary `run_id`; an operator reset or newer run cannot be overwritten by stale `finally` cleanup.

Hard source-health states are an execution quarantine, not just alert metadata:

- `schema_changed` and `blocked` sources are excluded from normal pipeline scan selection;
- health is re-read before details enqueue, so quarantine after scan stops normal details work;
- direct manual parse returns conflict without enqueue for a quarantined source;
- the parser worker re-reads the source through the service-token stats alias after scan counter reset immediately before `parser.parse()`, before detail adapter launch/fetch, and again before Property persistence; inactive, unavailable, `null`, absent, malformed and unknown health states fail closed;
- the bounded read-only canary intentionally remains available as the recovery probe;
- healthy/degraded evidence from canary or a stale normal run does not auto-release quarantine. Every health recording first re-reads current state and uses a conditional compare-and-set; current hard/unknown/null state is held (unknown/null is normalized to `blocked`), and a CAS loser cannot annotate the current run row, overwrite quarantine, or emit an alert/recovery. A reviewed operational state change and explicit approval are required before resumed parse/reparse/deploy.

When successful detail extraction still leaves `property_location=missing`, the candidate is not persisted. After terminal telemetry the full scan artifact is removed, while a checksummed `*.location-unresolved.json` manifest remains. It contains only `external_id`, bounded `source_path` and `status=missing`; title, description, address, parties, URL and browser error text are forbidden. Remove these manifests only by a separately approved diagnostic cleanup.

## 10. Independent exact diff and SHA review

The implementer and reviewer must be different people/processes. The reviewer starts from the exact commit SHA named in the handoff and checks the complete diff, not only the changed hunk.

Before handoff, the implementer records:

```sh
git rev-parse HEAD
git status --short --branch
git diff --name-only
git diff --no-ext-diff --unified=0 -- docs/parser-source-contracts.md docs/parser-drift-runbook.md
shasum -a 256 docs/parser-source-contracts.md docs/parser-drift-runbook.md
```

The independent review must:

1. Recompute the commit SHA and both file SHA-256 values from the exact checkout.
2. Inspect `git diff --name-only` and reject any file outside the approved ownership area.
3. Inspect the full exact diff for body/title/first-address fallback, broad retries, TLS bypass, AI runtime, secret/PII material, auto-deploy/cleanup, or unsupported live claims.
4. Check every matrix row against the source adapter/test path and mark unproved claims `unknown`/`TODO`.
5. Confirm `git diff --check`, focused tests, full tests, and builds have real exit-code evidence.
6. Record reviewer identity, reviewed SHA, file hashes, checks performed, and decision: `accept`, `reject`, or `needs-evidence`.

A diff review is not an approval to push, open/update a PR, deploy, reparse, or clean records. Those actions each require explicit approval after the independent review.

## 11. Explicit action approvals

| action | required approval |
|---|---|
| push branch or tags | written approval naming the exact reviewed SHA |
| open/update PR | written approval naming the exact reviewed diff and destination |
| deploy/restart PM2 | written release approval naming artifact/SHA and rollback target |
| full or partial reparse | written run approval naming source, stage, sample/full scope, and `run_id` |
| cleanup/deletion/deduplication | written data-owner approval naming exact rows/scope and retention decision |

No automation may infer any of these approvals from a GREEN test, an `online` PM2 process, or a successful canary.

## 12. Rollback and stop procedure

### Before merge or deploy

- Stop at the current approval gate.
- Preserve the lead's unrelated dirty worktree.
- Revert only the approved recovery files from their recorded pre-change copies, after the owner confirms; do not run `git reset --hard` or `git clean`.
- Re-run focused tests and `git diff --check`; record the resulting exact diff/hash state.

### After a deploy or reparse has been explicitly approved

1. Stop new work for the affected source/stage and prevent a duplicate `identity_key`.
2. Mark the source-stage/run outcome with the appropriate terminal status (`blocked`, `schema_changed`, `failed`, or `cancelled`) and a short safe reason class; do not overwrite history or delete evidence.
3. Roll back to the previously reviewed release artifact or exact previous commit using the repository's approved release procedure. Do not hot-edit selectors on the server and do not disable TLS verification.
4. Verify PM2 only with the safe allowlist (`name`, `status`, `pid`, `uptime`, `restarts`, `cpu`, `memory`) and reconcile with persisted telemetry.
5. Re-run the focused deterministic tests against the rollback artifact. A rollback does not authorize a reparse.
6. Obtain new approval for any resumed canary, reparse, deploy, push/PR, or cleanup.

### Data safety

Do not delete or mass-update listings, source records, parser-run records, fixtures, or evidence as a rollback shortcut. Cleanup is a separate approved operation with a reversible plan and a sanitized before/after count.

## 13. Required handoff record

The final handoff must contain only:

- source slug, stage, incident/run ID, and exact reviewed SHA;
- preflight status and counter summary;
- classification and reason code;
- sanitized fixture ID and SHA-256, if created;
- focused/full test and build exit codes;
- PM2 safe-field snapshot, if a worker was inspected;
- independent reviewer decision;
- explicit approvals still pending.

It must not claim a live verification date, external availability, anti-bot/TLS behavior, or recovery success unless that fact is backed by the corresponding evidence and approval record.
