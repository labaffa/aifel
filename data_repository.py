"""Read AIFEL data from IFEL curated views without importing workspace modules."""

from __future__ import annotations

from collections import Counter
from contextlib import contextmanager
from datetime import date, datetime
from decimal import Decimal
import os
import re
from typing import Any, Iterator

import psycopg
from psycopg.rows import dict_row
from date_utils import iso_date, normalize_date_fields

INVALID_DETAIL_URL = re.compile(r'^https://dati\.anticorruzione\.it/superset/dashboard/dettaglio_cig/',re.I)
LOCAL_PATH = re.compile(r'^(?:/|\\\\|[A-Za-z]:[\\/]|file://|\.{1,2}/|dati/)',re.I)
PROJECT_FIELDS = {
    'cup': 'CUP', 'codice_locale_progetto': 'Codice Locale Progetto',
    'titolo_progetto': 'Titolo Progetto', 'sintesi_progetto': 'Sintesi Progetto',
    'titolo_misura': 'Descrizione Misura', 'codice_misura': 'Misura',
    'fase_iter_corrente': 'Fase Iter di Progetto', 'stato_fase_iter_corrente': 'Stato Fase',
    'soggetti_attuatori': 'Soggetto Attuatore', 'comuni': 'Descrizione Comune',
    'province': 'Descrizione Provincia', 'regioni': 'Descrizione Regione',
}


def value_text(value: Any) -> str:
    return '' if value is None else str(value).strip()


def public_value(value: Any) -> Any:
    """Keep the public payload free of internal filesystem references."""
    if isinstance(value,dict):
        return {key:public_value(item) for key,item in value.items()
                if key.lower() != 'path' and not key.lower().endswith(('_path','_paths'))
                and not (isinstance(item,str) and LOCAL_PATH.match(item))}
    if isinstance(value,list):
        return [public_value(item) for item in value
                if not (isinstance(item,str) and LOCAL_PATH.match(item))]
    if isinstance(value,(date,datetime)):
        return value.isoformat()
    if isinstance(value,Decimal):
        return str(value)
    return value


@contextmanager
def connect() -> Iterator[psycopg.Connection]:
    """Use libpq configuration and one consistent, read-only request transaction."""
    dsn = os.environ.get('AIFEL_DATABASE_URL') or os.environ.get('DATABASE_URL') or ''
    options = {'row_factory':dict_row,'connect_timeout':5}
    if not dsn and not os.environ.get('PGDATABASE'):
        options['dbname'] = 'ifel'
    with psycopg.connect(dsn,**options) as connection:
        connection.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
        connection.execute("SET LOCAL statement_timeout = '15s'")
        yield connection


def available_cups(connection: psycopg.Connection) -> list[str]:
    """Return examples with collected procurement, not the entire project register."""
    return [row['cup'] for row in connection.execute(
        'SELECT cup FROM curato.v_procurement_latest_run ORDER BY cup')]


def project_profile(cup: str,rows: list[dict],fallback: dict) -> dict:
    if not rows:
        return fallback or {'cup':cup,'project':{'CUP':cup},'projects':[],'regis_row_count':0}
    projects = [{label:row[field] for field,label in PROJECT_FIELDS.items() if row.get(field)} for row in rows]
    # The CUP overview combines values while retaining every canonical CLP row.
    overview = {}
    for label in PROJECT_FIELDS.values():
        values = list(dict.fromkeys(value_text(project[label]) for project in projects if project.get(label)))
        if values:
            overview[label] = ' | '.join(values)
    subjects = sorted({value.strip() for row in rows for value in (row.get('soggetti_attuatori') or '').split(' | ') if value.strip()})
    return {'cup':cup,'regis_row_count':sum(bool(row['in_perimetro_regis']) for row in rows),
            'soggetti_attuatori':subjects,'project':overview,'projects':projects}


def evidence_item(row: dict) -> dict:
    payload = row['payload']
    url = value_text(row['source_url'])
    return {'source':row['source_code'],'origin_source':value_text(row.get('origin_source')),
            'record_id':value_text(row['record_id']),'url':'' if INVALID_DETAIL_URL.match(url) else url,
            'relation':row['relation_type'],'confidence':row['confidence'],
            'text':value_text(row['evidence_text']),'notes':value_text(payload.get('notes'))}


def provenance(evidence: list[dict]) -> str:
    certain = {item['source'] for item in evidence if item['confidence']=='certain'}
    sources = {item['source'] for item in evidence}
    relations = {item['relation'] for item in evidence}
    labels = []
    if certain & {'anac_cup_csv','anac_smartcig','anac_dettaglio_cig_browser'}:
        labels.append('ANAC')
    if 'anac_open_data_gare' in sources:
        labels.append('Italia Domani')
    if relations & {'cup_in_listing_text','source_explicit_cup','saturn_historical_same_record'}:
        labels.append('citazione esplicita')
    if 'semantic_candidate' in relations:
        labels.append('semantico LLM')
    return '; '.join(labels)


def procedure(row: dict,evidence: list[dict]) -> dict:
    detail = row['detail'] or {}
    standard = detail.get('smartcig_like') or {}
    tender = standard.get('bando') or {}
    publications = standard.get('pubblicazioni') or {}
    source = standard.get('source') or {}
    browser = standard.get('browser_detail') or source.get('browser_detail') or detail.get('browser_detail') or {}
    urls = [browser.get('source_url'),source.get('source_url'),row['source_url'],*[item['url'] for item in evidence]]
    url = next((value for value in urls if isinstance(value,str) and value.startswith(('https://','http://'))
                and not INVALID_DETAIL_URL.match(value)), '')
    return {'cup':row['cup'],'cig':row['cig'],'source_url':url,
            'framework_cig':value_text(row['framework_cig']),
            'tender_object':value_text(row['tender_object']),
            'lot_object':value_text(tender.get('OGGETTO_LOTTO')) or value_text(row['tender_object']),
            'publication_date':iso_date(row['publication_date']) or iso_date(publications.get('DATA_PUBBLICAZIONE')),
            'offer_deadline':iso_date(tender.get('DATA_SCADENZA_OFFERTA')),
            'result_communication_date':iso_date(tender.get('DATA_COMUNICAZIONE_ESITO')),
            'amount':value_text(row['amount']),
            'provenance':provenance(evidence),'evidence_sources':evidence}


def cup_payload(connection: psycopg.Connection,cup: str) -> dict | None:
    rows = connection.execute('''SELECT * FROM curato.v_progetti_misura
        WHERE cup=%s ORDER BY codice_locale_progetto''',(cup,)).fetchall()
    run = connection.execute('SELECT * FROM curato.v_procurement_latest_run WHERE cup=%s',(cup,)).fetchone()
    if not rows and run is None:
        return None
    fallback = {}
    # Preserve collected project context for a CUP absent from the project register.
    if not rows and run:
        artifact = connection.execute('''SELECT project_profile AS profile
            FROM curato.v_procurement_collected_profile WHERE run_id=%s''',
            (run['run_id'],)).fetchone()
        fallback = artifact['profile'] if artifact else {}
    profile = project_profile(cup,rows,fallback)
    associations = connection.execute('''SELECT * FROM curato.v_procurement_cup_cig
        WHERE cup=%s ORDER BY cig''',(cup,)).fetchall() if run else []
    # Use the typed lot amount also in the expandable detail. The original JSON
    # is retained in PostgreSQL; it is not a fallback for a missing canonical value.
    for row in associations:
        row['detail'] = normalize_date_fields(row['detail'])
        row['detail']['amount'] = value_text(row['amount']) or None
        standard = row['detail'].get('smartcig_like')
        if isinstance(standard,dict):
            standard.setdefault('bando',{})['IMPORTO_LOTTO'] = value_text(row['amount']) or None
    grouped: dict[str,list] = {}
    if run:
        evidence = connection.execute('''SELECT * FROM curato.v_procurement_evidence
            WHERE run_id=%s AND cup=%s ORDER BY cig,source_code,record_id,evidence_sha256''',
            (run['run_id'],cup)).fetchall()
        for row in evidence:
            grouped.setdefault(row['cig'],[]).append(evidence_item(row))
    procedures = [procedure(row,grouped.get(row['cig'],[])) for row in associations if row['procedure_in_app']]
    reviewed = any(row['review_decision'] in {'included','excluded'} for row in associations)
    pending = any(row['review_decision']=='pending' for row in associations)
    state = ('not_collected' if run is None else 'empty' if not associations else
             'available' if procedures else 'awaiting_review' if pending else 'reviewed_empty')
    confidence = Counter(row['confidence'] for row in associations)
    payload = {'schema_version':'cup_procurement_v1','cup':cup,
        'generated_at_utc':run['generated_at'] if run else None,'project_profile':profile,
        'cigs':[{'cig':row['cig'],'association':row['association'],'detail':row['detail'],
                 'procedure_in_app':row['procedure_in_app']} for row in associations],
        'summary':{'cigs_total':len(associations),
                   'association_confidence':{key:confidence[key] for key in ('certain','high','candidate','review')},
                   'details_downloaded':sum(row['detail'].get('status')=='downloaded' for row in associations)},
        'procedures':procedures,'procedures_available':run is not None and (reviewed or not associations),
        'collection_status':state,'data_source':'postgres',
        'app_snapshot':{'schema_version':'cup_procurement_app_v1','procedure_count':len(procedures),
                        'generated_at_utc':run['loaded_at'] if run else None,
                        'procedure_details_available':sum(row['detail'].get('status')=='downloaded'
                            for row in associations if row['procedure_in_app'])}}
    return public_value(payload)
