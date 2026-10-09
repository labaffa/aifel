"""Combine native CLP tenders with separately scoped CUP investigation data."""

import re

import consultation_repository
import data_repository


def identifier(value, cig=False):
    value = str(value or '').strip()
    if value in {'', '/', '//', 'N/A', 'N/D', '0000000000'}:
        return None
    if cig and not re.fullmatch(r'[A-Z0-9]{10}', value):
        return None
    return value


def operator_matches(operator, tender):
    """Require a native matching key and reject conflicting populated keys."""
    cig = identifier(operator.get('cig'), True)
    pda = identifier(operator.get('codice_interno_pda'))
    tender_cig = identifier(tender.get('cig'), True)
    tender_pda = identifier(tender.get('codice_interno_pda'))
    if cig and tender_cig and cig != tender_cig:
        return False
    if pda and tender_pda and pda != tender_pda:
        return False
    return bool((cig and cig == tender_cig) or (pda and pda == tender_pda))


def combine(tenders, awardees, subcontractors, investigation):
    records = {row['cig']: row for row in investigation.get('cigs', [])}
    procedures = {row['cig']: row for row in investigation.get('procedures', [])
                  if records.get(row['cig'], {}).get('review_decision') != 'excluded'}
    rows = [{**tender, 'awardees': [], 'subcontractors': []} for tender in tenders]
    unresolved = {'awardees': [], 'subcontractors': []}
    for kind, operators in [('awardees', awardees), ('subcontractors', subcontractors)]:
        for operator in operators:
            matches = [row for row in rows if operator_matches(operator, row)]
            if len(matches) == 1:
                matches[0][kind].append(operator)
            else:
                unresolved[kind].append({**operator, 'candidate_tender_count': len(matches)})
    native_cigs = {identifier(row.get('cig'), True) for row in rows}
    for row in rows:
        cig = identifier(row.get('cig'), True)
        record = records.get(cig)
        row['review_decision'] = (record or {}).get('review_decision')
        row['investigation'] = procedures.get(cig)
        row['investigation_record'] = record if row['investigation'] else None
        row['investigation_level'] = 'cup' if row['investigation'] else None
    # Unmatched collected procedures retain CUP scope, including multi-CLP CUPs.
    cup_only = [{'procedure': row, 'record': records.get(row['cig'])}
                for row in procedures.values() if row['cig'] not in native_cigs]
    return {'rows': rows, 'total': len(rows), 'unresolved_operators': unresolved,
            'cup_procedures': cup_only,
            'investigation': {'level': 'cup', 'status': investigation.get('collection_status', 'not_collected'),
                              'date': investigation.get('generated_at_utc')}}


def payload(connection, cup, clp):
    if not consultation_repository.projects(connection, cup, clp):
        return None
    collections = []
    for section in ('tenders', 'awardees', 'subcontractors'):
        table = consultation_repository.PROJECT_SECTIONS[section]
        # Table names come exclusively from the application section whitelist.
        from psycopg import sql
        collections.append(connection.execute(sql.SQL('''SELECT * FROM curato.{}
            WHERE cup=%s AND codice_locale_progetto=%s ORDER BY source,source_dataset,source_row_id''')
            .format(sql.Identifier(table)), (cup, clp)).fetchall())
    investigation = data_repository.cup_payload(connection, cup) or {}
    decisions = {row['cig']: row['review_decision'] for row in connection.execute(
        'SELECT cig,review_decision FROM curato.v_procurement_cup_cig WHERE cup=%s', (cup,))}
    for record in investigation.get('cigs', []):
        record['review_decision'] = decisions.get(record['cig'])
    return combine(*collections, investigation)
