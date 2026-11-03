"""Aggregate current appointment demand using only published allowlisted results."""
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import questions_repository


def summary(connection, period='fortnight', desk=None, category=None, offset=0, limit=25, now=None,
            search='', include_rows=False, measure=None):
    selected_measures = list(dict.fromkeys([measure] if isinstance(measure, str) else (measure or [])))
    result = {'available': False, 'total_questions': 0, 'classified_questions': 0,
              'unclassified_questions': 0, 'categories': [], 'desks': [], 'run': None,
              'rows': [], 'total': 0, 'offset': offset, 'limit': limit,
              'period': period, 'timezone': 'Europe/Rome', 'measures': [], 'measures_available': False,
              'selected_measures': selected_measures}
    if not questions_repository.available(connection, 'v_aifel_quesiti_archivio'):
        return result
    columns = {row['attname'] for row in connection.execute('''SELECT attname FROM pg_attribute
        WHERE attrelid='curato.v_aifel_quesiti_archivio'::regclass AND attnum>0 AND NOT attisdropped''')}
    has_demand = {'demand_run', 'demand_classification'} <= columns
    has_measures = 'question_measures' in columns
    result['measures_available'] = has_measures
    result['available'] = True
    result['demand_available'] = has_demand
    metadata = connection.execute('''SELECT demand_run FROM curato.v_aifel_quesiti_archivio
        WHERE demand_run IS NOT NULL LIMIT 1''').fetchone() if has_demand else None
    run = metadata['demand_run'] if metadata else None
    # Internal run paths, provider configuration and provenance never reach the client.
    result['run'] = {key: run.get(key) for key in ('selected_at', 'completed_at', 'taxonomy_version')} if run else None
    now = now or questions_repository.local_now()
    start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    conditions, parameters = [], []
    if period in ('future', 'fortnight', 'week'):
        conditions.append('appointment_at >= %s')
        parameters.append(start)
        if period != 'future':
            conditions.append('appointment_at < %s')
            parameters.append(start + timedelta(days=14 if period == 'fortnight' else 7))
    elif period == 'today':
        conditions.append('appointment_at >= %s AND appointment_at < %s')
        parameters.extend((start, start + timedelta(days=1)))
    elif period == 'past':
        conditions.append('appointment_at < %s')
        parameters.append(start)
    elif period != 'all':
        raise ValueError('Unknown demand period')
    if period not in ('past', 'all'):
        conditions.append("upper(regexp_replace(btrim(coalesce(external_status,'')), '\\s+', ' ', 'g')) <> 'PRENOTAZIONE ANNULLATA'")
    where = ' WHERE ' + ' AND '.join(conditions) if conditions else ''
    result['desks'] = [row['desk'] for row in connection.execute('''SELECT DISTINCT coalesce(desk,'') AS desk
        FROM curato.v_aifel_quesiti_archivio''' + where + ' ORDER BY desk NULLS LAST', parameters)]
    if desk is not None:
        conditions.append("coalesce(desk,'')=%s")
        parameters.append(desk)
    if search:
        fields = 'source_question_id,requester_entity,requester_first_name,requester_last_name,desk,question_text,cited_cups::text'
        if has_demand:
            fields += ",demand_classification->'assignments'"
        if has_measures:
            fields += ',question_measures::text'
        conditions.append("concat_ws(' '," + fields + ") ILIKE %s ESCAPE '!' ")
        parameters.append('%' + search.replace('!', '!!').replace('%', '!%').replace('_', '!_') + '%')
    where = ' WHERE ' + ' AND '.join(conditions) if conditions else ''
    # Facet counts ignore their own selection and the category drill-down.
    if has_measures:
        result['measures'] = list(connection.execute('''SELECT m->>'code' AS code,
            max(m->>'label') AS label,count(DISTINCT source_question_id) AS question_count
            FROM curato.v_aifel_quesiti_archivio
            CROSS JOIN LATERAL jsonb_array_elements(question_measures) m''' + where +
            " GROUP BY m->>'code' ORDER BY m->>'code'", parameters))
        result['unassigned_measure_questions'] = connection.execute('''SELECT count(*) AS n
            FROM curato.v_aifel_quesiti_archivio''' + where +
            (' AND ' if conditions else ' WHERE ') +
            "coalesce(question_measures,'[]'::jsonb)='[]'::jsonb", parameters).fetchone()['n']
    if selected_measures:
        if not has_measures:
            conditions.append('false')
        else:
            alternatives = []
            codes = [value for value in selected_measures if value != 'unassigned']
            if codes:
                alternatives.append("EXISTS (SELECT 1 FROM jsonb_array_elements(question_measures) m WHERE m->>'code'=ANY(%s))")
                parameters.append(codes)
            if 'unassigned' in selected_measures:
                alternatives.append("coalesce(question_measures,'[]'::jsonb)='[]'::jsonb")
            conditions.append('(' + ' OR '.join(alternatives) + ')')
    where = ' WHERE ' + ' AND '.join(conditions) if conditions else ''
    classification = 'demand_classification' if has_demand else 'NULL::jsonb'
    counts = connection.execute('''SELECT count(*) AS total_questions,
        count(''' + classification + ''') AS classified_questions FROM curato.v_aifel_quesiti_archivio''' +
        where, parameters).fetchone()
    result.update(counts)
    result['unclassified_questions'] = counts['total_questions'] - counts['classified_questions']
    values = {row['code']: row['n'] for row in connection.execute('''SELECT a->>'category_code' AS code,
        count(DISTINCT source_question_id) AS n FROM curato.v_aifel_quesiti_archivio
        CROSS JOIN LATERAL jsonb_array_elements(demand_classification->'assignments') a''' + where +
        " GROUP BY a->>'category_code'", parameters)} if has_demand else {}
    def is_new(item):
        if not item.get('first_seen_at'):
            return False
        first = datetime.fromisoformat(item['first_seen_at']).astimezone(ZoneInfo('Europe/Rome')).date()
        return 0 <= (now.date() - first).days < 14

    result['categories'] = sorted([{'code': item['code'], 'label': item['label'],
        'question_count': values.get(item['code'], 0), 'is_new': is_new(item),
        'first_seen_at': item.get('first_seen_at')} for item in (run or {}).get('categories', [])],
        key=lambda item: (-item['question_count'], item['code']))
    codes = {item['code'] for item in result['categories']}
    if category is not None:
        if category == 'unclassified':
            conditions.append(classification + ' IS NULL')
        elif category in codes:
            conditions.append("demand_classification->'assignments' @> %s::jsonb")
            import json
            parameters.append(json.dumps([{'category_code': category}]))
        else:
            raise ValueError('Unknown demand category')
    if category is not None or include_rows:
        where = ' WHERE ' + ' AND '.join(conditions) if conditions else ''
        result['total'] = connection.execute('SELECT count(*) AS n FROM curato.v_aifel_quesiti_archivio' +
            where, parameters).fetchone()['n']
        selected = [name if name in columns else 'NULL AS ' + name for name in questions_repository.ARCHIVE_FIELDS]
        order = 'DESC' if period in ('past', 'all') else 'ASC'
        measure_field = 'question_measures' if has_measures else 'NULL::jsonb AS question_measures'
        rows = connection.execute('SELECT ' + ','.join(selected) + ',' + classification + ' AS demand_classification,' + measure_field + ' FROM curato.v_aifel_quesiti_archivio' +
            where + ' ORDER BY appointment_at ' + order + ' NULLS LAST,source_question_id LIMIT %s OFFSET %s',
            [*parameters, limit, offset]).fetchall()
        result['rows'] = rows
    return result
