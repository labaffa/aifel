"""Read current CUP-level questions through an explicit public field allowlist."""

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

FIELDS = ('cup', 'source_question_id', 'appointment_at', 'requester_entity',
          'outcome_status', 'external_status', 'question_text', 'consultation_minutes',
          'citation_fields', 'source')
DETAIL_FIELDS = ('requester_first_name', 'requester_last_name', 'requester_email',
                 'requester_mobile', 'requester_phone', 'service', 'desk', 'booked_at',
                 'closed_definitively', 'source_extracted_at', 'source_imported_at', 'cited_measures')
ARCHIVE_FIELDS = tuple(field for field in FIELDS if field not in ('cup', 'citation_fields')) + DETAIL_FIELDS + ('cited_cups',)


def local_now():
    return datetime.now(ZoneInfo('Europe/Rome')).replace(tzinfo=None)


def available(connection, relation='v_aifel_quesiti'):
    if not connection.execute("SELECT to_regclass(%s) IS NOT NULL AS available", ('curato.' + relation,)).fetchone()['available']:
        return False
    marker = connection.execute("SELECT to_regclass('curato.aifel_publication') IS NOT NULL AS available").fetchone()['available']
    if marker:
        row = connection.execute("SELECT manifest->'counts' ? %s AS available FROM curato.aifel_publication WHERE singleton", (relation,)).fetchone()
        return bool(row and row['available'])
    return True


def count(connection, cup):
    if not available(connection):
        return 0
    return connection.execute('SELECT count(*) AS n FROM curato.v_aifel_quesiti WHERE cup=%s', (cup,)).fetchone()['n']


def page(connection, cup, offset=0, limit=25):
    if not available(connection):
        return {'available': False, 'level': 'cup', 'cup': cup, 'rows': [], 'total': 0,
                'offset': offset, 'limit': limit}
    columns = {row['attname'] for row in connection.execute('''SELECT attname FROM pg_attribute
        WHERE attrelid='curato.v_aifel_quesiti'::regclass AND attnum>0 AND NOT attisdropped''')}
    selected = list(FIELDS) + [name if name in columns else 'NULL AS ' + name for name in DETAIL_FIELDS]
    rows = connection.execute('SELECT ' + ','.join(selected) + ''' FROM curato.v_aifel_quesiti
        WHERE cup=%s ORDER BY appointment_at DESC NULLS LAST,source_question_id
        LIMIT %s OFFSET %s''', (cup, limit, offset)).fetchall()
    if rows:
        related = {}
        for reference in connection.execute('''SELECT source_question_id,
                array_agg(DISTINCT cup ORDER BY cup) AS cups
            FROM curato.v_aifel_quesiti
            WHERE source_question_id=ANY(%s) AND cup<>%s GROUP BY source_question_id''',
                ([row['source_question_id'] for row in rows], cup)):
            related[reference['source_question_id']] = reference['cups']
        for row in rows:
            row['other_cups'] = related.get(row['source_question_id'], [])
    return {'available': True, 'level': 'cup', 'cup': cup, 'rows': rows,
            'total': count(connection, cup), 'offset': offset, 'limit': limit}


def directory(connection):
    if not available(connection):
        return []
    counts = connection.execute('''SELECT cup,count(*) AS question_count,
        min(appointment_at) FILTER (WHERE appointment_at >= %s) AS next_appointment_at
        FROM curato.v_aifel_quesiti GROUP BY cup ORDER BY cup''', (local_now(),)).fetchall()
    if not counts:
        return []
    cups = [row['cup'] for row in counts]
    profiles = {row['cup']: row['titles'] for row in connection.execute('''SELECT cup,
        array_agg(DISTINCT titolo_progetto ORDER BY titolo_progetto)
            FILTER (WHERE titolo_progetto IS NOT NULL AND btrim(titolo_progetto)<>'') AS titles
        FROM curato.v_aifel_progetti WHERE cup=ANY(%s) GROUP BY cup''', (cups,))}
    return [{**row, 'titles': profiles.get(row['cup']) or []} for row in counts]


def archive_page(connection, period='future', search='', offset=0, limit=25, now=None):
    payload = {'available': False, 'rows': [], 'total': 0, 'offset': offset,
               'limit': limit, 'period': period, 'timezone': 'Europe/Rome'}
    if not available(connection, 'v_aifel_quesiti_archivio'):
        return payload
    now = now or local_now()
    conditions, parameters = [], []
    if period in ('future', 'week'):
        conditions.append('appointment_at >= %s')
        parameters.append(now)
        if period == 'week':
            conditions.append('appointment_at < %s')
            parameters.append(now + timedelta(days=7))
    elif period == 'today':
        start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        conditions.append('appointment_at >= %s AND appointment_at < %s')
        parameters.extend((start, start + timedelta(days=1)))
    elif period == 'past':
        conditions.append('appointment_at < %s')
        parameters.append(now)
    elif period != 'all':
        raise ValueError('Unknown appointment period.')
    if search:
        conditions.append("concat_ws(' ',source_question_id,requester_entity,requester_first_name,"
                          "requester_last_name,desk,question_text,cited_cups::text) ILIKE %s ESCAPE '!' ")
        parameters.append('%' + search.replace('!', '!!').replace('%', '!%').replace('_', '!_') + '%')
    where = ' WHERE ' + ' AND '.join(conditions) if conditions else ''
    total = connection.execute('SELECT count(*) AS n FROM curato.v_aifel_quesiti_archivio' + where,
                               parameters).fetchone()['n']
    order = 'ASC' if period in ('future', 'week', 'today') else 'DESC'
    rows = connection.execute('SELECT ' + ','.join(ARCHIVE_FIELDS) +
        ' FROM curato.v_aifel_quesiti_archivio' + where +
        ' ORDER BY appointment_at ' + order + ' NULLS LAST,source_question_id LIMIT %s OFFSET %s',
        [*parameters, limit, offset]).fetchall()
    return {**payload, 'available': True, 'rows': rows, 'total': total}
