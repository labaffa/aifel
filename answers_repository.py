"""Read current answer presentations only from the published question archive."""
from urllib.parse import urlparse, unquote
import re

import questions_repository

CHANGE_CODES = frozenset({'question_changed','minutes_changed','closure_changed','status_changed',
    'appointment_changed','service_changed','source_or_context_changed',
    'source_changed','context_changed','configuration_changed'})


def public_changes(values):
    return [value for value in values or [] if isinstance(value,str) and value in CHANGE_CODES]


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
        coalesce(answer_snapshot->>'previous_available','false')='true' AS previous_available,
        coalesce(answer_snapshot->>'update_recommended','false')='true' AS update_recommended,
        answer_snapshot->'changes' AS changes
        FROM curato.v_aifel_quesiti_archivio WHERE source_question_id=ANY(%s)''',
        ([r['source_question_id'] for r in rows],))}
    for row in rows:
        item = values.get(row['source_question_id'])
        row['answer_summary'] = {key:item.get(key) for key in ('status','version','generated_at','previous_available','update_recommended','changes')} if item else {'status':'missing'}
        if item:
            row['answer_summary']['changes'] = public_changes(item.get('changes'))


def public_answer(value):
    """Repeat the field allowlist at the API boundary, including source URLs."""
    if not isinstance(value, dict):
        return None
    result = {key:value.get(key) for key in ('question_id','generated_at','problem','proposed_answer',
        'desk_actions','conditions_and_uncertainties','documentation_gaps')}
    if not isinstance(result['problem'],str): result['problem']=None
    sources = []
    for item in value.get('sources') or []:
        url = item.get('url') or ''
        reference = url if re.fullmatch(r'urn:ifel:local-document:[a-f0-9]{64}',url) else None
        parsed = urlparse(url)
        if parsed.scheme not in ('https','http') or not parsed.hostname or parsed.username or parsed.password:
            url = None
        title = item.get('title') or parsed.hostname or 'Source'
        if title.startswith(('https://','http://')):
            title = unquote(parsed.path.rsplit('/',1)[-1]) or parsed.hostname
        sources.append({'title':title,'url':url,'reference':reference,'member_name':item.get('member_name'),
            'claims':[{key:claim.get(key) for key in ('statement','supporting_quote')}
                      for claim in item.get('claims') or []]})
    result['sources'] = sources
    result['answer_citations'] = []
    text = result.get('proposed_answer') or ''
    for citation in value.get('answer_citations') or []:
        if not isinstance(citation,dict): continue
        source_index=citation.get('source_index')
        claim_index=citation.get('claim_index')
        excerpt=citation.get('answer_excerpt')
        locator=citation.get('locator')
        if (type(source_index) is not int or not 1<=source_index<=len(sources)
                or type(claim_index) is not int or not 0<=claim_index<=len(sources[source_index-1]['claims'])
                or not isinstance(excerpt,str) or not excerpt.strip() or text.count(excerpt)!=1
                or not isinstance(locator,str)):
            continue
        result['answer_citations'].append({key:citation[key] for key in
            ('answer_excerpt','source_index','claim_index','locator')})
    return result


def version_summary(snapshot):
    return {key:snapshot.get(key) for key in ('version','generated_at','pipeline','stage')}


def detail(connection, identity, version=None):
    if not available(connection):
        return {'available':False,'source_question_id':identity,'status':'unavailable','answer':None}
    row = connection.execute('''SELECT answer_snapshot FROM curato.v_aifel_quesiti_archivio
        WHERE source_question_id=%s''', (identity,)).fetchone()
    if row is None:
        return None
    snapshot = row['answer_snapshot'] or {}
    versions = snapshot.get('versions') or ([snapshot] if snapshot.get('version') else [])
    if version is not None:
        snapshot = next((item for item in versions if item.get('version') == version), None)
        if snapshot is None:
            return None
    status = snapshot.get('status','missing')
    result = {'available':True,'source_question_id':identity,'status':status,
            'version':snapshot.get('version'),
            'answer':public_answer(snapshot.get('answer')) if status == 'available' else None}
    # Preserve the legacy API shape for old publications and checksum manifests.
    if row['answer_snapshot'] and 'versions' in row['answer_snapshot']:
        result['versions'] = [version_summary(item) for item in versions]
        result.update({key:snapshot.get(key) for key in ('pipeline','stage')})
    if status == 'outdated' and snapshot.get('previous_available') is True:
        result['previous_answer'] = public_answer(snapshot.get('previous_answer'))
    if status == 'available' or (status == 'outdated' and snapshot.get('previous_available') is True):
        result['changes'] = public_changes(snapshot.get('changes'))
        result['update_recommended'] = snapshot.get('update_recommended') is True
        result['previous_question_text'] = snapshot.get('previous_question_text')
    return result
