"""Read AIFEL data from IFEL curated views without importing workspace modules."""

from __future__ import annotations

from collections import Counter
from contextlib import contextmanager
from datetime import date, datetime
from decimal import Decimal
import os
import re
import unicodedata
from typing import Any, Iterator

import psycopg
from psycopg.rows import dict_row
from date_utils import iso_date, normalize_date_fields
from amount_utils import enrichment_amounts
import consultation_repository
import questions_repository
import referents_repository

INVALID_DETAIL_URL = re.compile(r'^https://dati\.anticorruzione\.it/superset/dashboard/dettaglio_cig/',re.I)
LOCAL_PATH = re.compile(r'^(?:/|\\\\|[A-Za-z]:[\\/]|file://|\.{1,2}/|dati/)',re.I)
IDENTIFIER_FIELDS = {'cup','cig','clp','codice_locale_progetto','codice locale progetto','phase_value'}
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
                and not (key.lower() not in IDENTIFIER_FIELDS and isinstance(item,str) and LOCAL_PATH.match(item))}
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


def collected_cup_summaries(connection: psycopg.Connection, cups: list[str]) -> list[dict]:
    """Describe collected CUPs without retrieving procurement details per CUP."""
    summaries = {cup: {'cup': cup, 'titles': [], 'municipalities': []} for cup in cups}
    if not cups:
        return []
    current = consultation_repository.available(connection)
    if current:
        rows = connection.execute('''SELECT cup,titolo_progetto FROM curato.v_aifel_progetti
            WHERE cup=ANY(%s) ORDER BY cup,codice_locale_progetto''', (cups,)).fetchall()
        locations = connection.execute('''SELECT DISTINCT cup,descrizione_comune AS municipality
            FROM curato.v_aifel_localizzazioni WHERE cup=ANY(%s) AND source='open_data'
            AND nullif(btrim(descrizione_comune),'') IS NOT NULL ORDER BY cup,municipality''', (cups,)).fetchall()
    else:
        rows = connection.execute('''SELECT cup,titolo_progetto,comuni FROM curato.v_progetti_misura
            WHERE cup=ANY(%s) ORDER BY cup,codice_locale_progetto''', (cups,)).fetchall()
        locations = [{'cup': row['cup'], 'municipality': row['comuni']} for row in rows if row.get('comuni')]
    for row in rows:
        title = value_text(row.get('titolo_progetto'))
        if title and title not in summaries[row['cup']]['titles']:
            summaries[row['cup']]['titles'].append(title)
    for row in locations:
        municipality = value_text(row['municipality'])
        if municipality and municipality not in summaries[row['cup']]['municipalities']:
            summaries[row['cup']]['municipalities'].append(municipality)
    return public_value(list(summaries.values()))


SEARCH_TABLE = 'curato.ricerca_progetti'
SEARCH_VALUES_TABLE = 'curato.ricerca_valori'
SEARCH_MIN_LENGTH = 3
SEARCH_LIMIT = 25
SEARCH_MAX_LIMIT = 100
SEARCH_MAX_WORDS = 6
SEARCH_SUGGEST_LIMIT = 10
SEARCH_VALUE_FIELDS = {
    'comune': ('curato.v_aifel_localizzazioni', 'descrizione_comune'),
    'ente': ('curato.v_aifel_soggetti_attuatori', 'denominazione'),
}


def search_available(connection: psycopg.Connection) -> bool:
    """The search tables are publication artifacts and may be absent."""
    return connection.execute(
        'SELECT to_regclass(%s) IS NOT NULL AND to_regclass(%s) IS NOT NULL AS available',
        (SEARCH_TABLE, SEARCH_VALUES_TABLE)).fetchone()['available']


def search_text(value: str) -> str:
    """Upper-case and strip diacritics, mirroring curato.norm() in the database."""
    decomposed = unicodedata.normalize('NFKD', value or '')
    return ''.join(char for char in decomposed if not unicodedata.combining(char)).upper()


def like_pattern(value: str) -> str:
    escaped = search_text(value).strip().replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')
    return '%' + escaped + '%'


def search_patterns(query: str) -> list[str]:
    words = [word for word in re.split(r'\s+', query.strip()) if word]
    return [like_pattern(word) for word in words[:SEARCH_MAX_WORDS]]


def search_conditions(q: str = '', titolo: str = '', comune: str = '',
                      ente: str = '', misura: str = '') -> tuple[list[str], list]:
    """Combine the free-text box with the per-field filters using AND."""
    conditions: list[str] = []
    params: list = []
    for column, value in (('testo', q), ('testo_titolo', titolo)):
        for pattern in search_patterns(value):
            conditions.append(f'{column} LIKE %s')
            params.append(pattern)
    for field, value in (('comune', comune), ('ente', ente)):
        if value.strip():
            table, column = SEARCH_VALUE_FIELDS[field]
            conditions.append(f'''(cup,codice_locale_progetto) IN
                (SELECT cup,codice_locale_progetto FROM {table} WHERE btrim({column}) = %s)''')
            params.append(value.strip())
    if misura.strip():
        conditions.append('(btrim(id_misura) = %s OR btrim(descrizione_misura) = %s)')
        params.extend([misura.strip(), misura.strip()])
    return conditions, params


def search_projects(connection: psycopg.Connection, q: str = '', titolo: str = '',
                    comune: str = '', ente: str = '', misura: str = '',
                    limit: int = SEARCH_LIMIT, offset: int = 0, cups: list[str] | None = None) -> dict:
    """Free-text and per-field search with a total count for paging."""
    conditions, params = search_conditions(q, titolo, comune, ente, misura)
    if cups is not None:
        conditions.append('cup = ANY(%s)')
        params.append(cups)
    if not conditions:
        return {'total': 0, 'results': []}
    where = ' AND '.join(conditions)
    total = connection.execute(
        f'SELECT count(*) AS found FROM {SEARCH_TABLE} WHERE {where}', params).fetchone()['found']
    patterns = search_patterns(q) or search_patterns(titolo)
    if patterns:
        ordering = ("ORDER BY (coalesce(curato.norm(titolo_progetto),'') LIKE %s) DESC,"
                    " CASE WHEN coalesce(curato.norm(titolo_progetto),'') LIKE %s"
                    " THEN length(coalesce(titolo_progetto,'')) END,"
                    " nullif(titolo_progetto,'') NULLS LAST, cup, codice_locale_progetto")
        order_params = patterns[:1] * 2
    else:
        ordering = 'ORDER BY nullif(titolo_progetto,\'\') NULLS LAST, cup, codice_locale_progetto'
        order_params = []
    rows = connection.execute(
        f'''SELECT cup,codice_locale_progetto,titolo_progetto,id_misura,descrizione_misura,comuni,attuatori
            FROM {SEARCH_TABLE} WHERE {where} {ordering} LIMIT %s OFFSET %s''',
        [*params, *order_params, limit, offset]).fetchall()
    return {'total': total, 'results': public_value([dict(row) for row in rows])}


def search_suggestions(connection: psycopg.Connection, field: str, query: str = '',
                       limit: int = SEARCH_SUGGEST_LIMIT) -> list[dict]:
    """Autocomplete values for the filters, prefix matches first."""
    if field not in ('comune', 'ente', 'misura'):
        raise ValueError('unknown suggestion field')
    patterns = search_patterns(query)
    prefix = search_text(query).replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')
    if field == 'misura':
        conditions = ''.join(" AND curato.norm(coalesce(id_misura, '') || ' ' || coalesce(descrizione_misura, '')) LIKE %s" for _ in patterns)
        rows = connection.execute(
            f'''SELECT coalesce(nullif(btrim(id_misura), ''), btrim(descrizione_misura)) AS valore,
                CASE WHEN nullif(btrim(id_misura), '') IS NULL THEN btrim(descrizione_misura)
                     ELSE btrim(id_misura) || ' · ' || btrim(descrizione_misura) END AS label,
                count(*) AS progetti
                FROM {SEARCH_TABLE}
                WHERE nullif(btrim(descrizione_misura), '') IS NOT NULL {conditions}
                GROUP BY 1,2 ORDER BY (curato.norm(coalesce(nullif(btrim(id_misura), ''), btrim(descrizione_misura))) LIKE %s) DESC,
                progetti DESC, label LIMIT %s''',
            (*patterns, f'{prefix}%', limit)).fetchall()
        return public_value([dict(row) for row in rows])
    conditions = ''.join(' AND valore_norm LIKE %s' for _ in patterns)
    rows = connection.execute(
        f'''SELECT valore, progetti FROM {SEARCH_VALUES_TABLE}
            WHERE campo = %s{conditions}
            ORDER BY (valore_norm LIKE %s) DESC, progetti DESC, valore
            LIMIT %s''',
        (field, *patterns, f'{prefix}%', limit)).fetchall()
    return public_value([dict(row) for row in rows])


def publication_status(connection: psycopg.Connection) -> dict:
    marker = connection.execute("SELECT to_regclass('curato.aifel_publication') AS marker").fetchone()
    if marker['marker'] is None:
        return {'data_source':'postgres','publication':None}
    row = connection.execute('''SELECT version,content_sha256,published_at,manifest
        FROM curato.aifel_publication WHERE singleton''').fetchone()
    return public_value({'data_source':'postgres','publication':row})


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
            **enrichment_amounts(detail),
            'provenance':provenance(evidence),'evidence_sources':evidence}


def cup_payload(connection: psycopg.Connection,cup: str, *, include_consultation: bool = True) -> dict | None:
    consultation_rows = (consultation_repository.projects(connection,cup)
                         if include_consultation and consultation_repository.available(connection) else None)
    if consultation_rows is None:
        rows = connection.execute('''SELECT * FROM curato.v_progetti_misura
            WHERE cup=%s ORDER BY codice_locale_progetto''',(cup,)).fetchall()
    else:
        rows = [{**row, 'titolo_misura':row['descrizione_misura'], 'codice_misura':row['id_misura'],
                 'fase_iter_corrente':row['descrizione_fase_iter_progetto'],
                 'stato_fase_iter_corrente':row['stato_fase_iter_progetto']} for row in consultation_rows]
    run = connection.execute('SELECT * FROM curato.v_procurement_latest_run WHERE cup=%s',(cup,)).fetchone()
    question_count = questions_repository.count(connection, cup)
    referents = referents_repository.summary(connection, cup) if include_consultation else None
    if not rows and run is None and not question_count and not referents:
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
    if consultation_rows is not None:
        payload['consultation'] = consultation_repository.summary(connection,cup,consultation_rows)
    if question_count:
        payload['questions'] = {'available': True, 'total': question_count, 'level': 'cup'}
    if referents:
        payload['referents'] = referents
    return public_value(payload)
