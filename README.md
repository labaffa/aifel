# aifel

Web app for browsing CUP procurement data from published JSON snapshots. This
repository contains the application only. Snapshot generation and publication
are managed from the IFEL workspace by `tools/aifel/`.

## Run locally

```bash
uv sync --locked
uv run --locked python server.py
```

Open <http://127.0.0.1:5058>. By default, the app looks for snapshots at
`dati/analisi/cup_procurement_app` in the IFEL workspace. Set
`AIFEL_SNAPSHOT_DIR` to use another directory:

```bash
AIFEL_SNAPSHOT_DIR=/path/to/snapshots/current uv run --locked python server.py
```

For deployment, set `AIFEL_SNAPSHOT_DIR` to the absolute `current` symlink in
the server's data directory. The app needs only Flask and the published JSON
files; it does not need Excel/CSV source files or the IFEL workspace.

The `/api/cups` endpoint lists available CUPs. `/api/cup/<CUP>` returns one
snapshot. The UI has overview and procedure tabs, including source evidence.

See the IFEL workspace documentation at
`docs/18_cup_procurement_pipeline/README.md` for the build and publish steps.
