# aifel

The shared question card includes a read-only AI answer panel in
`assets/question-answer.js`. Question lists supply `answer_summary`; opening a
panel calls `/api/questions/<id>/answer` through `answers_repository.py`. Both
read the optional `answer_snapshot` column in the published question archive.
Deploy the backend module, routes and frontend assets together, and publish the
updated question component before enabling answers. Older publications remain
usable. All drafts retain pending expert review; the app does not generate or
approve them. The earlier standalone preview remains available through
`tools/aifel/preview_question_answers.py --serve` in the IFEL workspace.

Web app for browsing IFEL projects and CUP procurement data. The default backend
reads curated views in the IFEL PostgreSQL database. This repository contains
the application only; database migrations and ETL live in the IFEL workspace.

## Run locally

For the separate local consultation database, run from the IFEL workspace root:

```bash
uv run --python .venv/bin/python tools/aifel/run_local_app.py
```

The launcher selects `aifel_local` and requires a publication already loaded by
pipeline 2. The full publication contract is documented in
`docs/19_aifel_web_app/curated_publication.md` in the IFEL workspace.

From this application's directory:

```bash
uv sync --locked
PGDATABASE=ifel uv run --locked python server.py
```

Open <http://127.0.0.1:5058>. The application defaults to database `ifel` and
uses standard libpq configuration (`PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`,
`PGDATABASE`, service files and password files). A connection URL can be supplied
through `AIFEL_DATABASE_URL`, or `DATABASE_URL` as a fallback. Keep credentials
in the process environment or a password file, outside the repository.

For direct access to the full IFEL database, apply the workspace migrations:

```bash
psql -d ifel -v ON_ERROR_STOP=1 -f database/patch_procurement_v1.sql
psql -d ifel -v ON_ERROR_STOP=1 -f database/patch_aifel_views_v1.sql
psql -d ifel -v ON_ERROR_STOP=1 -f database/patch_aifel_current_v1.sql
psql -d ifel -v ON_ERROR_STOP=1 -f database/patch_aifel_current_details_v1.sql
```

Current projects come from `curato.v_aifel_progetti`; older v2 databases use
`curato.v_progetti_misura`. Procurement comes from
`curato.v_procurement_latest_run`, `curato.v_procurement_cup_cig`,
`curato.v_procurement_evidence` and `curato.v_procurement_collected_profile`.
Connections use read-only transactions with a consistent snapshot per request.
For deployment, configure a database role with `USAGE` on `curato` and `SELECT`
on the project, consultation and procurement views. The application does not
need to import IFEL Python modules.

A published consultation database uses physical tables with the same names.
Publication v3 includes every searchable CUP-CLP key ever seen, the latest
available rows per dataset/key, current collected procurement and measure
context. Project sections cover locations, implementing entities, financing
and payments, ReGiS reporting, phases, tenders, awardees, subcontractors and
indicators. A key known only through details has an explicitly incomplete
profile. Project tags, enriched classifications, contacts and questions are
excluded. `/api/publication` exposes release metadata; the application role
also needs `SELECT` on `curato.aifel_publication` to show the publication date.
The full source database has no publication marker and returns null metadata.

Upgrade the application code together with a v3 database publication. The old
managed `v_progetti_misura` table is emptied during the v2-to-v3 upgrade.
The application role needs `SELECT` on every new consultation table; publication
does not assign database grants. Restart the local launcher after updating code.

`/api/cups` lists examples with collected procurement. `/api/cup/<CUP>` also
accepts projects in the IFEL register without a procurement release. Its JSON
contract retains overview, procedure and evidence data, and adds
`collection_status` to distinguish missing collection, empty results, pending
review and available reviewed procedures. Every canonical CLP row is retained
in `project_profile.projects`; procurement linkage remains CUP-level.

The CUP investigation explorer uses one paged table for procurement, questions and
referents. `/api/cups` adds `explorer` metadata with native CLP programme paths.
Filters cover mission, component, measure, submeasure and CUP/title/municipality/
implementer search. Programme filters must match the same CLP. Missing profiles
remain searchable. Investigation badges open the corresponding project section;
explicit CLP and section selections are preserved in URL parameters. Deploy
`investigations_repository.py` and `assets/investigation-explorer.js` with the
updated app, then restart it. No database publication is required.

With v3, the CUP response adds `consultation.projects` with per-CLP section
counts. `GET /api/cup/<CUP>/consultation` takes `clp`, `section`, `offset` and
`limit` query parameters (default 100, maximum 500), and returns rows and total
count. The section whitelist is in `consultation_repository.py`. CLP `/` must
remain intact as a URL-encoded parameter. The overview loads each section on
expansion and offers further pages until all rows are visible. Source dates
belong to the individual dataset; the footer date identifies the publication.
Measure context keeps its native level and is displayed separately.

The interface opens a single CLP directly in seven section tabs. Multiple CLPs
open a CUP summary and independent workspaces; more than five use a searchable
selector and summary cards load twenty at a time. Overview locations show five
records, with a searchable full list on expansion. Optional research components
report their availability independently.

The optional referent component adds `GET /api/cup/<CUP>/referents`, accepting
`clp`, `cig`, `offset` and `limit` (maximum 100 per collection). The Subjects tab
shows reviewed project roles, separately scoped procedure reports and attributed
personal/office/entity contacts with expandable evidence. Historical roles remain
explicit; names do not merge canonical identities. CIG details show only their
linked procedure reports and contacts. The reader requires SELECT on
`curato.v_aifel_referenti`, `curato.v_aifel_referenti_recapiti` and
`curato.v_aifel_approfondimenti_referenti`. Older databases without these optional
tables remain usable. Updated components also appear in the investigation badge
and CUP directory. Restart the application after deploying the new repository
module and frontend assets.

The overview shows separate ReGiS and Open Data phase values, their independent
dates and exact source field names. The preferred fields are the ReGiS Uff.VII
recoding and Open Data project progress state; blank values use the phase
description of the same observation. Sources and missing values stay explicit.
The registry's optional `phase_observations` JSON column carries these values.
Total financing and project payments have separate source dates.
Financial summaries prefer ReGiS and do not replace
missing values with another source. Progress separates planned and actual phase
dates and shows indicator observations with units and periods. Optional missing
fields can be expanded; missing financial amounts and entity names stay explicit.

`GET /api/cup/<CUP>/procurement?clp=...` combines native Open Data tenders with
linked awardees/subcontractors and separately scoped CUP investigation data.
Tenders remain available without investigation. Conflicting or ambiguous
operator links remain unassigned; investigation exclusions remain visible in
a separate group. Source amounts are not overwritten by investigation amounts.
Desktop uses a sortable table, mobile uses expandable cards. Investigation-only
procedures retain CUP scope. No administrative execution control is implemented.

Procurement calendar dates use ISO `YYYY-MM-DD` in the API and `DD/MM/YYYY`
in the interface. ISO timestamps, full Italian month names and explicitly
day-first numeric dates with four-digit years are normalized. Unsupported or
invalid dates become null; `date_validation` preserves original source values
and conversion outcomes. Acquisition timestamps keep their time component.
The IFEL pipeline and loader share `date_utils.py` with the application.
After upgrading date normalization, regenerate curated publications with the
current code before loading them; their checksums include the API response.

A database error returns HTTP 503 without exposing connection details. There
is no automatic fallback to potentially stale snapshots.

Lot amounts come exclusively from the typed numeric database column, including
the expandable tender detail. Raw award/payment text is never used as a lot
amount fallback. Missing or invalidated lot amounts remain unavailable.

The procedure table shows separate lot, awarded and liquidated amount columns.
`procedures[].award_amount` and `liquidated_amount` are nonnegative decimal
strings from the structured enrichment fields; missing or invalid values are
null. Explicit zero is displayed as zero, not as unavailable. Columns sort
independently; mobile cards show the available amounts with separate labels.
No database schema change is required to expose existing enrichment amounts.

## Snapshot backend

To run against published JSON files explicitly:

```bash
AIFEL_DATA_BACKEND=snapshots AIFEL_SNAPSHOT_DIR=/path/to/snapshots/current \
  uv run --locked python server.py
```

Without `AIFEL_SNAPSHOT_DIR`, snapshot mode uses
`dati/analisi/cup_procurement_app` in the IFEL workspace. Snapshot generation
and publication are managed by `tools/aifel/` in that workspace. Existing
snapshot deployments must set `AIFEL_DATA_BACKEND=snapshots` when updating.

## Verification

Outdated question drafts can be opened explicitly with **Mostra bozza precedente**.
The historical panel retains its outdated/pending-review status, generation date,
source quotations and source-change reasons. The source publisher must include
the optional historical snapshot; legacy outdated snapshots remain readable
without a historical panel. Lists only transfer historical availability metadata.

The question workspace supports holder administration, native external status
and definitive closure filters alongside period, desk, measures and search.
Administration names come from the published measure context's `administrations`
arrays; the source pipeline must publish this extension to populate the choices.
The demand API accepts `administration`, `external_status` and
`closed=true|false|unknown`. A blank administration/status selects missing data.
Explicit cancellation status filters override the default upcoming exclusion.

From the IFEL workspace root:

```bash
uv run --python .venv/bin/python tests/test_aifel_db.py
uv run --python .venv/bin/python tests/test_aifel_consultation_api.py
node --check web/aifel/assets/app.js
node --check web/aifel/assets/consultation.js
```

The database API tests compare collected CIGs, selected procedures, details,
evidence and counts against the published snapshots. They also cover a project
without procurement, invalid and unknown CUPs, explicit snapshot mode and
database failures.
