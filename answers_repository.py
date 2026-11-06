"""Read current answer presentations only from the published question archive."""
from urllib.parse import urlparse, unquote

import questions_repository


def available(connection):
    if not questions_repository.available(connection, 'v_aifel_quesiti_archivio'):
        return False
    column = connection.execute('''SELECT 1 FROM pg_attribute
        WHERE attrelid='curato.v_aifel_quesiti_archivio'::regclass
          AND attname='answer_snapshot' AND attnum>0 AND NOT attisdropped''').fetchone()
    if not column:
        return False
    marker = connection.execute("SELECT to_regclass('curato.aifel_publication') IS NOT NULL AS present").fetchone()
    if marker['present']:
        publication = connection.execute('''SELECT manifest->>'answers_available' AS enabled
            FROM curato.aifel_publication WHERE singleton''').fetchone()
        return bool(publication and publication['enabled'] == 'true')
    return True


def attach_summaries(connection, rows):
    if not rows or not available(connection):
        return
    values = {r['source_question_id']: r for r in connection.execute('''SELECT source_question_id,
        coalesce(answer_snapshot->>'status','missing') AS status,
        answer_snapshot->>'version' AS version,answer_snapshot->>'generated_at' AS generated_at,
        coalesce(answer_snapshot->>'previous_available','false')='true' AS previous_available
        FROM curato.v_aifel_quesiti_archivio WHERE source_question_id=ANY(%s)''',
        ([r['source_question_id'] for r in rows],))}
    for row in rows:
        item = values.get(row['source_question_id'])
        row['answer_summary'] = {key:item[key] for key in ('status','version','generated_at','previous_available')} if item else {'status':'missing'}


def public_answer(value):
    """Repeat the field allowlist at the API boundary, including source URLs."""
    if not isinstance(value, dict):
        return None
    result = {key:value.get(key) for key in ('question_id','generated_at','proposed_answer',
        'desk_actions','conditions_and_uncertainties','documentation_gaps')}
    sources = []
    for item in value.get('sources') or []:
        url = item.get('url') or ''
        parsed = urlparse(url)
        if parsed.scheme not in ('https','http') or not parsed.hostname or parsed.username or parsed.password:
            url = None
        title = item.get('title') or parsed.hostname or 'Source'
        if title.startswith(('https://','http://')):
            title = unquote(parsed.path.rsplit('/',1)[-1]) or parsed.hostname
        sources.append({'title':title,'url':url,'member_name':item.get('member_name'),
            'claims':[{key:claim.get(key) for key in ('statement','supporting_quote')}
                      for claim in item.get('claims') or []]})
    result['sources'] = sources
    return result


def detail(connection, identity):
    if not available(connection):
        return {'available':False,'source_question_id':identity,'status':'unavailable','answer':None}
    row = connection.execute('''SELECT answer_snapshot FROM curato.v_aifel_quesiti_archivio
        WHERE source_question_id=%s''', (identity,)).fetchone()
    if row is None:
        return None
    snapshot = row['answer_snapshot'] or {}
    status = snapshot.get('status','missing')
    result = {'available':True,'source_question_id':identity,'status':status,
            'version':snapshot.get('version'),
            'answer':public_answer(snapshot.get('answer')) if status == 'available' else None}
    if status == 'outdated' and snapshot.get('previous_available') is True:
        result['previous_answer'] = public_answer(snapshot.get('previous_answer'))
        allowed = {'question_changed','minutes_changed','closure_changed','status_changed',
                   'appointment_changed','service_changed','source_or_context_changed'}
        result['changes'] = [value for value in snapshot.get('changes', []) if value in allowed]
        result['previous_question_text'] = snapshot.get('previous_question_text')
    return result
