"""Serve the AIFEL portal using IFEL PostgreSQL views or explicit snapshots."""

from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any

from flask import Flask, abort, jsonify, send_from_directory, request
import psycopg

import data_repository
import consultation_repository
import procurement_repository
import questions_repository
from amount_utils import enrichment_amounts

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
            collected = data_repository.available_cups(connection)
            question_projects = questions_repository.directory(connection)
            investigations = [{'kind': 'procurement', 'projects': data_repository.collected_cup_summaries(connection, collected)}]
            if question_projects:
                investigations.append({'kind': 'questions', 'projects': question_projects})
            return jsonify(data_repository.public_value({'cups': sorted(set(collected) | {row['cup'] for row in question_projects}),
                            'data_source': 'postgres', 'investigations': investigations}))
    return jsonify({"cups": available_cups(APP_DATA_ROOT.resolve())})


@app.get('/api/publication')
def publication() -> Any:
    if app.config['DATA_BACKEND']=='snapshots':
        return jsonify({'data_source':'snapshots','publication':None})
    with data_repository.connect() as connection:
        return jsonify(data_repository.publication_status(connection))

@app.get("/api/cup/<cup>")
def cup_data(cup: str) -> Any:
    normalized = cup.strip().upper()
    if not CUP_PATTERN.fullmatch(normalized):
        abort(400, description="CUP must contain 15 alphanumeric characters.")
    if app.config['DATA_BACKEND']=='postgres':
        with data_repository.connect() as connection:
            payload = data_repository.cup_payload(connection,normalized)
        if payload is None:
            abort(404,description='No project, collected procurement or question data exists for this CUP.')
        return jsonify(payload)
    data_root = APP_DATA_ROOT.resolve()
    if normalized not in available_cups(data_root):
        abort(404, description="No snapshot exists for this CUP.")
    payload = json.loads((data_root / f"{normalized}.json").read_text(encoding="utf-8"))
    for item in payload.get('cigs',[]):
        item['detail'] = data_repository.normalize_date_fields(item.get('detail') or {})
    details_by_cig = {item['cig']:item.get('detail') or {} for item in payload.get('cigs',[])}
    for item in payload.get('procedures',[]):
        item.update(enrichment_amounts(details_by_cig.get(item['cig'],{})))
    payload = data_repository.normalize_date_fields(payload)
    return jsonify(payload)


@app.get('/api/cup/<cup>/consultation')
def consultation_section(cup: str) -> Any:
    normalized = cup.strip().upper()
    if not CUP_PATTERN.fullmatch(normalized):
        abort(400, description='Invalid CUP.')
    name = request.args.get('section', '')
    clp = request.args.get('clp', '')
    source = request.args.get('source')
    try:
        offset = int(request.args.get('offset', '0'))
        limit = int(request.args.get('limit', '100'))
        if offset < 0 or not 1 <= limit <= 500:
            raise ValueError()
    except ValueError:
        abort(400, description='Invalid pagination.')
    if name not in consultation_repository.PROJECT_SECTIONS and name not in consultation_repository.MEASURE_SECTIONS:
        abort(400, description='Unknown consultation section.')
    if source is not None and (name != 'locations' or source not in ('open_data', 'regis')):
        abort(400, description='Invalid location source.')
    if app.config['DATA_BACKEND'] != 'postgres':
        abort(404, description='Consultation sections are unavailable in this snapshot.')
    with data_repository.connect() as connection:
        if not consultation_repository.available(connection):
            abort(404, description='Consultation data has not been published.')
        payload = consultation_repository.section(connection, normalized, clp, name, offset, limit, source)
    if payload is None:
        abort(404, description='Unknown project key.')
    return jsonify(data_repository.public_value(payload))


@app.get('/api/cup/<cup>/procurement')
def project_procurement(cup: str) -> Any:
    normalized = cup.strip().upper()
    if not CUP_PATTERN.fullmatch(normalized) or 'clp' not in request.args:
        abort(400, description='CUP and CLP are required.')
    if app.config['DATA_BACKEND'] != 'postgres':
        abort(404, description='Consultation data is unavailable.')
    with data_repository.connect() as connection:
        if not consultation_repository.available(connection):
            abort(404, description='Consultation data has not been published.')
        payload = procurement_repository.payload(connection, normalized, request.args['clp'])
    if payload is None:
        abort(404, description='Unknown project key.')
    return jsonify(data_repository.public_value(payload))


@app.get('/api/cup/<cup>/questions')
def cup_questions(cup: str) -> Any:
    normalized = cup.strip().upper()
    if not CUP_PATTERN.fullmatch(normalized):
        abort(400, description='Invalid CUP.')
    if 'clp' in request.args:
        abort(400, description='Questions have CUP-level scope.')
    try:
        offset = int(request.args.get('offset', '0'))
        limit = int(request.args.get('limit', '25'))
        if offset < 0 or not 1 <= limit <= 100:
            raise ValueError()
    except ValueError:
        abort(400, description='Invalid question pagination.')
    if app.config['DATA_BACKEND'] != 'postgres':
        return jsonify({'available': False, 'level': 'cup', 'cup': normalized,
                        'rows': [], 'total': 0, 'offset': offset, 'limit': limit})
    with data_repository.connect() as connection:
        payload = questions_repository.page(connection, normalized, offset, limit)
    return jsonify(data_repository.public_value(payload))


@app.get('/api/questions')
def questions_archive() -> Any:
    period = request.args.get('period', 'future')
    search = request.args.get('search', '').strip()
    try:
        offset = int(request.args.get('offset', '0'))
        limit = int(request.args.get('limit', '25'))
        if offset < 0 or not 1 <= limit <= 100 or len(search) > 200:
            raise ValueError()
        if period not in ('future', 'today', 'week', 'past', 'all') or 'clp' in request.args:
            raise ValueError()
    except ValueError:
        abort(400, description='Invalid question archive filters.')
    if app.config['DATA_BACKEND'] != 'postgres':
        return jsonify({'available': False, 'rows': [], 'total': 0, 'offset': offset,
                        'limit': limit, 'period': period, 'timezone': 'Europe/Rome'})
    with data_repository.connect() as connection:
        payload = questions_repository.archive_page(connection, period, search, offset, limit)
    return jsonify(data_repository.public_value(payload))


@app.errorhandler(psycopg.Error)
def database_error(error: psycopg.Error) -> Any:
    app.logger.error('Database request failed (%s).',type(error).__name__)
    return jsonify({'error':'Data service is temporarily unavailable.'}),503

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5058, debug=False)
