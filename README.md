# aifel

Web app for browsing IFEL projects and CUP procurement data. The default backend
reads curated views in the IFEL PostgreSQL database. This repository contains
the application only; database migrations and ETL live in the IFEL workspace.

## Run locally

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

The IFEL database must have both migrations applied, from the workspace root:

```bash
psql -d ifel -v ON_ERROR_STOP=1 -f database/patch_procurement_v1.sql
psql -d ifel -v ON_ERROR_STOP=1 -f database/patch_aifel_views_v1.sql
```

Projects come from `curato.v_progetti_misura`. Procurement comes from
`curato.v_procurement_latest_run`, `curato.v_procurement_cup_cig`,
`curato.v_procurement_evidence` and `curato.v_procurement_collected_profile`.
Connections use read-only transactions with a consistent snapshot per request.
For deployment, configure a database role with `USAGE` on `curato` and `SELECT`
on these views. The application does not need to import IFEL Python modules.

`/api/cups` lists examples with collected procurement. `/api/cup/<CUP>` also
accepts projects in the IFEL register without a procurement release. Its JSON
contract retains overview, procedure and evidence data, and adds
`collection_status` to distinguish missing collection, empty results, pending
review and available reviewed procedures. Every canonical CLP row is retained
in `project_profile.projects`; procurement linkage remains CUP-level.

A database error returns HTTP 503 without exposing connection details. There
is no automatic fallback to potentially stale snapshots.

Lot amounts come exclusively from the typed numeric database column, including
the expandable tender detail. Raw award/payment text is never used as a lot
amount fallback. Missing or invalidated lot amounts remain unavailable.

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

From the IFEL workspace root:

```bash
uv run --python .venv/bin/python tests/test_aifel_db.py
node --check web/aifel/assets/app.js
```

The database API tests compare collected CIGs, selected procedures, details,
evidence and counts against the published snapshots. They also cover a project
without procurement, invalid and unknown CUPs, explicit snapshot mode and
database failures.
