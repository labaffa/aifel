"""Aggregate current appointment demand using only published allowlisted results."""
from datetime import timedelta

import questions_repository


def summary(connection, period='fortnight', desk=None, category=None, offset=0, limit=25, now=None,
            search='', include_rows=False):
    result = {'available': False, 'total_questions': 0, 'classified_questions': 0,
              'unclassified_questions': 0, 'categories': [], 'desks': [], 'run': None,
              'rows': [], 'total': 0, 'offset': offset, 'limit': limit,
              'period': period, 'timezone': 'Europe/Rome'}
    if not questions_repository.available(connection, 'v_aifel_quesiti_archivio'):
        return result
    columns = {row['attname'] for row in connection.execute('''SELECT attname FROM pg_attribute
        WHERE attrelid='curato.v_aifel_quesiti_archivio'::regclass AND attnum>0 AND NOT attisdropped''')}
    has_demand = {'demand_run', 'demand_classification'} <= columns
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
        conditions.append("concat_ws(' '," + fields + ") ILIKE %s ESCAPE '!' ")
        parameters.append('%' + search.replace('!', '!!').replace('%', '!%').replace('_', '!_') + '%')
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
    result['categories'] = sorted([{'code': item['code'], 'label': item['label'],
        'question_count': values.get(item['code'], 0)} for item in (run or {}).get('categories', [])],
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
        rows = connection.execute('SELECT ' + ','.join(selected) + ',' + classification + ' AS demand_classification FROM curato.v_aifel_quesiti_archivio' +
            where + ' ORDER BY appointment_at ' + order + ' NULLS LAST,source_question_id LIMIT %s OFFSET %s',
            [*parameters, limit, offset]).fetchall()
        result['rows'] = rows
    return result
