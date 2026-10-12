/* Current consultation sections, loaded by project key with complete pagination. */
window.aifelConsultation = (() => {
  let messages = {};
  const ready = fetch('/assets/consultation.it.json').then((response) => response.json())
    .then((value) => { messages = value; }).catch(() => {});
  const text = (key, fallback = key) => messages[key] || fallback;
  const node = (tag, className, value) => {
    const item = document.createElement(tag);
    item.className = className || '';
    if (value !== undefined) item.textContent = String(value);
    return item;
  };
  const sections = {
    locations: ['descrizione_regione', 'descrizione_provincia', 'descrizione_comune', 'regione', 'provincia', 'comune', 'indirizzo', 'cap', 'percentuale_localizzazione'],
    implementers: ['denominazione', 'codice_fiscale_soggetto', 'descrizione_ruolo_soggetto', 'descrizione_forma_giuridica', 'codice_ateco', 'ha_codice_fiscale_mascherato'],
    finance: ['finanziamento_totale', 'finanziamento_pubblico', 'finanziamento_pnrr', 'finanziamento_pnc', 'finanziamento_foi', 'pagamento_totale', 'pagamento_pnrr', 'percentuale_pagata_totale', 'percentuale_pagata_pnrr'],
    reporting: ['numero_rendiconti', 'numero_rendiconti_approvati', 'importo_rendicontato', 'importo_approvato', 'importo_pagato'],
    phases: ['codice_fase', 'descrizione_fase', 'data_inizio_prevista', 'data_inizio_effettiva', 'data_fine_prevista', 'data_fine_effettiva'],
    tenders: ['cig', 'codice_interno_pda', 'cig_accordo_quadro', 'oggetto_gara', 'importo_complessivo_gara', 'importo_aggiudicazione', 'data_aggiudicazione_definitiva'],
    awardees: ['cig', 'codice_interno_pda', 'denominazione_aggiudicatario', 'codice_fiscale_partita_iva', 'descrizione_ruolo_soggetto'],
    subcontractors: ['cig', 'codice_interno_pda', 'denominazione_subappaltatore', 'codice_fiscale_partita_iva_subappaltatore', 'descrizione_ruolo_soggetto_correlato'],
    indicators: ['indicator_type', 'codice_indicatore', 'descrizione_indicatore', 'descrizione_unita_misura', 'unita_misura', 'valore_programmato', 'valore_realizzato', 'anno', 'mese', 'mese_sorgente', 'observation_values'],
    measure_finance: ['descrizione_misura', 'descrizione_sub_misura', 'amministrazione_titolare', 'investimento_o_riforma', 'prestito_o_sovvenzione', 'importo_totale', 'importo_progetti_in_essere', 'importo_progetti_nuovi', 'importo_fsc'],
    activation: ['codice_pratt', 'titolo_procedura', 'tipo_procedura', 'importo_procedura', 'importo_impegnato', 'importo_disponibile', 'importo_convenzioni', 'numero_progetti', 'costo_ammesso_progetti', 'budget_submisura'],
    milestones: ['numero_sequenziale_milestone_target', 'nome_milestone_target', 'descrizione_specifica_milestone_target', 'ita_ue', 'indicatore_qualitativo', 'unita_misura_target', 'riferimento_partenza_target', 'valore_obiettivo_target', 'trimestre_conseguimento', 'anno_conseguimento'],
    common_mapping: ['codice_indicatore', 'descrizione_indicatore', 'unita_misura', 'stock_flusso'],
    target_mapping: ['numero_sequenziale_milestone_target', 'descrizione_milestone_target', 'codice_indicatore', 'descrizione_indicatore', 'unita_misura', 'obiettivo', 'anno_obiettivo', 'trimestre_obiettivo'],
    monitoring: ['codice_indicatore', 'descrizione_indicatore', 'unita_misura', 'definizione', 'nota', 'target', 'des_target', 'goal', 'des_goal', 'data_aggiornamento'],
    measure_progress: ['codice_indicatore', 'descrizione_indicatore', 'unita_misura', 'anno', 'semestre', 'valore_indicatore', 'valore_stimato_flag', 'valore_non_disponibile'],
    measure_tags: ['campo_intervento_clima', 'coefficiente_tag_clima', 'campo_intervento_digitale', 'coefficiente_tag_digitale', 'importo_contribuzione_clima', 'importo_contribuzione_digitale'],
  };
  const context = ['measure_finance', 'activation', 'milestones', 'common_mapping', 'target_mapping', 'monitoring', 'measure_progress', 'measure_tags'];
  const quantityFields = new Set(['valore_programmato', 'valore_realizzato', 'valore_indicatore',
    'riferimento_partenza_target', 'valore_obiettivo_target', 'obiettivo',
    'coefficiente_tag_clima', 'coefficiente_tag_digitale']);
  const quantityFormat = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 20 });
  function display(key, value) {
    if (value === null || value === undefined || value === '') return text('missing', 'Unavailable');
    if (typeof value === 'boolean') return text(value ? 'yes' : 'no', value ? 'Yes' : 'No');
    if (key.startsWith('data_')) return dateLabel(value);
    if (/^(importo_|finanziamento_|pagamento_|costo_|budget_)/.test(key)) return formatAmount(value);
    if (key.startsWith('percentuale_')) return new Intl.NumberFormat('it-IT', { maximumFractionDigits: 2 }).format(Number(value)) + '%';
    if (quantityFields.has(key) && /^[+-]?\d+(?:\.\d+)?$/.test(String(value))) return quantityFormat.format(value);
    if (key === 'indicator_type') return text(value, value);
    return String(value);
  }
  function renderRow(row, sectionName, options = {}) {
    const card = node('article', 'consultation-row');
    const source = row.source === 'regis' ? 'ReGiS' : text('openData', 'Open Data');
    const date = row.source_reference_date ? dateLabel(row.source_reference_date) : text('dateUnavailable', 'Reference date unavailable');
    const version = row.source_version ? ' · ' + text('version', 'Version') + ' ' + row.source_version : '';
    if (!options.hideSource) card.append(node('p', 'consultation-source', source + ' · ' + text(row.source_dataset, row.source_dataset) + ' · ' + date + version));
    if (row.measure_key) card.append(node('p', 'consultation-source', text(row.measure_key[0], row.measure_key[0]) + ': ' + row.measure_key[1]));
    if (row.ordering_method === 'between_dated_versions') {
      card.append(node('p', 'consultation-note', text('betweenVersions', 'Version between') + ' ' + dateLabel(row.previous_reference_date) + ' – ' + dateLabel(row.next_reference_date)));
    }
    const grid = node('dl', 'consultation-fields');
    const extra = node('dl', 'consultation-fields');
    const essential = (key) => /^(importo_|finanziamento_|pagamento_|percentuale_|valore_programmato|valore_realizzato)/.test(key)
      || ['denominazione', 'denominazione_aggiudicatario', 'denominazione_subappaltatore'].includes(key);
    for (const key of sections[sectionName]) {
      if (options.omitFields?.includes(key)) continue;
      if (!(key in row)) continue;
      if (key === 'observation_values') {
        if (row[key]) for (const [label, value] of Object.entries(row[key])) {
          const cell = node('div', 'consultation-field');
          cell.append(node('dt', '', label), node('dd', '', value === null ? text('missing', 'Unavailable') : value));
          grid.append(cell);
        }
        continue;
      }
      const cell = node('div', 'consultation-field');
      cell.append(node('dt', '', text(key, key.replaceAll('_', ' '))), node('dd', '', display(key, row[key])));
      const missing = row[key] === null || row[key] === undefined || row[key] === '';
      (missing && !essential(key) ? extra : grid).append(cell);
    }
    card.append(grid);
    if (extra.childElementCount) {
      const details = node('details', 'optional-fields');
      details.append(node('summary', '', text('showAllFields', 'Show all fields') + ' (' + extra.childElementCount + ')'), extra);
      card.append(details);
    }
    for (const key of ['payment_ratio_status', 'pnrr_payment_ratio_status']) {
      const status = row[key];
      if (status && !['missing', 'comparable'].includes(status)) {
        card.append(node('p', 'consultation-note', (key.startsWith('pnrr') ? 'PNRR · ' : '') + text(status, status)));
      }
    }
    if (row.period_is_calendar === false) card.append(node('p', 'consultation-note', text('nonCalendar', 'The source period is not a calendar month.')));
    if (row.location_representation === 'project_territory_text') card.append(node('p', 'consultation-note', text('territoryText', 'Territory reported by ReGiS; may include several municipalities.')));
    return card;
  }
  function section(cup, project, name, isContext = false, options = {}) {
    const details = node('details', 'consultation-section');
    const count = project.sections[name] || 0;
    const heading = node('summary', '', text(name, name) + (!isContext ? ' (' + count + ')' : ''));
    const body = node('div', 'consultation-body');
    details.append(heading, body);
    let loaded = false;
    let offset = 0;
    let loading = false;
    async function load() {
      if (loading) return;
      loading = true;
      const status = node('p', 'consultation-note', text('loading', 'Loading…'));
      body.append(status);
      try {
        const query = new URLSearchParams({ clp: project.codice_locale_progetto, section: name, offset: String(offset), limit: '100' });
        const response = await fetch('/api/cup/' + encodeURIComponent(cup) + '/consultation?' + query);
        if (!response.ok) throw new Error('Consultation request failed.');
        const page = await response.json();
        loaded = true;
        offset += page.rows.length;
        status.remove();
        if (options.renderRows && page.rows.length) body.append(options.renderRows(page.rows));
        else for (const row of page.rows) body.append(renderRow(row, name));
        if (page.total === 0) body.append(node('p', 'consultation-note', text('noData', 'No data is available for this section.')));
        if (page.total > 0) {
          const progress = node('p', 'consultation-note', offset + ' / ' + page.total + ' ' + text('records', 'records'));
          body.append(progress);
          if (offset < page.total) {
            const more = node('button', 'text-button consultation-more', text('loadMore', 'Load more'));
            more.type = 'button';
            more.addEventListener('click', () => { more.remove(); progress.remove(); load(); });
            body.append(more);
          }
        }
      } catch (error) {
        status.textContent = text('loadError', 'Unable to load this section.');
        const retry = node('button', 'text-button', text('retry', 'Retry'));
        retry.type = 'button';
        retry.addEventListener('click', () => { status.remove(); retry.remove(); load(); });
        body.append(retry);
      } finally { loading = false; }
    }
    details.addEventListener('toggle', () => { if (details.open && !loaded) load(); });
    return details;
  }
  async function mount(panel, data) {
    if (!data.consultation?.available) return;
    await ready;
    if (!panel.isConnected) return;
    const root = node('section', 'consultation-projects');
    root.append(node('h3', 'section-title', text('projectDetails', 'Current project data')));
    root.append(node('p', 'consultation-note', text('sourceNotice', 'Latest available observation for each project and source. Amounts are not summed across CLPs.')));
    for (const project of data.consultation.projects) {
      const article = node('article', 'consultation-project');
      article.append(node('h4', '', 'CLP ' + project.codice_locale_progetto));
      article.append(node('p', 'consultation-source', (project.source === 'regis' ? 'ReGiS' : text('openData', 'Open Data')) + ' · ' + (project.source_reference_date ? dateLabel(project.source_reference_date) : text('dateUnavailable', 'Reference date unavailable'))));
      if (!project.has_project_profile) article.append(node('p', 'consultation-note', text('incompleteProfile', 'The project key is known from detail data; its project profile is unavailable.')));
      for (const name of Object.keys(sections).filter((item) => !context.includes(item))) article.append(section(data.cup, project, name));
      const measure = node('details', 'consultation-section');
      measure.append(node('summary', '', text('measureContext', 'Measure context')));
      const content = node('div', 'consultation-body');
      content.append(node('p', 'consultation-note', text('measureNotice', 'These values concern the measure or submeasure, not this project.')));
      for (const name of context) content.append(section(data.cup, project, name, true));
      measure.append(content);
      article.append(measure);
      root.append(article);
    }
    panel.append(root);
  }
  return { mount, section, renderRow, display, ready, text, context };
})();
