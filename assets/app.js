const form = document.querySelector('#search-form');
const input = document.querySelector('#cup-input');
const message = document.querySelector('#message');
const results = document.querySelector('#results');
const examples = document.querySelector('#examples');
const examplesButton = document.querySelector('#show-examples');
const datasetCount = document.querySelector('#dataset-count');
let repositoryMessages = {
  notCollected: 'Procurement collection has not been run for this project yet.',
  awaitingReview: 'Collected procedures are awaiting review.',
  reviewedEmpty: 'No procedures were included after review.',
  unknownCup: 'No project or procurement data was found for this CUP.',
  collectedCups: 'CUP with collected procurement. Search any project CUP.',
  canonicalProjects: 'Projects associated with this CUP',
  project: 'Project',
};
const messagesReady = fetch('/assets/messages.it.json')
  .then((response) => {
    if (!response.ok) throw new Error('Translations unavailable.');
    return response.json();
  })
  .then((translations) => { repositoryMessages = { ...repositoryMessages, ...translations }; })
  .catch(() => {});

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null && text !== '') node.textContent = String(text);
  return node;
}

function showMessage(text, error = false) {
  message.textContent = text;
  message.className = 'message' + (error ? ' error' : '');
  message.hidden = false;
}

function valueText(value) {
  if (Array.isArray(value)) return value.filter(Boolean).join(', ');
  if (value && typeof value === 'object') return JSON.stringify(value);
  return value == null || value === '' ? '—' : String(value);
}

function addField(grid, label, value) {
  const field = el('div', 'detail-field');
  field.append(el('label', '', label), el('p', '', valueText(value)));
  grid.append(field);
}

function formatAmount(value) {
  const raw = String(value || '').trim();
  if (!raw) return '—';
  const normalized = raw.includes(',')
    ? raw.replaceAll('.', '').replace(',', '.')
    : raw;
  const amount = Number(normalized);
  return Number.isFinite(amount)
    ? new Intl.NumberFormat('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount) + ' €'
    : raw;
}

function dateLabel(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? match[3] + '/' + match[2] + '/' + match[1] : '—';
}

const detailLabels = {
  CIG: 'CIG', CUP: 'CUP', CPV: 'Codice CPV (classificazione europea)', CUI_PROGRAMMA: 'Codice unico del programma',
  DATA_CREAZIONE: 'Data creazione', DATA_PUBBLICAZIONE: 'Data pubblicazione',
  DATA_SCADENZA_OFFERTA: 'Scadenza offerte', DATA_COMUNICAZIONE_ESITO: 'Comunicazione esito',
  DATA_AGGIUDICAZIONE_DEFINITIVA: 'Data aggiudicazione definitiva', DATA_INIZIO: 'Data inizio', DATA_FINE: 'Data fine',
  OGGETTO_GARA: 'Oggetto gara', OGGETTO_LOTTO: 'Oggetto lotto',
  IMPORTO_COMPLESSIVO_GARA: 'Importo complessivo gara', IMPORTO_LOTTO: 'Importo lotto',
  IMPORTO_AGGIUDICAZIONE: 'Importo aggiudicazione', IMPORTO_LIQUIDATO: 'Importo liquidato',
  DENOMINAZIONE_AMMINISTRAZIONE_APPALTANTE: 'Amministrazione appaltante',
  CF_AMMINISTRAZIONE_APPALTANTE: 'Codice fiscale amministrazione',
  DENOMINAZIONE_CENTRO_COSTO: 'Centro di costo', COD_RUOLO: 'Ruolo',
  CODICE_FISCALE: 'Codice fiscale', DESCRIZIONE_RUOLO: 'Descrizione ruolo',
  DENOMINAZIONE: 'Operatore economico', TIPO_SOGGETTO: 'Tipo di operatore', AGGIUDICATARIO: 'Aggiudicatario',
  ISTAT_COMUNE: 'Codice del Comune', INDIRIZZO: 'Indirizzo', CITTA: 'Comune', REGIONE: 'Regione',
  provider: 'Fonte', source_url: 'URL della fonte',
  operator_source: 'Fonte dei dati sugli operatori',
  tender_object: 'Oggetto gara', lot_object: 'Oggetto lotto', framework_cig: 'CIG accordo quadro',
  publication_date: 'Pubblicazione bando', offer_deadline: 'Scadenza offerte',
  result_communication_date: 'Comunicazione esito', amount: 'Importo lotto',
  provenance: 'Come è stato collegato al progetto',
  NUMERO_GARA: 'Numero gara', TIPO_CIG: 'Tipo di CIG', TIPO_SCELTA_CONTRAENTE: 'Procedura di affidamento',
  MODALITA_REALIZZAZIONE: 'Modalità di realizzazione', STRUMENTO_SVOLGIMENTO: 'Strumento di svolgimento',
  ESITO: 'Esito', STATO: 'Stato della gara', SETTORE: 'Settore',
  OGGETTO_PRINCIPALE_CONTRATTO: 'Oggetto principale del contratto', IMPORTO_SICUREZZA: 'Importo degli oneri di sicurezza',
  ORA_SCADENZA_OFFERTA: 'Ora di scadenza delle offerte', DURATA_PREVISTA: 'Durata prevista',
  N_LOTTI_COMPONENTI: 'Numero di lotti', SIGLA_PROVINCIA: 'Provincia',
  COD_CPV: 'Codice CPV', DESCRIZIONE_CPV: 'Descrizione CPV', FLAG_PREVALENTE: 'Categoria principale',
  awards: 'Aggiudicazioni', contract_starts: 'Avvii del contratto', contract_ends: 'Conclusioni del contratto',
  testing: 'Collaudi', work_progress: 'Stati di avanzamento lavori', subcontracts: 'Subappalti',
  suspensions: 'Sospensioni', extensions: 'Proroghe', variations: 'Varianti',
  financial_framework: 'Quadro economico', work_categories: 'Categorie dei lavori',
  dpcm_aggregation_categories: 'Categorie di aggregazione', funding_sources: 'Fonti di finanziamento', work_types: 'Lavorazioni',
};

const sourceNames = {
  anac_cup_csv: 'Elenco ANAC CUP–CIG',
  anac_smartcig: 'Dati SmartCIG ANAC',
  anac_dettaglio_cig_browser: 'Dettaglio del CIG sul portale ANAC',
  anac_detail_declared_cup: 'CUP indicato nel dettaglio della gara',
  anac_cup_dataset: 'Elenco ANAC CUP–CIG',
  anac_legal_publicity: 'Pubblicità legale ANAC',
  anac_open_data_gare: 'Dataset gare PNRR — Italia Domani',
  anac_open_data_gare_dataset: 'Dataset gare PNRR — Italia Domani',
  anac_superset_appalti: 'ANAC Analytics — gare',
  anac_superset_aggiudicatari: 'ANAC Analytics — operatori economici',
  saturn_historical_listing: 'Atto nell’archivio storico Saturn',
  saturn_historical_same_record: 'Atto nell’archivio storico Saturn',
  cup_in_listing_text: 'CUP citato nella descrizione dell’atto',
  source_explicit_cup: 'CUP indicato nella fonte',
  saturn_contracts: 'Archivio dei contratti',
  saturn_detail: 'Dettaglio del contratto e atti collegati',
  saturn_detail_document: 'Atto collegato al contratto',
  fallback_multisource: 'Dati integrati da più fonti',
  codex_semantic_classification: 'Descrizione della gara analizzata',
};

function sourceName(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const key = raw.split(/[.\s]/, 1)[0];
  if (sourceNames[key]) return sourceNames[key];
  if (raw.startsWith('Saturn detail or')) return sourceNames.saturn_detail;
  if (raw.startsWith('Superset dataset')) return sourceNames.anac_superset_aggiudicatari;
  if (raw.startsWith('Saturn')) return sourceNames.saturn_detail;
  return 'Altra fonte integrata';
}

const confidenceNames = {
  certain: 'Collegamento confermato', high: 'Collegamento con riscontri forti',
  candidate: 'Corrispondenza da verificare', review: 'Da verificare',
};

function associationForDisplay(association = {}) {
  const summaries = {
    certain: 'Le fonti qui sotto documentano il collegamento tra questo CUP e questo CIG.',
    high: 'Le fonti qui sotto contengono riscontri del collegamento.',
    candidate: 'La descrizione della gara è stata ritenuta coerente con il progetto. Il collegamento richiede una verifica.',
    review: 'Il collegamento richiede una verifica delle evidenze disponibili.',
  };
  return {
    status: confidenceNames[association.confidence] || 'Informazioni sul collegamento disponibili',
    summary: summaries[association.confidence] || 'Le evidenze disponibili sono indicate sotto ciascuna fonte.',
  };
}

function provenanceForDisplay(value) {
  const labels = {
    ANAC: 'Collegamento presente nei dati ANAC',
    'Italia Domani': 'Collegamento presente in Italia Domani',
    'citazione esplicita': 'CUP e CIG riportati nella stessa fonte',
    'semantico LLM': 'Descrizione della gara coerente con il progetto',
  };
  return String(value || '').split(';').map((item) => item.trim()).filter(Boolean)
    .map((item) => labels[item] || item).join('; ');
}

function selectedFields(record, fields) {
  return Object.fromEntries(fields.filter((key) => hasDetailValue(record?.[key])).map((key) => [key, record[key]]));
}

function sourceReferenceUrl(sourceId, cig, evidenceUrl = '') {
  const source = String(sourceId || '').trim();
  const validEvidenceUrl = /^https?:\/\//i.test(String(evidenceUrl))
    && !/^https:\/\/dati\.anticorruzione\.it\/superset\/dashboard\/dettaglio_cig\//i.test(String(evidenceUrl))
    ? String(evidenceUrl) : '';
  if (['anac_cup_csv', 'anac_cup_dataset'].includes(source)) {
    return 'https://dati.anticorruzione.it/opendata/dataset/cup';
  }
  if (source === 'anac_smartcig') {
    return validEvidenceUrl || (cig ? 'https://api.anticorruzione.it/apicig/1.0.0/getSmartCig/' + encodeURIComponent(cig) : '');
  }
  if (['anac_dettaglio_cig_browser', 'anac_detail_declared_cup'].includes(source)) {
    return validEvidenceUrl || (cig ? 'https://dettaglio-cig.anticorruzione.it/cig/' + encodeURIComponent(cig) : '');
  }
  if (['anac_open_data_gare', 'anac_open_data_gare_dataset'].includes(source)) {
    return 'https://www.italiadomani.gov.it/content/sogei-ng/it/it/catalogo-open-data/gare-dei-progetti-del-pnrr.html';
  }
  if (source === 'anac_superset_appalti') {
    return 'https://dati.anticorruzione.it/superset/dashboard/appalti';
  }
  if (source === 'anac_superset_aggiudicatari') return '';
  return validEvidenceUrl;
}

function evidenceDescription(evidence, procedure) {
  const descriptions = {
    anac_cup_dataset: `Il CUP ${procedure.cup} e il CIG ${procedure.cig} sono associati nell’elenco ANAC.`,
    anac_detail_declared_cup: `La scheda ANAC del CIG indica il CUP ${procedure.cup}.`,
    anac_open_data_gare_dataset: 'La coppia CUP–CIG compare nel dataset delle gare PNRR.',
    saturn_historical_same_record: 'CUP e CIG sono citati insieme nello stesso atto.',
    cup_in_listing_text: 'Il CUP compare nella descrizione della gara associata al CIG.',
    source_explicit_cup: 'Il CUP è indicato esplicitamente nella fonte della gara.',
    semantic_candidate: 'L’oggetto della gara è stato confrontato con il progetto.',
  };
  return descriptions[evidence.relation] || 'È stata registrata un’evidenza relativa al collegamento.';
}

function semanticExplanation(evidence) {
  try { return String(JSON.parse(evidence.notes || '{}').evidence || '').trim(); }
  catch { return ''; }
}

function evidenceCategory(relation) {
  const categories = {
    anac_cup_dataset: 'ANAC',
    anac_detail_declared_cup: 'ANAC',
    anac_open_data_gare_dataset: 'Italia Domani',
    saturn_historical_same_record: 'Citazione esplicita',
    cup_in_listing_text: 'Citazione esplicita',
    source_explicit_cup: 'Citazione esplicita',
    semantic_candidate: 'Corrispondenza semantica',
  };
  return categories[relation] || 'Riscontro';
}

function sourceSection(procedure, pipelineRecord, smartcig, association) {
  const groups = new Map();
  function add(sourceId, url = '', evidence = null) {
    if (!sourceId || !sourceNames[sourceId]) return;
    if (!groups.has(sourceId)) groups.set(sourceId, { id: sourceId, urls: new Set(), evidences: [] });
    const group = groups.get(sourceId);
    const sourceUrl = sourceReferenceUrl(sourceId, procedure?.cig, url);
    if (sourceUrl) group.urls.add(sourceUrl);
    if (evidence) group.evidences.push(evidence);
  }
  const detail = pipelineRecord?.detail || {};
  const source = smartcig?.source || {};
  for (const evidence of procedure?.evidence_sources || []) {
    const sourceId = evidence.source === 'codex_semantic_classification'
      ? evidence.origin_source || evidence.source : evidence.source;
    add(sourceId, evidence.url, evidence);
  }
  add(source.provider, source.source_url);
  add(detail.browser_detail?.provider, detail.browser_detail?.source_url);
  for (const value of Object.values(source.field_provenance || {})) {
    if (typeof value === 'string' && value.split('.')[0] !== 'anac_superset_aggiudicatari') add(value.split('.')[0]);
    else if (value && typeof value === 'object' && value.provider !== 'anac_superset_aggiudicatari') {
      add(value.provider, value.source_url);
    }
  }
  if (!groups.size && !hasDetailValue(association)) return null;
  const section = collapsibleSection('Collegamento CUP–CIG', true);
  if (association?.status) section.append(el('p', 'cig-link-status', association.status));
  if (association?.summary) section.append(el('p', 'cig-link-summary', association.summary));
  const sourceOrder = [
    'anac_cup_csv', 'anac_smartcig', 'anac_dettaglio_cig_browser',
    'anac_open_data_gare', 'saturn_historical_listing', 'saturn_contracts',
    'anac_superset_appalti', 'anac_legal_publicity',
  ];
  const orderedGroups = [...groups.values()].sort((a, b) => {
    const aIndex = sourceOrder.indexOf(a.id);
    const bIndex = sourceOrder.indexOf(b.id);
    return (aIndex < 0 ? sourceOrder.length : aIndex) - (bIndex < 0 ? sourceOrder.length : bIndex);
  });
  for (const [title, selected] of [
    ['Fonti con evidenze sul collegamento', orderedGroups.filter((group) => group.evidences.length)],
    ['Altre fonti sulla procedura', orderedGroups.filter((group) => !group.evidences.length)],
  ]) {
    if (!selected.length) continue;
    section.append(el('h5', 'cig-sources-subtitle', title));
    const list = el('ul', 'cig-source-list');
    for (const group of selected) {
      const item = document.createElement('li');
      const content = el('div', 'cig-source-content');
      content.append(el('strong', 'cig-source-name', sourceName(group.id)));
      const categories = new Set(group.evidences.map((evidence) => evidenceCategory(evidence.relation)));
      for (const category of categories) content.append(el('span', 'cig-evidence-tag', category));
      const descriptions = new Set(group.evidences.map((evidence) => evidenceDescription(evidence, procedure)));
      for (const description of descriptions) content.append(el('p', 'cig-source-description', description));
      if (group.id === 'anac_open_data_gare' && group.evidences.length > 1) {
        content.append(el('p', 'cig-source-description', `Riscontro presente in ${group.evidences.length} estrazioni del dataset.`));
      }
      const semanticEvidence = group.evidences.find((evidence) => evidence.relation === 'semantic_candidate');
      const explanation = semanticEvidence && semanticExplanation(semanticEvidence);
      if (explanation) {
        content.append(el('p', 'cig-evidence-label', 'Perché potrebbe riguardare il progetto · valutazione automatica'));
        content.append(el('p', 'cig-source-reason', explanation));
      }
      const textEvidence = group.evidences.find((evidence) =>
        ['semantic_candidate', 'saturn_historical_same_record', 'cup_in_listing_text', 'source_explicit_cup'].includes(evidence.relation)
        && evidence.text);
      if (textEvidence) {
        const details = el('details', 'cig-evidence-details');
        const textLabel = textEvidence.relation === 'semantic_candidate'
          ? group.id === 'anac_superset_appalti' ? 'Oggetto della gara nei dati ANAC' : 'Oggetto della gara nella fonte'
          : textEvidence.relation === 'saturn_historical_same_record' ? 'Testo dell’atto pubblicato' : 'Testo pubblicato nella fonte';
        details.append(el('summary', '', textLabel));
        details.append(el('p', '', textEvidence.text));
        content.append(details);
      }
      if (!group.evidences.length) {
        const noCup = detail.anac_cup_status === 'anac_does_not_report_cup'
          && ['anac_smartcig', 'anac_dettaglio_cig_browser'].includes(group.id);
        const description = noCup ? 'La scheda acquisita non riporta il CUP del progetto.'
          : group.id === 'anac_superset_aggiudicatari'
            ? 'Dati sugli operatori economici; nessuna evidenza sul collegamento CUP–CIG.'
            : 'Dati della procedura; nessuna evidenza di collegamento registrata per questa fonte.';
        content.append(el('p', 'cig-source-description', description));
      }
      for (const [index, url] of [...group.urls].entries()) {
        const linkLabel = group.id === 'anac_superset_appalti' ? 'Apri dashboard ANAC ↗'
          : group.urls.size > 1 ? `Apri fonte ${index + 1} ↗` : 'Apri fonte ↗';
        const link = el('a', 'detail-data-link cig-source-link', linkLabel);
        link.href = url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        content.append(link);
      }
      item.append(content);
      list.append(item);
    }
    section.append(list);
  }
  return section;
}

function detailLabel(key) {
  return detailLabels[key] || String(key).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replaceAll('_', ' ')
    .replace(/^./, (letter) => letter.toUpperCase());
}

function hasDetailValue(value) {
  if (value === null || value === undefined || value === '') return false;
  if (Array.isArray(value)) return value.some(hasDetailValue);
  if (typeof value === 'object') return Object.values(value).some(hasDetailValue);
  return true;
}

function detailScalar(value, key = '') {
  let text = String(value);
  if (/^DATA_|_date$|_deadline$/.test(key)) text = dateLabel(text);
  if ((key.startsWith('IMPORTO_') || key === 'amount') && Number.isFinite(Number(value))) text = formatAmount(value);
  if (/^https?:\/\//i.test(text)) {
    const linkText = /url/i.test(key) ? (/document/i.test(key) ? 'Apri documento ↗' : 'Apri fonte ↗') : text;
    const link = el('a', 'detail-data-link', linkText);
    link.href = text;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    return link;
  }
  return document.createTextNode(text);
}

function detailValue(value, key = '') {
  if (Array.isArray(value)) {
    const list = el('ul', 'detail-value-list');
    for (const item of value) {
      if (!hasDetailValue(item)) continue;
      const listItem = document.createElement('li');
      if (Array.isArray(item)) listItem.append(detailValue(item, key));
      else if (item && typeof item === 'object') listItem.append(detailObject(item));
      else listItem.append(detailScalar(item, key));
      list.append(listItem);
    }
    return list;
  }
  if (value && typeof value === 'object') return detailObject(value);
  return detailScalar(value, key);
}

function detailObject(value) {
  const list = el('dl', 'detail-data-list');
  for (const [key, item] of Object.entries(value)) {
    if (/^(field_provenance|requested_at_utc)$/i.test(key) || /(^|_)(?:raw_)?(?:detail|json|html|file|local)?_?path(?:_|$)/i.test(key)) continue;
    if (typeof item === 'string' && /^(?:\/(?:home|Users|tmp|var|mnt|workspace)\/|[A-Za-z]:\\)/.test(item)) continue;
    if (!hasDetailValue(item)) continue;
    list.append(el('dt', '', detailLabel(key)));
    const definition = document.createElement('dd');
    definition.append(key === 'provider' ? document.createTextNode(sourceName(item)) : detailValue(item, key));
    list.append(definition);
  }
  return list;
}

function detailSection(title, value, wide = false) {
  if (!hasDetailValue(value)) return null;
  const section = collapsibleSection(title, wide);
  section.append(detailObject(value));
  return section;
}

function collapsibleSection(title, wide = false) {
  const section = el('details', 'cig-detail-section' + (wide ? ' is-wide' : ''));
  const summary = el('summary', 'cig-section-summary');
  summary.append(el('h4', '', title));
  section.append(summary);
  return section;
}

function makeCigDetailPanel(procedure, pipelineRecord, mobile = false) {
  const panel = el('div', 'cig-detail-panel');
  const panelId = (mobile ? 'mobile-cig-detail-' : 'cig-detail-') + String(procedure.cig || '').replace(/[^A-Za-z0-9_-]/g, '-');
  panel.id = panelId;
  panel.setAttribute('role', 'region');
  panel.setAttribute('aria-label', 'Dettaglio completo CIG ' + (procedure.cig || ''));
  const toolbar = el('div', 'cig-detail-toolbar');
  toolbar.append(el('h3', 'cig-detail-title', 'Dettaglio CIG ' + (procedure.cig || '')));
  const toggleAll = el('button', 'cig-sections-toggle', 'Espandi tutte');
  toggleAll.type = 'button';
  toolbar.append(toggleAll);
  panel.append(toolbar);
  const sections = el('div', 'cig-detail-sections');
  const association = pipelineRecord?.association || {};
  const detail = pipelineRecord?.detail || {};
  const smartcig = detail.smartcig_like || {};
  const procedureData = {
    CIG: procedure.cig,
    tender_object: procedure.tender_object,
    lot_object: procedure.lot_object,
    framework_cig: procedure.framework_cig,
    publication_date: procedure.publication_date,
    offer_deadline: procedure.offer_deadline,
    result_communication_date: procedure.result_communication_date,
    amount: procedure.amount,
    source_url: procedure.source_url,
  };
  const bando = selectedFields(smartcig.bando, [
    'CIG', 'CIG_ACCORDO_QUADRO', 'CUP', 'NUMERO_GARA', 'OGGETTO_GARA', 'OGGETTO_LOTTO',
    'TIPO_CIG', 'TIPO_SCELTA_CONTRAENTE', 'MODALITA_REALIZZAZIONE', 'STRUMENTO_SVOLGIMENTO',
    'ESITO', 'STATO', 'SETTORE', 'OGGETTO_PRINCIPALE_CONTRATTO', 'IMPORTO_COMPLESSIVO_GARA',
    'IMPORTO_LOTTO', 'IMPORTO_SICUREZZA', 'DATA_SCADENZA_OFFERTA', 'ORA_SCADENZA_OFFERTA',
    'DATA_COMUNICAZIONE_ESITO', 'DURATA_PREVISTA', 'N_LOTTI_COMPONENTI', 'SIGLA_PROVINCIA', 'CPV',
  ]);
  const publicationData = selectedFields(smartcig.pubblicazioni, ['DATA_CREAZIONE', 'DATA_PUBBLICAZIONE']);
  const stationData = selectedFields(smartcig.stazione_appaltante, [
    'DENOMINAZIONE_AMMINISTRAZIONE_APPALTANTE', 'CF_AMMINISTRAZIONE_APPALTANTE',
    'DENOMINAZIONE_CENTRO_COSTO', 'CITTA', 'SIGLA_PROVINCIA', 'REGIONE', 'INDIRIZZO',
  ]);
  const enrichment = smartcig.enrichment || {};
  const awardData = selectedFields(enrichment, [
    'IMPORTO_AGGIUDICAZIONE', 'IMPORTO_LIQUIDATO', 'DATA_AGGIUDICAZIONE_DEFINITIVA', 'awards',
  ]);
  const contractData = selectedFields(enrichment, [
    'DATA_INIZIO', 'DATA_FINE', 'contract_starts', 'contract_ends', 'testing', 'work_progress',
    'subcontracts', 'suspensions', 'extensions', 'variations', 'financial_framework',
    'work_categories', 'dpcm_aggregation_categories', 'funding_sources', 'work_types',
  ]);
  const documents = [
    ...(Array.isArray(smartcig.documenti) ? smartcig.documenti : []),
    ...(Array.isArray(detail.documents) ? detail.documents : []),
  ];
  const operatorProvenance = smartcig.source?.field_provenance?.operatori_economici;
  const operatorProvider = typeof operatorProvenance === 'string'
    ? operatorProvenance.split('.')[0] : operatorProvenance?.provider;
  const operatorData = {
    operator_source: operatorProvider === 'anac_superset_aggiudicatari'
      ? 'ANAC Analytics, dati su partecipanti e aggiudicatari' : '',
    operatori_economici: smartcig.operatori_economici,
  };
  const definitions = [
    ['Dati della procedura', procedureData, true],
    ['Gara e affidamento', bando, true],
    ['Date e pubblicazioni', publicationData],
    ['Amministrazione appaltante', stationData],
    ['Referenti della procedura', { incaricati: smartcig.incaricati }],
    ['Operatori economici', operatorData],
    ['Aggiudicazione', awardData, true],
    ['Contratto e avanzamento', contractData, true],
    ['Documenti', { documenti: documents }],
  ];
  for (const [title, value, wide] of definitions) {
    const section = detailSection(title, value, wide);
    if (section) sections.append(section);
  }
  const sources = sourceSection(
    procedure, pipelineRecord, smartcig,
    associationForDisplay(association),
  );
  if (sources) sections.append(sources);
  if (!sections.childElementCount) sections.append(el('p', 'empty-state', 'Non sono disponibili altri dettagli per questo CIG.'));
  const collapsibleSections = [...sections.children].filter((item) => item.tagName === 'DETAILS');
  function updateToggleAll() {
    const allCollapsed = collapsibleSections.every((item) => !item.open);
    toggleAll.textContent = allCollapsed ? 'Espandi tutte' : 'Comprimi tutte';
    toggleAll.setAttribute('aria-label', `${toggleAll.textContent} le sezioni del CIG ${procedure.cig || ''}`);
  }
  for (const section of collapsibleSections) section.addEventListener('toggle', updateToggleAll);
  toggleAll.addEventListener('click', () => {
    const expand = collapsibleSections.every((item) => !item.open);
    for (const section of collapsibleSections) section.open = expand;
    updateToggleAll();
  });
  toggleAll.hidden = !collapsibleSections.length;
  updateToggleAll();
  panel.append(sections);
  return panel;
}

function makeCigDetailRow(procedure, pipelineRecord, columnCount) {
  const row = el('tr', 'cig-detail-row');
  const cell = document.createElement('td');
  cell.colSpan = columnCount;
  cell.append(makeCigDetailPanel(procedure, pipelineRecord));
  row.append(cell);
  return row;
}

function activateTab(tab, tabs, panels) {
  for (const item of tabs) {
    const selected = item === tab;
    item.setAttribute('aria-selected', String(selected));
    item.classList.toggle('is-active', selected);
    item.tabIndex = selected ? 0 : -1;
  }
  for (const panel of panels) panel.hidden = panel.id !== tab.getAttribute('aria-controls');
}

function renderProject(data) {
  results.replaceChildren();
  const profile = data.project_profile || {};
  const project = profile.project || {};
  const procedures = data.procedures || [];
  const proceduresAvailable = data.procedures_available;
  const card = el('article', 'project-card');
  card.append(el('div', 'result-kicker', 'Informazioni del progetto'));

  const heading = el('div', 'project-heading');
  const headingText = el('div');
  headingText.append(el('h2', '', project['Titolo Progetto'] || project['Descrizione Misura'] || 'Progetto associato al CUP'));
  if (project['Sintesi Progetto']) headingText.append(el('p', 'project-description', project['Sintesi Progetto']));
  heading.append(headingText, el('span', 'cup-code', data.cup));
  card.append(heading);

  const subjectSummary = Array.isArray(profile.soggetti_attuatori) ? profile.soggetti_attuatori.join(', ') : project['Soggetto Attuatore'];
  const meta = el('div', 'project-meta');
  for (const [label, value] of [
    ['Soggetto attuatore', subjectSummary], ['Comune', project['Descrizione Comune']],
    ['Provincia', project['Descrizione Provincia']], ['Regione', project['Descrizione Regione']],
  ]) if (value) meta.append(el('span', '', label + ': ' + value));
  card.append(meta);

  const tabs = el('div', 'result-tabs');
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', 'Sezioni informazioni del progetto');
  const overviewTab = el('button', 'result-tab is-active', 'Panoramica');
  overviewTab.type = 'button';
  overviewTab.id = 'tab-overview';
  overviewTab.setAttribute('role', 'tab');
  overviewTab.setAttribute('aria-selected', 'true');
  overviewTab.setAttribute('aria-controls', 'panel-overview');
  overviewTab.tabIndex = 0;
  const proceduresTab = el('button', 'result-tab', 'Procedure e CIG ' + procedures.length);
  proceduresTab.type = 'button';
  proceduresTab.id = 'tab-procedures';
  proceduresTab.setAttribute('role', 'tab');
  proceduresTab.setAttribute('aria-selected', 'false');
  proceduresTab.setAttribute('aria-controls', 'panel-procedures');
  proceduresTab.tabIndex = -1;
  tabs.append(overviewTab, proceduresTab);
  card.append(tabs);

  const overviewPanel = el('section', 'tab-panel');
  overviewPanel.id = 'panel-overview';
  overviewPanel.setAttribute('role', 'tabpanel');
  overviewPanel.setAttribute('aria-labelledby', overviewTab.id);
  const summary = el('div', 'summary-grid');
  for (const [number, label] of [
    [profile.regis_row_count ?? '—', 'Righe progetto ReGiS'],
    [procedures.length, 'Procedure con CIG disponibili'],
    [data.app_snapshot?.procedure_details_available ?? 0, 'Schede gara con dati disponibili'],
  ]) {
    const item = el('div', 'summary-item');
    item.append(el('strong', '', number), el('span', '', label));
    summary.append(item);
  }
  overviewPanel.append(summary);
  const projectTitle = el('h3', 'section-title', 'Dati identificativi');
  overviewPanel.append(projectTitle);
  const projectGrid = el('div', 'detail-grid project-fields');
  for (const [label, value] of Object.entries(project)) {
    if (value !== undefined && value !== null && value !== '') addField(projectGrid, label, value);
  }
  for (const [label, value] of Object.entries(profile)) {
    if (label === 'project' || label === 'projects' || value === undefined || value === null || value === '') continue;
    addField(projectGrid, label.replaceAll('_', ' '), value);
  }
  overviewPanel.append(projectGrid);
  if (profile.projects?.length > 1) {
    overviewPanel.append(el('h3', 'section-title', repositoryMessages.canonicalProjects));
    for (const canonicalProject of profile.projects) {
      const section = el('details', 'cig-section');
      section.append(el('summary', '', repositoryMessages.project + ' ' + canonicalProject['Codice Locale Progetto']));
      const fields = el('div', 'detail-grid project-fields');
      for (const [label, value] of Object.entries(canonicalProject)) addField(fields, label, value);
      section.append(fields);
      overviewPanel.append(section);
    }
  }

  const proceduresPanel = el('section', 'tab-panel');
  proceduresPanel.id = 'panel-procedures';
  proceduresPanel.hidden = true;
  proceduresPanel.setAttribute('role', 'tabpanel');
  proceduresPanel.setAttribute('aria-labelledby', proceduresTab.id);
  const title = el('h3', 'section-title');
  title.append(el('span', '', 'Procedure di gara'));
  proceduresPanel.append(title);
  if (proceduresAvailable && procedures.length) {
    const tableWrap = el('div', 'table-scroll');
    const table = el('table', 'cig-table');
    const head = document.createElement('thead');
    const headerRow = document.createElement('tr');
    const tableColumns = [
      ['cig', 'CIG'], ['tender_object', 'Oggetto gara'], ['lot_object', 'Oggetto lotto'],
      ['framework_cig', 'CIG accordo quadro'], ['publication_date', 'Pubblicazione bando'],
      ['offer_deadline', 'Scadenza offerte'], ['result_communication_date', 'Comunicazione esito'],
      ['amount', 'Importo lotto'], ['provenance', 'Come è collegato'], ['source_url', 'Fonte principale'],
    ];
    const headers = new Map();
    const pipelineRecords = new Map((data.cigs || []).map((record) => [String(record.cig || '').toUpperCase(), record]));
    let sortState = { key: '', direction: 1 };
    for (const [key, label] of tableColumns) {
      const header = document.createElement('th');
      header.scope = 'col';
      header.setAttribute('aria-sort', 'none');
      const button = el('button', 'sort-button', label + ' ↕');
      button.type = 'button';
      button.addEventListener('click', () => {
        sortState = { key, direction: sortState.key === key ? -sortState.direction : 1 };
        for (const [column, item] of headers) {
          const active = column === key;
          item.th.setAttribute('aria-sort', active ? (sortState.direction === 1 ? 'ascending' : 'descending') : 'none');
          item.button.textContent = item.label + (active ? (sortState.direction === 1 ? ' ↑' : ' ↓') : ' ↕');
        }
        const collator = new Intl.Collator('it', { numeric: true, sensitivity: 'base' });
        const ordered = [...procedures].sort((left, right) => {
          const a = String(left[key] || '').trim();
          const b = String(right[key] || '').trim();
          if (!a || !b) return !a && !b ? 0 : (!a ? 1 : -1);
          if (['publication_date', 'offer_deadline', 'result_communication_date'].includes(key)) {
            return (a < b ? -1 : a > b ? 1 : 0) * sortState.direction;
          }
          if (key === 'amount') {
            const numberA = Number(a.includes(',') ? a.replaceAll('.', '').replace(',', '.') : a);
            const numberB = Number(b.includes(',') ? b.replaceAll('.', '').replace(',', '.') : b);
            if (Number.isFinite(numberA) && Number.isFinite(numberB)) return (numberA - numberB) * sortState.direction;
          }
          return collator.compare(a, b) * sortState.direction;
        });
        body.replaceChildren(...ordered.map(makeProcedureRow));
      });
      header.append(button);
      headers.set(key, { th: header, button, label });
      headerRow.append(header);
    }
    head.append(headerRow);
    table.append(head);
    const body = document.createElement('tbody');
    function expandableCell(value, className = '') {
      const cell = el('td', className);
      const toggle = el('button', 'cell-expand-toggle', value || '—');
      toggle.type = 'button';
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-label', (value || 'Valore vuoto') + '. Clicca per espandere o comprimere.');
      toggle.addEventListener('click', () => {
        const expanded = cell.classList.toggle('is-expanded');
        toggle.setAttribute('aria-expanded', String(expanded));
      });
      cell.append(toggle);
      return cell;
    }
    function makeProcedureRow(procedure) {
      const row = document.createElement('tr');
      const cigCell = el('td', 'cig-table-code');
      const detailToggle = el('button', 'cig-detail-toggle', procedure.cig || '—');
      detailToggle.type = 'button';
      detailToggle.setAttribute('aria-expanded', 'false');
      detailToggle.setAttribute('aria-controls', 'cig-detail-' + String(procedure.cig || '').replace(/[^A-Za-z0-9_-]/g, '-'));
      detailToggle.setAttribute('aria-label', 'Mostra il dettaglio del CIG ' + (procedure.cig || ''));
      detailToggle.addEventListener('click', () => {
        const expandedRow = row.nextElementSibling?.classList.contains('cig-detail-row') ? row.nextElementSibling : null;
        if (expandedRow) {
          expandedRow.remove();
          detailToggle.setAttribute('aria-expanded', 'false');
          detailToggle.setAttribute('aria-label', 'Mostra il dettaglio del CIG ' + (procedure.cig || ''));
          return;
        }
        for (const openRow of body.querySelectorAll('.cig-detail-row')) openRow.remove();
        for (const openToggle of body.querySelectorAll('.cig-detail-toggle')) {
          openToggle.setAttribute('aria-expanded', 'false');
          openToggle.setAttribute('aria-label', 'Mostra il dettaglio del CIG ' + openToggle.textContent.trim());
        }
        const pipelineRecord = pipelineRecords.get(String(procedure.cig || '').toUpperCase());
        row.after(makeCigDetailRow(procedure, pipelineRecord, tableColumns.length));
        detailToggle.setAttribute('aria-expanded', 'true');
        detailToggle.setAttribute('aria-label', 'Nascondi il dettaglio del CIG ' + (procedure.cig || ''));
      });
      cigCell.append(detailToggle);
      row.append(cigCell);
      row.append(expandableCell(procedure.tender_object, 'cig-table-object'));
      row.append(expandableCell(procedure.lot_object, 'cig-table-object'));
      row.append(el('td', 'cig-table-code', procedure.framework_cig || '—'));
      row.append(el('td', 'cig-table-date', dateLabel(procedure.publication_date)));
      row.append(el('td', 'cig-table-date', dateLabel(procedure.offer_deadline)));
      row.append(el('td', 'cig-table-date', dateLabel(procedure.result_communication_date)));
      row.append(el('td', 'cig-table-amount', formatAmount(procedure.amount)));
      const labels = provenanceForDisplay(procedure.provenance).split(';').map((label) => label.trim()).filter(Boolean);
      row.append(expandableCell(labels.join(' · '), 'cig-table-provenance'));
      const sourceCell = document.createElement('td');
      if (procedure.source_url) {
        const link = el('a', 'source-link', 'Apri fonte ↗');
        link.href = procedure.source_url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.setAttribute('aria-label', 'Apri la fonte del CIG ' + (procedure.cig || ''));
        sourceCell.append(link);
      } else {
        sourceCell.textContent = '—';
      }
      row.append(sourceCell);
      return row;
    }
    body.replaceChildren(...procedures.map(makeProcedureRow));
    table.append(body);
    tableWrap.append(table);
    proceduresPanel.append(tableWrap);

    const mobileList = el('div', 'mobile-procedure-list');
    for (const procedure of procedures) {
      const card = el('details', 'mobile-procedure-card');
      const summary = el('summary', 'mobile-procedure-summary');
      const heading = el('span', 'mobile-procedure-heading');
      heading.append(el('strong', 'mobile-procedure-code', procedure.cig || '—'));
      heading.append(el('span', 'mobile-procedure-arrow', '⌄'));
      summary.append(heading);
      summary.append(el('span', 'mobile-procedure-object', procedure.tender_object || procedure.lot_object || 'Oggetto non disponibile'));
      const facts = el('span', 'mobile-procedure-facts');
      if (procedure.amount) facts.append(el('span', '', 'Importo: ' + formatAmount(procedure.amount)));
      if (procedure.publication_date) facts.append(el('span', '', 'Pubblicazione: ' + dateLabel(procedure.publication_date)));
      summary.append(facts);
      card.append(summary);
      card.addEventListener('toggle', () => {
        if (!card.open || card.querySelector('.cig-detail-panel')) return;
        const pipelineRecord = pipelineRecords.get(String(procedure.cig || '').toUpperCase());
        card.append(makeCigDetailPanel(procedure, pipelineRecord, true));
      });
      mobileList.append(card);
    }
    proceduresPanel.append(mobileList);
  } else if (data.collection_status === 'not_collected') {
    proceduresPanel.append(el('p', 'empty-state', repositoryMessages.notCollected));
  } else if (data.collection_status === 'awaiting_review') {
    proceduresPanel.append(el('p', 'empty-state', repositoryMessages.awaitingReview));
  } else if (data.collection_status === 'reviewed_empty') {
    proceduresPanel.append(el('p', 'empty-state', repositoryMessages.reviewedEmpty));
  } else if (proceduresAvailable) {
    proceduresPanel.append(el('p', 'empty-state', 'Non sono state trovate procedure con CIG per questo progetto.'));
  } else {
    proceduresPanel.append(el('p', 'empty-state', 'Le informazioni sulle procedure non sono disponibili per questo progetto.'));
  }

  card.append(overviewPanel, proceduresPanel);
  results.append(card);
  results.hidden = false;

  const allTabs = [overviewTab, proceduresTab];
  const allPanels = [overviewPanel, proceduresPanel];
  for (const tab of allTabs) {
    tab.addEventListener('click', () => activateTab(tab, allTabs, allPanels));
    tab.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      let targetIndex = allTabs.indexOf(tab);
      if (event.key === 'ArrowLeft') targetIndex = (targetIndex + allTabs.length - 1) % allTabs.length;
      if (event.key === 'ArrowRight') targetIndex = (targetIndex + 1) % allTabs.length;
      if (event.key === 'Home') targetIndex = 0;
      if (event.key === 'End') targetIndex = allTabs.length - 1;
      allTabs[targetIndex].focus();
      activateTab(allTabs[targetIndex], allTabs, allPanels);
    });
  }
}

async function searchCup(cup) {
  await messagesReady;
  const normalized = cup.trim().toUpperCase();
  input.value = normalized;
  results.hidden = true;
  message.hidden = true;
  if (!/^[A-Z0-9]{15}$/.test(normalized)) {
    showMessage('Controlla il codice: un CUP è composto da 15 caratteri alfanumerici.', true);
    return;
  }
  showMessage('Sto cercando i dati locali…');
  try {
    const response = await fetch('/api/cup/' + encodeURIComponent(normalized));
    if (response.status === 404) throw new Error(repositoryMessages.unknownCup);
    if (!response.ok) throw new Error('La richiesta non è andata a buon fine. Riprova tra poco.');
    const data = await response.json();
    message.hidden = true;
    renderProject(data);
    history.replaceState(null, '', '/?cup=' + encodeURIComponent(normalized));
    results.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    showMessage(error.message || 'Non è stato possibile leggere i dati.', true);
  }
}

form.addEventListener('submit', (event) => { event.preventDefault(); searchCup(input.value); });
examplesButton.addEventListener('click', () => {
  examples.hidden = !examples.hidden;
  examplesButton.innerHTML = examples.hidden ? 'CUP disponibili <span aria-hidden="true">⌄</span>' : 'Nascondi CUP disponibili <span aria-hidden="true">⌃</span>';
});

fetch('/api/cups').then((response) => {
  if (!response.ok) throw new Error('Data service is unavailable.');
  return response.json();
}).then(async ({ cups, data_source }) => {
  await messagesReady;
  const availableCups = cups || [];
  datasetCount.textContent = data_source === 'postgres'
    ? availableCups.length + ' ' + repositoryMessages.collectedCups
    : availableCups.length + ' CUP con dati già disponibili';
  examples.replaceChildren();
  for (const cup of availableCups) {
    const button = el('button', 'example-chip', cup);
    button.type = 'button';
    button.addEventListener('click', () => searchCup(cup));
    examples.append(button);
  }
  const initialCup = new URLSearchParams(location.search).get('cup');
  if (initialCup) searchCup(initialCup);
}).catch(() => { datasetCount.textContent = 'Archivio locale non raggiungibile'; });
