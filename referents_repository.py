"""Read reviewed role/contact assertions without resolving names into identities."""

from psycopg import sql

TABLE_KEYS = {
    'v_aifel_referenti': ('cup', 'reference_id'),
    'v_aifel_referenti_recapiti': ('cup', 'reference_id'),
    'v_aifel_approfondimenti_referenti': ('cup', 'investigation_id'),
}


def available(connection):
    return all(connection.execute('SELECT to_regclass(%s) IS NOT NULL AS available',
        ('curato.' + name,)).fetchone()['available'] for name in TABLE_KEYS)


def summary(connection, cup):
    if not available(connection):
        return None
    row = connection.execute('''SELECT count(*) AS count FROM curato.v_aifel_approfondimenti_referenti
        WHERE cup=%s''', (cup,)).fetchone()
    return {'available': True, 'level': 'cup'} if row['count'] else None


def directory(connection):
    if not available(connection):
        return []
    return connection.execute('''SELECT DISTINCT cup FROM curato.v_aifel_approfondimenti_referenti
        ORDER BY cup''').fetchall()


def page(connection, cup, clp=None, offset=0, limit=100, cig=None):
    result = {'available': False, 'cup': cup, 'clp': clp, 'roles': [], 'contacts': [],
              'investigations': [], 'role_total': 0, 'contact_total': 0, 'offset': offset, 'limit': limit}
    if not available(connection):
        return result
    result['available'] = True
    condition = 'cup=%s'
    parameters = [cup]
    if clp is not None:
        condition += ' AND (requested_clp IS NULL OR requested_clp=%s)'
        parameters.append(clp)
    result['investigations'] = connection.execute('''SELECT * FROM curato.v_aifel_approfondimenti_referenti
        WHERE ''' + condition + ' ORDER BY researched_at DESC,investigation_id DESC', parameters).fetchall()
    for key, table in [('roles', 'v_aifel_referenti'), ('contacts', 'v_aifel_referenti_recapiti')]:
        where = sql.SQL('cup=%s')
        parameters = [cup]
        if clp is not None:
            where += sql.SQL(' AND (clp IS NULL OR clp=%s)')
            parameters.append(clp)
        if cig is not None:
            if key == 'roles':
                where += sql.SQL(' AND cig=%s')
            else:
                where += sql.SQL(''' AND EXISTS (SELECT 1 FROM curato.v_aifel_referenti r
                    WHERE r.cup=%s AND r.cig=%s AND role_reference_ids ? r.reference_id)''')
                parameters.append(cup)
            parameters.append(cig)
        count = connection.execute(sql.SQL('SELECT count(*) AS count FROM curato.{} WHERE {}').format(
            sql.Identifier(table), where), parameters).fetchone()['count']
        rows = connection.execute(sql.SQL('SELECT * FROM curato.{} WHERE {} ORDER BY reference_id LIMIT %s OFFSET %s').format(
            sql.Identifier(table), where), [*parameters, limit, offset]).fetchall()
        for row in rows:
            # Nullable extension: preserve legacy release API checksums on restore.
            if row.get('person_reference') is None:
                row.pop('person_reference', None)
            # These links are relative to this consultation scope, not all CLPs.
            row['sources'] = sorted(row.get('sources') or [], key=lambda s: (
                s.get('url') or '', s.get('locator') or '', s.get('quote') or ''))
        result[key] = rows
        result['role_total' if key == 'roles' else 'contact_total'] = count
    return result
