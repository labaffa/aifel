"""Read current project consultation sections with explicit pagination."""

from psycopg import sql

PROJECT_SECTIONS = {
    'locations': 'v_aifel_localizzazioni',
    'implementers': 'v_aifel_soggetti_attuatori',
    'finance': 'v_aifel_finanziamenti_pagamenti',
    'reporting': 'v_aifel_rendicontazioni',
    'phases': 'v_aifel_iter_progetto',
    'tenders': 'v_aifel_gare',
    'awardees': 'v_aifel_aggiudicatari',
    'subcontractors': 'v_aifel_subappaltatori',
    'indicators': 'v_aifel_indicatori_progetto',
}
MEASURE_SECTIONS = {
    'measure_finance': 'v_aifel_quadro_finanziario_misura',
    'activation': 'v_aifel_procedure_attivazione',
    'milestones': 'v_aifel_milestone_target_misura',
    'common_mapping': 'v_aifel_mappatura_indicatori_comuni',
    'target_mapping': 'v_aifel_mappatura_indicatori_target',
    'monitoring': 'v_aifel_monitoraggio_misure_indicatori',
    'measure_progress': 'v_aifel_avanzamento_indicatori_misura',
    'measure_tags': 'v_aifel_tag_misura',
}


def available(connection):
    return connection.execute("SELECT to_regclass('curato.v_aifel_progetti') IS NOT NULL AS available").fetchone()['available']


def projects(connection, cup, clp=None):
    source = connection.execute("SELECT to_regclass('curato.v_aifel_open_data_progetti') IS NOT NULL AS available").fetchone()['available']
    query = ('''SELECT r.*,p.codice_univoco_misura,p.codice_univoco_submisura
        FROM curato.v_aifel_progetti r LEFT JOIN curato.v_aifel_open_data_progetti p
        USING(cup,codice_locale_progetto) WHERE r.cup=%s''' if source else
        'SELECT r.* FROM curato.v_aifel_progetti r WHERE r.cup=%s')
    parameters = [cup]
    if clp is not None:
        query += ' AND r.codice_locale_progetto=%s'
        parameters.append(clp)
    rows = connection.execute(query + ' ORDER BY r.codice_locale_progetto', parameters).fetchall()
    for row in rows:
        # Legacy v3 publications have no phase observations; keep their API shape.
        if row.get('phase_observations') is None:
            row.pop('phase_observations', None)
    return rows


def summary(connection, cup, rows):
    counts = {row['codice_locale_progetto']: {} for row in rows}
    for section, table in PROJECT_SECTIONS.items():
        query = sql.SQL('SELECT codice_locale_progetto,count(*) AS count FROM curato.{} WHERE cup=%s GROUP BY 1').format(sql.Identifier(table))
        for row in connection.execute(query, (cup,)):
            counts[row['codice_locale_progetto']][section] = row['count']
    return {'available': True, 'projects': [
        {**row, 'sections': counts[row['codice_locale_progetto']]} for row in rows
    ]}


def measure_keys(project):
    pairs = [('misura_id', project.get('id_misura')), ('submisura_id', project.get('id_submisura')),
             ('misura_code', project.get('codice_univoco_misura')),
             ('submisura_code', project.get('codice_univoco_submisura'))]
    # ReGiS may natively supply program codes in its ID fields.
    for field, level in [('id_misura', 'misura_code'), ('id_submisura', 'submisura_code')]:
        value = project.get(field)
        if isinstance(value, str) and value.startswith('M'):
            pairs.append((level, value))
    return [list(pair) for pair in dict.fromkeys(pairs) if pair[1]]


def section(connection, cup, clp, name, offset=0, limit=100, source=None):
    if name not in PROJECT_SECTIONS and name not in MEASURE_SECTIONS:
        raise ValueError('Unknown consultation section.')
    if source is not None and (name != 'locations' or source not in ('open_data', 'regis')):
        raise ValueError('Invalid location source.')
    rows = projects(connection, cup, clp)
    project = rows[0] if rows else None
    if project is None:
        return None
    if name in PROJECT_SECTIONS:
        table = PROJECT_SECTIONS[name]
        where = sql.SQL('cup=%s AND codice_locale_progetto=%s')
        parameters = [cup, clp]
        if source is not None:
            where += sql.SQL(' AND source=%s')
            parameters.append(source)
    else:
        from psycopg.types.json import Jsonb
        table = MEASURE_SECTIONS[name]
        keys = measure_keys(project)
        if not keys:
            return {'rows': [], 'total': 0, 'offset': offset, 'limit': limit, 'level': 'measure'}
        where = sql.SQL('measure_key IN ({})').format(sql.SQL(',').join(sql.Placeholder() for _ in keys))
        parameters = [Jsonb(key) for key in keys]
    total = connection.execute(sql.SQL('SELECT count(*) AS count FROM curato.{} WHERE {}').format(sql.Identifier(table), where), parameters).fetchone()['count']
    rows = connection.execute(sql.SQL('SELECT * FROM curato.{} WHERE {} ORDER BY source,source_dataset,source_row_id LIMIT %s OFFSET %s').format(sql.Identifier(table), where), [*parameters, limit, offset]).fetchall()
    if name == 'finance':
        for row in rows:
            # Preserve the API shape when restoring a publication without this extension.
            if row.get('finanziamento_pubblico') is None:
                row.pop('finanziamento_pubblico', None)
    return {'rows': rows, 'total': total, 'offset': offset, 'limit': limit,
            'level': 'project' if name in PROJECT_SECTIONS else 'measure'}
