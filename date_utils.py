"""Normalize procurement calendar dates while preserving source values."""

from copy import deepcopy
from datetime import date, datetime
import re
from typing import Any

# Italian month names are reference data from the procurement sources.
ITALIAN_MONTHS = {
    'gennaio':1, 'febbraio':2, 'marzo':3, 'aprile':4, 'maggio':5, 'giugno':6,
    'luglio':7, 'agosto':8, 'settembre':9, 'ottobre':10, 'novembre':11, 'dicembre':12,
}
DATE_FIELD = re.compile(r'^(?:DATA_|SCADENZA_INVITO$)|(?:_date|_deadline)$')


def parse_source_date(value: Any) -> date | None:
    """Read ISO dates/timestamps and explicitly day-first Italian source dates.

    Numeric dates with a four-digit trailing year use the documented Italian
    day/month/year convention. Two-digit years and unknown formats are rejected.
    A timestamp contributes its source calendar date, without timezone conversion.
    """
    if isinstance(value,datetime):
        return value.date()
    if isinstance(value,date):
        return value
    if not isinstance(value,str) or not value.strip():
        return None
    source = ' '.join(value.strip().split())
    try:
        if re.fullmatch(r'\d{4}-\d{2}-\d{2}',source):
            return date.fromisoformat(source)
        if re.fullmatch(r'\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?',source):
            return datetime.fromisoformat(source.replace('Z','+00:00')).date()
        numeric = re.fullmatch(r'(\d{1,2})([/.-])(\d{1,2})\2(\d{4})',source)
        if numeric:
            return date(int(numeric[4]),int(numeric[3]),int(numeric[1]))
        written = re.fullmatch(r'(\d{1,2}) ([a-z]+) (\d{4})',source.casefold())
        if written and written[2] in ITALIAN_MONTHS:
            return date(int(written[3]),ITALIAN_MONTHS[written[2]],int(written[1]))
    except ValueError:
        return None
    return None


def iso_date(value: Any) -> str | None:
    parsed = parse_source_date(value)
    return parsed.isoformat() if parsed else None


def normalize_date_fields(payload: dict) -> dict:
    """Copy date fields to ISO, auditing converted and invalid nonempty values.

    Source artifacts stay untouched. Audit entries survive repeated normalization.
    Operational timestamps such as requested_at_utc retain their time component.
    """
    result = deepcopy(payload)
    audit = list(result.get('date_validation') or [])

    def visit(value: Any,path: str = '') -> None:
        if isinstance(value,list):
            for index,item in enumerate(value):
                visit(item,f'{path}[{index}]')
        elif isinstance(value,dict):
            for key,item in list(value.items()):
                if key == 'date_validation':
                    continue
                field = f'{path}.{key}' if path else key
                if DATE_FIELD.search(key) and not isinstance(item,(dict,list)):
                    normalized = iso_date(item)
                    value[key] = normalized
                    if item is not None and item != '' and item != normalized:
                        audit.append({'field':field,'original_value':str(item),
                                      'normalized_value':normalized,
                                      'status':'normalized' if normalized else 'invalid'})
                else:
                    visit(item,field)

    visit(result)
    if audit:
        result['date_validation'] = audit
    return result
