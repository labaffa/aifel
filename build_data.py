"""Build one app-ready JSON snapshot per CUP from existing procurement exports."""

from __future__ import annotations

import argparse
import json
from datetime import UTC, datetime

from server import APP_DATA_ROOT, DATA_ROOT, ROOT, sergio_procedures, sergio_workbook


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cup", help="Build only this CUP; default: all available pipeline exports.")
    args = parser.parse_args()
    sources = sorted(DATA_ROOT.glob("*/cup_procurement.json"))
    if args.cup:
        sources = [path for path in sources if path.parent.name == args.cup.strip().upper()]
        if not sources:
            parser.error("No pipeline export found for the requested CUP.")
    APP_DATA_ROOT.mkdir(parents=True, exist_ok=True)

    for source in sources:
        cup = source.parent.name
        payload = json.loads(source.read_text(encoding="utf-8"))
        if payload.get("cup") != cup:
            raise ValueError(f"CUP mismatch in {source.relative_to(ROOT)}")
        procedures, procedures_available = sergio_procedures(cup, payload)
        cigs = {str(item.get("cig", "")).strip().upper() for item in payload.get("cigs", [])}
        procedure_cigs = [str(item.get("cig", "")).strip().upper() for item in procedures]
        if len(procedure_cigs) != len(set(procedure_cigs)):
            raise ValueError(f"Duplicate procedure CIG in {cup}")
        if unknown := set(procedure_cigs) - cigs:
            raise ValueError(f"Procedure CIG absent from pipeline export for {cup}: {sorted(unknown)}")

        payload["procedures"] = procedures
        payload["procedures_available"] = procedures_available
        for item in payload.get("cigs", []):
            item["procedure_in_app"] = str(item.get("cig", "")).strip().upper() in procedure_cigs
        workbook = sergio_workbook(cup)
        payload["app_snapshot"] = {
            "schema_version": "cup_procurement_app_v1",
            "generated_at_utc": datetime.now(UTC).isoformat(),
            "pipeline_export": source.relative_to(ROOT).as_posix(),
            "procedure_source": workbook.relative_to(ROOT).as_posix() if workbook else None,
            "procedure_count": len(procedures),
        }
        destination = APP_DATA_ROOT / f"{cup}.json"
        temporary = destination.with_suffix(".json.tmp")
        temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        temporary.replace(destination)
        print(f"{destination.relative_to(ROOT)}: {len(cigs)} CIG, {len(procedures)} procedures")


if __name__ == "__main__":
    main()
