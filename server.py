"""Serve the AIFEL portal using IFEL PostgreSQL views or explicit snapshots."""

from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any

from flask import Flask, abort, jsonify, send_from_directory
import psycopg

import data_repository

DEFAULT_SNAPSHOT_DIR = Path(__file__).resolve().parents[2] / "dati" / "analisi" / "cup_procurement_app"
APP_DATA_ROOT = Path(os.environ.get("AIFEL_SNAPSHOT_DIR", DEFAULT_SNAPSHOT_DIR))
WEB_ROOT = Path(__file__).resolve().parent
CUP_PATTERN = re.compile(r"^[A-Z0-9]{15}$")
app = Flask(__name__, static_folder=None)
app.config['DATA_BACKEND'] = os.environ.get('AIFEL_DATA_BACKEND','postgres')
if app.config['DATA_BACKEND'] not in {'postgres','snapshots'}:
    raise ValueError('AIFEL_DATA_BACKEND must be postgres or snapshots.')


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
    if app.config['DATA_BACKEND']=='postgres':
        with data_repository.connect() as connection:
            return jsonify({'cups':data_repository.available_cups(connection),'data_source':'postgres'})
    return jsonify({"cups": available_cups(APP_DATA_ROOT.resolve())})

@app.get("/api/cup/<cup>")
def cup_data(cup: str) -> Any:
    normalized = cup.strip().upper()
    if not CUP_PATTERN.fullmatch(normalized):
        abort(400, description="CUP must contain 15 alphanumeric characters.")
    if app.config['DATA_BACKEND']=='postgres':
        with data_repository.connect() as connection:
            payload = data_repository.cup_payload(connection,normalized)
        if payload is None:
            abort(404,description='No project or collected procurement data exists for this CUP.')
        return jsonify(payload)
    data_root = APP_DATA_ROOT.resolve()
    if normalized not in available_cups(data_root):
        abort(404, description="No snapshot exists for this CUP.")
    payload = json.loads((data_root / f"{normalized}.json").read_text(encoding="utf-8"))
    for item in payload.get('cigs',[]):
        item['detail'] = data_repository.normalize_date_fields(item.get('detail') or {})
    payload = data_repository.normalize_date_fields(payload)
    return jsonify(payload)


@app.errorhandler(psycopg.Error)
def database_error(error: psycopg.Error) -> Any:
    app.logger.error('Database request failed (%s).',type(error).__name__)
    return jsonify({'error':'Data service is temporarily unavailable.'}),503

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5058, debug=False)
