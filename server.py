"""Serve the local IFEL portal and existing CUP procurement exports."""

from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any

import pandas as pd
from flask import Flask, abort, jsonify, send_from_directory

ROOT = Path(os.environ.get("AIFEL_WORKSPACE_ROOT", Path(__file__).resolve().parents[2])).resolve()
DATA_ROOT = ROOT / "dati" / "analisi" / "cup_procurement_superset_browser_2026-09-24"
APP_DATA_ROOT = ROOT / "dati" / "analisi" / "cup_procurement_app"
WEB_ROOT = Path(__file__).resolve().parent
SERGIO_ROOT = ROOT / "dati" / "analisi" / "cup_cig_sergio" / "sergio_integrati"
CUP_PATTERN = re.compile(r"^[A-Z0-9]{15}$")
INVALID_SUPERSET_DETAIL = re.compile(
    r"^https://dati\.anticorruzione\.it/superset/dashboard/dettaglio_cig/",
    re.IGNORECASE,
)
app = Flask(__name__, static_folder=None)


def available_cups() -> list[str]:
    return sorted(path.stem for path in APP_DATA_ROOT.glob("*.json") if CUP_PATTERN.fullmatch(path.stem))


def sergio_workbook(cup: str) -> Path | None:
    matches = sorted(path for path in SERGIO_ROOT.glob("*.xlsx") if cup in path.name.upper())
    return matches[0] if matches else None


def sergio_procedures(cup: str, payload: dict[str, Any]) -> tuple[list[dict[str, Any]], bool]:
    workbook_path = sergio_workbook(cup)
    if workbook_path is None:
        return [], False

    frame = pd.read_excel(workbook_path, sheet_name="Dati ANAC", dtype=str, keep_default_na=False)
    columns = {str(column).strip().casefold(): str(column) for column in frame.columns}
    amount_column = next(
        (str(column) for column in frame.columns if str(column).strip().casefold().startswith("importo lotto")),
        "",
    )
    source_column = columns.get("url fonte principale", "")
    pipeline_records = {
        str(item.get("cig", "")).strip().upper(): item
        for item in payload.get("cigs", [])
        if isinstance(item, dict)
    }
    evidence_path = DATA_ROOT / cup / "cig_universe" / "cig_cup_evidence_unified.csv"
    records_path = DATA_ROOT / cup / "normalized" / "cig_records.csv"
    record_sources: dict[str, str] = {}
    if records_path.is_file():
        records = pd.read_csv(records_path, usecols=["record_id", "source"], dtype=str, keep_default_na=False)
        record_sources = dict(zip(records["record_id"], records["source"]))
    evidence_by_cig: dict[str, list[dict[str, str]]] = {}
    if evidence_path.is_file():
        evidence = pd.read_csv(evidence_path, dtype=str, keep_default_na=False)
        for item in evidence.to_dict(orient="records"):
            evidence_cig = str(item.get("cig", "")).strip().upper()
            if evidence_cig:
                record_id = str(item.get("evidence_record_id", "")).strip()
                evidence_url = str(item.get("evidence_url", "")).strip()
                evidence_by_cig.setdefault(evidence_cig, []).append({
                    "source": str(item.get("evidence_source", "")).strip(),
                    "origin_source": record_sources.get(record_id, ""),
                    "record_id": record_id,
                    "url": "" if INVALID_SUPERSET_DETAIL.match(evidence_url) else evidence_url,
                    "relation": str(item.get("relation_type", "")).strip(),
                    "text": str(item.get("evidence_text", "")).strip(),
                    "notes": str(item.get("notes", "")).strip(),
                })
    rows: list[dict[str, Any]] = []
    for row in frame.to_dict(orient="records"):
        row_cup = str(row.get(columns.get("cup", ""), "")).strip().upper()
        if row_cup and row_cup != cup:
            continue
        cig = str(row.get(columns.get("cig", ""), "")).strip()
        pipeline_record = pipeline_records.get(cig.upper(), {})
        detail = pipeline_record.get("detail", {})
        detail = detail if isinstance(detail, dict) else {}
        smartcig = detail.get("smartcig_like", {})
        smartcig = smartcig if isinstance(smartcig, dict) else {}
        tender = smartcig.get("bando", {}) if isinstance(smartcig, dict) else {}
        publications = smartcig.get("pubblicazioni", {}) if isinstance(smartcig, dict) else {}
        tender = tender if isinstance(tender, dict) else {}
        publications = publications if isinstance(publications, dict) else {}
        rows.append({
            "cup": row_cup or cup,
            "cig": cig,
            "source_url": str(row.get(source_column, "")).strip(),
            "framework_cig": str(row.get(columns.get("cig accordo quadro", ""), "")).strip(),
            "tender_object": str(tender.get("OGGETTO_GARA", "")).strip(),
            "lot_object": str(row.get(columns.get("oggetto lotto", ""), "")).strip(),
            "publication_date": str(publications.get("DATA_PUBBLICAZIONE", "")).strip(),
            "offer_deadline": str(tender.get("DATA_SCADENZA_OFFERTA", "")).strip(),
            "result_communication_date": str(tender.get("DATA_COMUNICAZIONE_ESITO", "")).strip(),
            "amount": str(row.get(amount_column, "")).strip(),
            "provenance": str(row.get(columns.get("provenienza match", ""), "")).strip(),
            "evidence_sources": evidence_by_cig.get(cig.upper(), []),
        })
    return rows, True


@app.get("/")
def index() -> Any:
    return send_from_directory(WEB_ROOT, "index.html")

@app.get("/assets/<path:filename>")
def assets(filename: str) -> Any:
    return send_from_directory(WEB_ROOT / "assets", filename)

@app.get("/api/cups")
def cups() -> Any:
    return jsonify({"cups": available_cups()})

@app.get("/api/cup/<cup>")
def cup_data(cup: str) -> Any:
    normalized = cup.strip().upper()
    if not CUP_PATTERN.fullmatch(normalized):
        abort(400, description="Il CUP deve contenere 15 caratteri alfanumerici.")
    if normalized not in available_cups():
        abort(404, description="Non ci sono dati locali per questo CUP.")
    payload = json.loads((APP_DATA_ROOT / f"{normalized}.json").read_text(encoding="utf-8"))
    return jsonify(payload)

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5058, debug=False)
