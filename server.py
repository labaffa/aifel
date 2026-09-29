"""Serve the AIFEL portal and published CUP snapshots."""

from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any

from flask import Flask, abort, jsonify, send_from_directory

DEFAULT_SNAPSHOT_DIR = Path(__file__).resolve().parents[2] / "dati" / "analisi" / "cup_procurement_app"
APP_DATA_ROOT = Path(os.environ.get("AIFEL_SNAPSHOT_DIR", DEFAULT_SNAPSHOT_DIR))
WEB_ROOT = Path(__file__).resolve().parent
CUP_PATTERN = re.compile(r"^[A-Z0-9]{15}$")
app = Flask(__name__, static_folder=None)


def available_cups(data_root: Path) -> list[str]:
    return sorted(path.stem for path in data_root.glob("*.json") if CUP_PATTERN.fullmatch(path.stem))


@app.get("/")
def index() -> Any:
    return send_from_directory(WEB_ROOT, "index.html")

@app.get("/assets/<path:filename>")
def assets(filename: str) -> Any:
    return send_from_directory(WEB_ROOT / "assets", filename)

@app.get("/api/cups")
def cups() -> Any:
    return jsonify({"cups": available_cups(APP_DATA_ROOT.resolve())})

@app.get("/api/cup/<cup>")
def cup_data(cup: str) -> Any:
    normalized = cup.strip().upper()
    if not CUP_PATTERN.fullmatch(normalized):
        abort(400, description="Il CUP deve contenere 15 caratteri alfanumerici.")
    data_root = APP_DATA_ROOT.resolve()
    if normalized not in available_cups(data_root):
        abort(404, description="Non ci sono dati locali per questo CUP.")
    payload = json.loads((data_root / f"{normalized}.json").read_text(encoding="utf-8"))
    return jsonify(payload)

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5058, debug=False)
