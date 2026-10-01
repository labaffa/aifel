"""Read structured award/payment amounts without treating prose as money."""

from decimal import Decimal, InvalidOperation
import re
from typing import Any


def enrichment_amount(value: Any) -> str | None:
    """Return a nonnegative decimal string, including an explicit zero.

    Structured numeric values use decimal points. Commas or a currency suffix
    identify Italian formatting. Unlabeled source prose is never parsed.
    """
    if value is None or isinstance(value,bool):
        return None
    raw = str(value).strip().replace('\u00a0',' ')
    if ',' in raw or raw.endswith('€'):
        raw = raw.removesuffix('€').strip()
        if re.fullmatch(r'\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?',raw) or ',' in raw:
            if not re.fullmatch(r'(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?',raw):
                return None
            raw = raw.replace('.','').replace(',','.')
    if not re.fullmatch(r'\d+(?:\.\d+)?',raw):
        return None
    try:
        parsed = Decimal(raw)
        return str(parsed) if parsed.is_finite() and parsed >= 0 else None
    except InvalidOperation:
        return None


def enrichment_amounts(detail: dict) -> dict:
    enrichment = ((detail or {}).get('smartcig_like') or {}).get('enrichment') or {}
    return {'award_amount':enrichment_amount(enrichment.get('IMPORTO_AGGIUDICAZIONE')),
            'liquidated_amount':enrichment_amount(enrichment.get('IMPORTO_LIQUIDATO'))}
