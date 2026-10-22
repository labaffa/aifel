"""Build the shared CUP investigation index, preserving native CLP programme paths."""
import re

import consultation_repository


def programme(row):
    def code(value):
        value = re.sub(r'\s+', '', str(value or '')).upper()
        return None if value in {'', '/', '//', 'N/A', 'N/D', 'NAN', 'NONE', 'NULL'} else value
    measure = code(row.get('measure_code')) or code(row.get('id_misura'))
    submeasure = code(row.get('submeasure_code')) or code(row.get('id_submisura'))
    if submeasure == measure:
        submeasure = None
    match = re.match(r'^(M\d+)(C\d+)', measure or '')
    return {'measure': measure, 'measure_label': row.get('descrizione_misura') or measure,
        'submeasure': submeasure,
        'submeasure_label': row.get('descrizione_submisura') if submeasure else None,
        'mission': match[1] if match else None,
        'component': match[1] + match[2] if match else None}


def directory(connection, groups):
    records = {}
    for group in groups:
        for item in group.get('projects', []):
            record = records.setdefault(item['cup'], {'cup': item['cup'], 'kinds': [],
                'titles': [], 'municipalities': [], 'implementers': [], 'projects': []})
            if group['kind'] not in record['kinds']:
                record['kinds'].append(group['kind'])
            for key in ('titles', 'municipalities'):
                record[key] = list(dict.fromkeys([*record[key], *item.get(key, [])]))
    if not records or not consultation_repository.available(connection):
        return list(records.values())
    cups = sorted(records)
    projects = connection.execute('''SELECT cup,codice_locale_progetto,titolo_progetto,
        id_misura,descrizione_misura,id_submisura,descrizione_submisura,
        to_jsonb(p)->>'codice_univoco_misura' AS measure_code,
        to_jsonb(p)->>'codice_univoco_submisura' AS submeasure_code
        FROM curato.v_aifel_progetti p WHERE cup=ANY(%s)
        ORDER BY cup,codice_locale_progetto''', (cups,)).fetchall()
    by_key = {}
    for row in projects:
        item = {'clp': row['codice_locale_progetto'], 'title': row['titolo_progetto'],
                'municipalities': [], 'implementers': [], **programme(row)}
        records[row['cup']]['projects'].append(item)
        by_key[(row['cup'], row['codice_locale_progetto'])] = item
    for table, field, target in [('v_aifel_localizzazioni', 'descrizione_comune', 'municipalities'),
                                  ('v_aifel_soggetti_attuatori', 'denominazione', 'implementers')]:
        from psycopg import sql
        rows = connection.execute(sql.SQL('''SELECT DISTINCT cup,codice_locale_progetto,{} AS value
            FROM curato.{} WHERE cup=ANY(%s) AND nullif(btrim({}),'') IS NOT NULL''').format(
                sql.Identifier(field), sql.Identifier(table), sql.Identifier(field)), (cups,)).fetchall()
        for row in rows:
            item = by_key.get((row['cup'], row['codice_locale_progetto']))
            if item is not None and row['value'] not in item[target]:
                item[target].append(row['value'])
    for record in records.values():
        for target, field in [('titles', 'title'), ('municipalities', 'municipalities'), ('implementers', 'implementers')]:
            values = []
            for item in record['projects']:
                values.extend([item[field]] if field == 'title' and item[field] else item[field] if field != 'title' else [])
            record[target] = sorted(set([*record[target], *values]))
    return [records[cup] for cup in sorted(records)]
