/* CUP summary and separate consultation workspaces for each native CLP. */
window.aifelProjectNavigation = (() => {
  const consultation = window.aifelConsultation;
  const t = (key, fallback = key) => consultation.text(key, fallback);
  const make = (tag, className, value) => {
    const item = document.createElement(tag);
    if (className) item.className = className;
    if (value !== undefined) item.textContent = String(value);
    return item;
  };
  const tabNames = ['overview', 'subjects', 'financial', 'procurement', 'progress', 'questions', 'measure'];
  const shortTitle = (project) => {
    const title = project.titolo_progetto || t('incompleteTitle', 'Project profile unavailable');
    return title.length > 65 ? title.slice(0, 62) + '…' : title;
  };
  function wireTabs(tabs, panels, select) {
    tabs.forEach((tab, index) => {
      tab.addEventListener('click', () => select(index));
      tab.addEventListener('keydown', (event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const target = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
          : (index + (event.key === 'ArrowLeft' ? -1 : 1) + tabs.length) % tabs.length;
        tabs[target].focus();
        select(target);
      });
    });
  }
  function tabsInto(host, items, prefix, initial = 0) {
    const bar = make('div', 'result-tabs');
    bar.setAttribute('role', 'tablist');
    bar.setAttribute('aria-label', t('sectionNavigation', 'Project sections'));
    const tabs = [], panels = [], loaded = new Set();
    items.forEach((item, index) => {
      const tab = make('button', 'result-tab', item.label);
      tab.type = 'button';
      tab.id = prefix + '-tab-' + index;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-controls', prefix + '-panel-' + index);
      const panel = make('section', 'tab-panel');
      panel.id = prefix + '-panel-' + index;
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', tab.id);
      bar.append(tab);
      tabs.push(tab); panels.push(panel);
    });
    host.append(bar, ...panels);
    function select(index) {
      activateTab(tabs[index], tabs, panels);
      if (!loaded.has(index)) {
        loaded.add(index);
        items[index].render(panels[index]);
      }
    }
    wireTabs(tabs, panels, select);
    select(initial);
    return { select, panels };
  }
  function disclosure(panel, cup, project, names, openFirst = false) {
    names.forEach((name, index) => {
      const item = consultation.section(cup, project, name, consultation.context.includes(name));
      panel.append(item);
      if (openFirst && index === 0) item.open = true;
    });
  }
  async function mount(host, data) {
    await consultation.ready;
    if (!host.isConnected) return;
    const projects = data.consultation.projects;
    const cache = new Map();
    const page = (project, name, offset = 0, limit = 100, source = null) => {
      const params = new URLSearchParams({clp: project.codice_locale_progetto, section: name,
        offset: String(offset), limit: String(limit)});
      if (source) params.set('source', source);
      const key = params.toString();
      if (!cache.has(key)) cache.set(key, fetch('/api/cup/' + encodeURIComponent(data.cup) + '/consultation?' + key)
        .then((response) => { if (!response.ok) throw new Error('Consultation request failed.'); return response.json(); })
        .catch((error) => { cache.delete(key); throw error; }));
      return cache.get(key);
    };
    function asyncInto(panel, action) {
      const state = make('p', 'consultation-note', t('loading', 'Loading…'));
      panel.append(state);
      async function run() {
        state.textContent = t('loading', 'Loading…');
        try { await action(); state.remove(); }
        catch (error) {
          state.textContent = t('loadError', 'Unable to load this section.');
          const retry = make('button', 'text-button', t('retry', 'Retry'));
          retry.type = 'button';
          retry.addEventListener('click', () => { retry.remove(); run(); });
          state.append(retry);
        }
      }
      run();
    }
    async function implementingNames(panel, project, asField = false) {
      const result = await page(project, 'implementers', 0, 100);
      const names = [...new Set(result.rows.map((row) => row.denominazione).filter(Boolean))];
      panel.append(make('p', 'implementer-summary', (asField ? '' : t('implementerName', 'Implementing entity') + ': ')
        + (names.join(' · ') || t('missing', 'Unavailable'))));
      if (asField) {
        const sources = [...new Set(result.rows.map((row) =>
          (row.source === 'regis' ? 'ReGiS' : t('openData')) + ' · ' + dateLabel(row.source_reference_date)))];
        if (sources.length) panel.append(make('p', 'consultation-source', sources.join(' / ')));
      }
      if (result.total > result.rows.length) panel.append(make('p', 'consultation-note', t('moreSubjects', 'Further entities are available in the subjects section.')));
    }
    function locations(panel, project) {
      const content = make('div', 'location-summary');
      panel.append(content);
      asyncInto(content, async () => {
        const first = await page(project, 'locations', 0, 5, 'open_data');
        if (!first.total) { content.append(make('p', 'consultation-note', t('openDataLocationsUnavailable'))); return; }
        let rows = first.rows;
        let expanded = false;
        const stats = make('p', 'consultation-note', first.total + ' ' + t('locationRecords', 'source location records'));
        stats.hidden = first.total === 1;
        const list = make('div', 'compact-locations');
        const filter = make('input', 'location-filter');
        filter.type = 'search'; filter.placeholder = t('filterLocations', 'Search locations');
        filter.setAttribute('aria-label', filter.placeholder);
        filter.hidden = true;
        const render = () => {
          const query = filter.value.trim().toLocaleLowerCase('it');
          list.replaceChildren();
          const visibleRows = expanded ? rows : first.rows;
          for (const row of visibleRows.filter((row) => JSON.stringify(row).toLocaleLowerCase('it').includes(query))) {
            const item = make('div', 'compact-location');
            const territory = row.descrizione_comune || [row.regione, row.provincia, row.comune].filter(Boolean).join(' / ');
            item.append(make('p', 'location-place', territory || t('missing')));
            const address = [row.indirizzo, row.descrizione_provincia, row.descrizione_regione].filter(Boolean).join(' · ');
            if (address) item.append(make('p', 'location-address', address));
            if (row.percentuale_localizzazione != null) {
              const share = make('p', 'location-share');
              share.append(make('span', 'location-share-label', t('percentuale_localizzazione') + ': '),
                make('strong', '', consultation.display('percentuale_localizzazione', row.percentuale_localizzazione)));
              item.append(share);
            }
            const source = row.source === 'regis' ? 'ReGiS' : t('openData');
            item.append(make('span', 'consultation-source', source + ' · ' + dateLabel(row.source_reference_date)));
            if (row.location_representation === 'project_territory_text') item.append(make('span', 'consultation-note', t('territoryText')));
            list.append(item);
          }
          if (!list.childElementCount) list.append(make('p', 'consultation-note', t('noMatches', 'No matching results.')));
        };
        filter.addEventListener('input', render);
        content.append(stats, filter, list); render();
        if (first.total > rows.length) {
          const details = make('details', 'all-locations');
          details.append(make('summary', '', t('showAllLocations', 'Show all locations') + ' (' + first.total + ')'));
          const expandedContent = make('div'); details.append(expandedContent); content.append(details);
          let complete = false;
          details.addEventListener('toggle', () => {
            expanded = details.open;
            if (details.open) {
              expandedContent.append(filter, list);
              if (!complete) asyncInto(expandedContent, async () => {
                const full = [];
                for (let offset = 0; offset < first.total; offset += 100) {
                  full.push(...(await page(project, 'locations', offset, 100, 'open_data')).rows);
                }
                rows = full; complete = true; filter.hidden = !expanded;
                const regions = [...new Set(rows.map((row) => row.descrizione_regione).filter(Boolean))];
                stats.textContent = first.total + ' ' + t('locationRecords') + (regions.length ? ' · ' + regions.join(', ') : '');
                render();
              });
            } else {
              filter.hidden = true; filter.value = '';
              render();
              content.insertBefore(list, details);
            }
            if (details.open && complete) { filter.hidden = false; render(); }
          });
        }
      });
    }
    function overview(panel, project) {
      if (project.sintesi_progetto) panel.append(make('p', 'project-description', project.sintesi_progetto));
      const source = project.source === 'regis' ? 'ReGiS' : t('openData');
      panel.append(make('p', 'consultation-source', source + ' · ' + dateLabel(project.source_reference_date)));
      if (!project.has_project_profile) panel.append(make('p', 'consultation-note', t('incompleteProfile')));
      const box = (label, className = '') => {
        const section = make('section', 'overview-section overview-box ' + className);
        section.append(make('h3', 'section-title', label));
        panel.append(section);
        return section;
      };
      const progressSection = box(t('overviewProgress'), 'overview-progress');
      const phases = make('div', 'overview-phases'); progressSection.append(phases);
      for (const name of ['regis', 'open_data']) {
        const observation = project.phase_observations?.[name];
        const card = make('div', 'overview-metric phase-observation');
        const sourceName = name === 'regis' ? 'ReGiS' : t('openData');
        card.append(make('span', 'consultation-source', sourceName
          + (observation?.available ? ' · ' + (observation.reference_date ? dateLabel(observation.reference_date) : t('dateUnavailable')) : '')));
        if (observation?.available) {
          card.append(make('span', 'phase-field-name', observation.phase_field),
            make('strong', '', observation.phase_value ?? t('missing')));
        } else card.append(make('p', 'consultation-note', t(observation ? 'phaseSourceAbsent' : 'phasePublicationUnavailable')));
        phases.append(card);
      }
      const programme = box(t('overviewProgramme'));
      const programmeGrid = make('div', 'overview-programme-grid'); programme.append(programmeGrid);
      for (const [label, code, description] of [
        ['overviewMeasure', project.id_misura, project.descrizione_misura],
        ['overviewSubmeasure', project.id_submisura, project.descrizione_submisura],
        ['amministrazione_titolare', null, project.amministrazione_titolare],
      ]) {
        const field = make('div', 'overview-programme-field');
        field.append(make('h4', '', t(label)));
        if (code) field.append(make('span', 'programme-code', code));
        field.append(make('p', '', description || t('missing')));
        programmeGrid.append(field);
      }
      const territory = box(t('locations'), 'overview-location');
      locations(territory, project);
      const implementers = box(t('implementerName'), 'overview-implementers');
      asyncInto(implementers, async () => {
        const first = await page(project, 'implementers');
        const records = [...first.rows];
        for (let offset = first.rows.length; offset < first.total; offset += 100) {
          records.push(...(await page(project, 'implementers', offset)).rows);
        }
        const entities = new Map();
        for (const row of records) {
          const key = JSON.stringify([row.denominazione, row.codice_fiscale_soggetto]);
          if (!entities.has(key)) entities.set(key, {row, sources: new Set()});
          entities.get(key).sources.add((row.source === 'regis' ? 'ReGiS' : t('openData'))
            + ' · ' + dateLabel(row.source_reference_date));
        }
        if (!entities.size) { implementers.append(make('p', 'consultation-note', t('noData'))); return; }
        const list = make('div', 'implementer-cards'); implementers.append(list);
        for (const {row, sources} of entities.values()) {
          const entity = make('div', 'implementer-card');
          const fields = make('div', 'detail-grid');
          addField(fields, t('denominazione'), row.denominazione || t('missing'));
          addField(fields, t('codice_fiscale_soggetto'), row.codice_fiscale_soggetto || t('missing'));
          entity.append(fields, make('p', 'consultation-source', [...sources].join(' / ')));
          list.append(entity);
        }
      });
      const financeSection = box(t('overviewFinancing'), 'overview-funding');
      const snapshot = make('div', 'overview-snapshot'); financeSection.append(snapshot);
      const metric = (label, value, note) => {
        const card = make('div', 'overview-metric');
        card.append(make('span', 'metric-label', label), make('strong', '', value));
        if (note) card.append(make('span', 'consultation-source', note));
        return card;
      };
      const financial = make('div', 'overview-finance'); snapshot.append(financial);
      asyncInto(financial, async () => {
        const records = (await page(project, 'finance')).rows;
        // ReGiS remains primary; do not replace its nulls with another source's values.
        const observation = records.find((row) => row.source === 'regis')
          || records.find((row) => row.source_dataset === 'pagamenti') || records[0];
        // Public financing is a separate native observation, absent from current ReGiS extracts.
        const publicObservation = records.find((row) => row.source_dataset === 'progetti' && row.source === 'open_data');
        for (const field of ['finanziamento_totale', 'finanziamento_pubblico', 'finanziamento_pnrr']) {
          const selected = field === 'finanziamento_pubblico' ? publicObservation : observation;
          const note = selected ? (selected.source === 'regis' ? 'ReGiS' : t('openData')) + ' · '
            + t(selected.source_dataset) + ' · ' + dateLabel(selected.source_reference_date) : t('noData');
          financial.append(metric(t(field), selected ? consultation.display(field, selected[field]) : t('missing'), note));
        }
      });
    }
    function pipelineDetail(panel, procedure, record, prefix, options = {}) {
      const detail = makeCigDetailPanel(procedure, record, true, {compact: true, ...options});
      // Several CLPs may display the same CUP investigation: IDs must remain unique.
      const ids = new Map();
      for (const item of [detail, ...detail.querySelectorAll('[id]')]) {
        if (item.id) { ids.set(item.id, prefix + '-' + item.id); item.id = ids.get(item.id); }
      }
      for (const item of detail.querySelectorAll('[aria-controls]')) {
        const target = item.getAttribute('aria-controls');
        if (ids.has(target)) item.setAttribute('aria-controls', ids.get(target));
      }
      panel.append(detail);
      return detail;
    }
    function procurement(panel, project, index) {
      asyncInto(panel, async () => {
        const params = new URLSearchParams({clp: project.codice_locale_progetto});
        const response = await fetch('/api/cup/' + encodeURIComponent(data.cup) + '/procurement?' + params);
        if (!response.ok) throw new Error('Procurement request failed.');
        const result = await response.json();
        const status = result.investigation.status;
        const notice = make('p', 'investigation-status', t('investigation_' + status, status)
          + (result.investigation.date ? ' · ' + String(result.investigation.date).slice(0, 10).split('-').reverse().join('/') : ''));
        panel.append(notice, make('p', 'consultation-note', t('cupInvestigationNotice')));
        const active = result.rows.filter((row) => row.review_decision !== 'excluded');
        const excluded = result.rows.filter((row) => row.review_decision === 'excluded');
        panel.append(make('h3', 'section-title', t('tab_procurement') + ' · ' + active.length));
        function unidentified(operators, kind) {
          const name = kind === 'awardees' ? 'denominazione_aggiudicatario' : 'denominazione_subappaltatore';
          const tax = kind === 'awardees' ? 'codice_fiscale_partita_iva' : 'codice_fiscale_partita_iva_subappaltatore';
          const known = (value) => Boolean(value && !['/', '//', 'N/A', 'N/D'].includes(String(value).trim()) && !String(value).includes('*'));
          return operators.filter((row) => !known(row[name]) && !known(row[tax])).length;
        }
        function operatorLabel(kind, operators) {
          const count = operators.length, missing = unidentified(operators, kind);
          return t(kind) + ' · ' + count + ' ' + t(count === 1 ? 'declaration' : 'declarations')
            + (missing ? ' · ' + (missing === 1 ? '' : missing + ' ') + t(missing === 1 ? 'unidentifiedSubject' : 'unidentifiedSubjects') : '');
        }
        function tenderCard(row, ordinal) {
          const item = make('details', 'tender-card');
          const summary = make('summary');
          summary.append(make('strong', '', row.cig || t('noCig')), make('span', '', row.oggetto_gara || t('missing')));
          item.append(summary);
          const body = make('div', 'consultation-body'); item.append(body);
          item.addEventListener('toggle', () => {
            if (!item.open || body.childElementCount) return;
            const detail = make('div', 'cig-detail-panel unified-tender-detail');
            const toolbar = make('div', 'cig-detail-toolbar');
            const investigationState = row.investigation ? t('cigInvestigationAvailable')
              : status === 'not_collected' ? t('cigInvestigationNotRun') : t('cigInvestigationUnavailable');
            toolbar.append(make('p', 'consultation-note', investigationState
              + (row.investigation && result.investigation.date ? ' · ' + String(result.investigation.date).slice(0, 10).split('-').reverse().join('/') : '')));
            const toggle = make('button', 'cig-sections-toggle'); toggle.type = 'button';
            toolbar.append(toggle); detail.append(toolbar);
            const sections = make('div', 'cig-detail-sections'); detail.append(sections); body.append(detail);
            function group(title, open = false) {
              const section = make('details', 'cig-detail-section is-wide'); section.open = open;
              const heading = make('summary', 'cig-section-summary'); heading.append(make('h4', '', title));
              section.append(heading); sections.append(section); return section;
            }
            const native = group(t('tenderData'), true);
            native.append(consultation.renderRow(row, 'tenders', {hideSource: true, omitFields: ['cig', 'oggetto_gara']}));
            for (const kind of ['awardees', 'subcontractors']) {
              const operators = group(operatorLabel(kind, row[kind]));
              if (!row[kind].length) operators.append(make('p', 'consultation-note', t('noData')));
              for (const operator of row[kind]) operators.append(consultation.renderRow(operator, kind, {omitFields: ['cig', 'codice_interno_pda']}));
            }
            const sources = group(t('tenderSources'));
            sources.append(make('p', 'consultation-source', t('openData') + ' · ' + t('tenders') + ' · '
              + dateLabel(row.source_reference_date) + (row.source_version ? ' · ' + t('version') + ' ' + row.source_version : '')));
            sources.append(make('p', 'consultation-note', t('nativeTenderLink')));
            if (row.review_decision) sources.append(make('p', 'consultation-note', t('review_' + row.review_decision, row.review_decision)));
            if (row.investigation) {
              const holder = make('div');
              const enrichment = pipelineDetail(holder, row.investigation, row.investigation_record,
                'clp-' + index + '-tender-' + ordinal, {nativeObject: row.oggetto_gara});
              native.append(make('h5', 'consultation-source', t('cupEnrichment')), make('p', 'consultation-note', t('cupInvestigationNotice')));
              for (const section of [...enrichment.querySelector('.cig-detail-sections').children]) {
                if (section.classList.contains('cig-procedure-data')) {
                  for (const child of [...section.children].filter((child) => child.tagName !== 'SUMMARY')) native.append(child);
                } else if (section.classList.contains('cig-provenance-section')) {
                  sources.append(make('p', 'consultation-note', t('cupInvestigationNotice')));
                  for (const child of [...section.children].filter((child) => child.tagName !== 'SUMMARY')) sources.append(child);
                } else {
                  const title = section.querySelector('summary h4');
                  if (title) title.textContent = t('cupEnrichment') + ' · ' + title.textContent;
                  sections.insertBefore(section, sources);
                }
              }
            }
            const updateToggle = () => { toggle.textContent = t([...sections.children].every((section) => !section.open) ? 'expandAll' : 'collapseAll'); };
            for (const section of sections.children) section.addEventListener('toggle', updateToggle);
            toggle.addEventListener('click', () => {
              const expand = [...sections.children].every((section) => !section.open);
              for (const section of sections.children) section.open = expand;
              updateToggle();
            });
            updateToggle();
          });
          return item;
        }
        if (!active.length) panel.append(make('p', 'consultation-note', t('noNativeTenders')));
        if (active.length) {
          const desktop = make('div', 'table-scroll native-tenders-desktop');
          const table = make('table', 'cig-table');
          const head = make('thead'), header = make('tr'), body = make('tbody');
          const columns = [
            ['cig', 'CIG'], ['oggetto_gara', t('oggetto_gara')],
            ['importo_complessivo_gara', t('tenderAmount')], ['importo_aggiudicazione', t('importo_aggiudicazione')],
            ['data_aggiudicazione_definitiva', t('data_aggiudicazione_definitiva')],
            ['awardees', t('awardCount')], ['subcontractors', t('subcontractorCount')], ['investigation', t('sourceLabel')],
          ];
          const numeric = new Set(['importo_complessivo_gara', 'importo_aggiudicazione', 'awardees', 'subcontractors']);
          let sortKey = '', direction = 1;
          const headers = new Map();
          const raw = (row, key) => Array.isArray(row[key]) ? row[key].length : key === 'investigation' ? Boolean(row[key]) : row[key];
          function draw(rows) {
            body.replaceChildren();
            rows.forEach((row) => {
              const tr = make('tr');
              columns.forEach(([key]) => {
                const cell = make('td');
                if (key === 'cig') {
                  const button = make('button', 'cig-detail-toggle', row.cig || t('noCig'));
                  button.type = 'button'; button.setAttribute('aria-expanded', 'false');
                  button.setAttribute('aria-label', t('tenderDetails') + ': ' + (row.cig || row.codice_interno_pda || t('noCig')));
                  button.addEventListener('click', () => {
                    const previous = tr.nextElementSibling;
                    if (previous?.classList.contains('cig-detail-row')) { previous.remove(); button.setAttribute('aria-expanded', 'false'); return; }
                    body.querySelectorAll('.cig-detail-row').forEach((item) => item.remove());
                    body.querySelectorAll('.cig-detail-toggle').forEach((item) => item.setAttribute('aria-expanded', 'false'));
                    const detailRow = make('tr', 'cig-detail-row'), detailCell = make('td'); detailCell.colSpan = columns.length;
                    const detail = tenderCard(row, 'table-' + active.indexOf(row)); detail.open = true;
                    detailCell.append(detail); detailRow.append(detailCell); tr.after(detailRow);
                    button.setAttribute('aria-expanded', 'true');
                  });
                  cell.append(button);
                } else if (key === 'investigation') cell.textContent = t('openData') + (row.investigation ? ' · ' + t('enriched') : '');
                else if (Array.isArray(row[key])) {
                  const missing = unidentified(row[key], key);
                  cell.textContent = row[key].length + (missing ? ' ' + t(row[key].length === 1 ? 'declaration' : 'declarations')
                    + ' · ' + (missing === 1 ? '' : missing + ' ') + t(missing === 1 ? 'unidentifiedSubject' : 'unidentifiedSubjects') : '');
                  cell.title = operatorLabel(key, row[key]);
                }
                else cell.textContent = consultation.display(key, row[key]);
                tr.append(cell);
              });
              body.append(tr);
            });
          }
          columns.forEach(([key, label]) => {
            const th = make('th'); th.scope = 'col'; th.setAttribute('aria-sort', 'none');
            const button = make('button', 'sort-button', label + ' ↕'); button.type = 'button';
            button.addEventListener('click', () => {
              direction = sortKey === key ? -direction : 1; sortKey = key;
              headers.forEach((item, name) => item.setAttribute('aria-sort', name === key ? (direction === 1 ? 'ascending' : 'descending') : 'none'));
              const collator = new Intl.Collator('it', {numeric: true, sensitivity: 'base'});
              draw([...active].sort((a, b) => {
                const left = raw(a, key), right = raw(b, key);
                if (left == null || right == null) return left == null && right == null ? 0 : left == null ? 1 : -1;
                return direction * (numeric.has(key) ? Number(left) - Number(right) : collator.compare(String(left), String(right)));
              }));
            });
            th.append(button); header.append(th); headers.set(key, th);
          });
          head.append(header); table.append(head, body); desktop.append(table); panel.append(desktop); draw(active);
          const mobile = make('div', 'native-tenders-mobile');
          active.forEach((row, ordinal) => mobile.append(tenderCard(row, ordinal)));
          panel.append(mobile);
        }
        if (excluded.length) {
          const group = make('details', 'consultation-section');
          group.append(make('summary', '', t('excludedTenders') + ' (' + excluded.length + ')'));
          excluded.forEach((row, ordinal) => group.append(tenderCard(row, 'excluded-' + ordinal)));
          panel.append(group);
        }
        for (const kind of ['awardees', 'subcontractors']) {
          const operators = result.unresolved_operators[kind];
          if (!operators.length) continue;
          const group = make('details', 'consultation-section');
          group.append(make('summary', '', t(kind) + ' · ' + t('unresolvedOperators') + ' (' + operators.length + ')'));
          group.append(make('p', 'consultation-note', t('operatorLinkNotice')));
          for (const operator of operators) group.append(consultation.renderRow(operator, kind));
          panel.append(group);
        }
        if (result.cup_procedures.length) {
          const group = make('details', 'consultation-section');
          group.append(make('summary', '', t('cupProcedures') + ' (' + result.cup_procedures.length + ')'));
          group.append(make('p', 'consultation-note', t('cupInvestigationNotice')));
          result.cup_procedures.forEach((item, ordinal) => {
            const card = make('details', 'tender-card');
            card.append(make('summary', '', item.procedure.cig + ' · ' + (item.procedure.tender_object || t('missing'))));
            card.addEventListener('toggle', () => {
              if (card.open && !card.querySelector('.cig-detail-panel')) pipelineDetail(card, item.procedure, item.record, 'clp-' + index + '-cup-' + ordinal);
            });
            group.append(card);
          });
          panel.append(group);
        }
      });
    }
    function projectWorkspace(panel, project, index) {
      if (projects.length > 1) panel.append(make('h3', 'clp-heading', project.titolo_progetto || t('incompleteTitle')));
      panel.append(make('p', 'consultation-source', 'CLP ' + project.codice_locale_progetto));
      const items = tabNames.map((name) => ({label: t('tab_' + name), render: (body) => {
        if (name === 'overview') overview(body, project);
        if (name === 'subjects') {
          body.append(make('p', 'consultation-note', t('contactsUnavailable')));
          disclosure(body, data.cup, project, ['implementers', 'awardees', 'subcontractors'], true);
        }
        if (name === 'financial') {
          body.append(make('p', 'consultation-note', t('financialNotice')));
          disclosure(body, data.cup, project, ['finance', 'reporting'], true);
        }
        if (name === 'procurement') procurement(body, project, index);
        if (name === 'progress') window.aifelProgress.mount(body, data.cup, project);
        if (name === 'questions') body.append(make('p', 'empty-state', t('questionsUnavailable')));
        if (name === 'measure') {
          body.append(make('p', 'consultation-note', t('measureNotice')));
          disclosure(body, data.cup, project, consultation.context);
        }
      }}));
      tabsInto(panel, items, 'clp-' + index);
    }
    const card = make('article', 'project-card');
    const heading = make('div', 'project-heading');
    heading.append(make('h2', '', projects.length === 1 ? projects[0].titolo_progetto || t('incompleteTitle') : t('cupSummaryTitle')));
    const metadata = make('div', 'project-heading-metadata');
    const reference = make('div', 'cup-reference');
    reference.append(make('span', 'cup-code', data.cup));
    if (/^[A-Z0-9]{15}$/.test(data.cup)) {
      const link = make('a', 'opencup-link', t('openOnOpenCup') + ' ↗');
      link.href = 'https://www.opencup.gov.it/portale/progetto/-/cup/' + encodeURIComponent(data.cup);
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.setAttribute('aria-label', t('openOnOpenCup') + ' · ' + data.cup + ' · ' + t('opensNewTab'));
      reference.append(link);
    }
    metadata.append(reference);
    // Register each connected pipeline here; unavailable pipelines are not advertised.
    const investigations = [{label: t('tab_procurement'), available: data.collection_status === 'available'}];
    const availableInvestigations = investigations.filter((item) => item.available);
    const investigation = make('span', 'cup-investigation-tag');
    investigation.append(make('span', 'investigation-label', t(availableInvestigations.length ? 'availableInvestigations' : 'noAvailableInvestigations')));
    for (const item of availableInvestigations) investigation.append(make('span', 'investigation-item', item.label));
    investigation.classList.toggle('is-available', availableInvestigations.length > 0);
    metadata.append(investigation); heading.append(metadata);
    card.append(heading); host.append(card);
    if (projects.length === 1) { projectWorkspace(card, projects[0], 0); return; }
    let navigation;
    const summaryItem = {label: t('cupSummary'), render: (panel) => {
      panel.append(make('p', 'consultation-note', t('cupSummaryNotice')));
      panel.append(make('p', 'consultation-note', projects.length + ' ' + t('associatedProjects', 'associated projects')));
      const list = make('div', 'clp-summary-list'); panel.append(list);
      let shown = 0;
      function addBatch() {
      const next = Math.min(shown + 20, projects.length);
      for (let index = shown; index < next; index++) {
        const project = projects[index];
        const item = make('article', 'clp-summary-card');
        item.append(make('h3', '', shortTitle(project)), make('p', 'consultation-source', 'CLP ' + project.codice_locale_progetto));
        const metadata = make('div'); item.append(metadata);
        asyncInto(metadata, async () => {
          await implementingNames(metadata, project);
          const result = await page(project, 'locations', 0, 5);
          const names = [...new Set(result.rows.map((row) => row.descrizione_comune || row.indirizzo || row.descrizione_regione).filter(Boolean))];
          metadata.append(make('p', 'consultation-note', names.join(' · ') + (result.total > 5 ? ' · …' : '')));
        });
        const button = make('button', 'text-button', t('openProject'));
        button.type = 'button'; button.addEventListener('click', () => navigation.select(index + 1));
        item.append(button); list.append(item);
      }
      shown = next;
      if (shown < projects.length) {
        const more = make('button', 'text-button', t('moreProjects', 'Show more projects') + ' (' + shown + ' / ' + projects.length + ')');
        more.type = 'button'; more.addEventListener('click', () => { more.remove(); addBatch(); });
        panel.append(more);
      }
      }
      addBatch();
    }};
    const items = [summaryItem, ...projects.map((project, index) => ({
      label: shortTitle(project).slice(0, 32) + ' · CLP ' + project.codice_locale_progetto,
      render: (panel) => projectWorkspace(panel, project, index),
    }))];
    if (projects.length <= 5) {
      navigation = tabsInto(card, items, 'cup');
      card.querySelector('.result-tabs').setAttribute('aria-label', t('clpNavigation'));
      card.querySelector('.result-tabs').classList.add('clp-tabs');
      projects.forEach((project, index) => { card.querySelector('#cup-tab-' + (index + 1)).title = shortTitle(project); });
    } else {
      const chooser = make('div', 'clp-chooser');
      const filter = make('input', 'location-filter'); filter.type = 'search';
      filter.placeholder = t('filterProjects'); filter.setAttribute('aria-label', filter.placeholder);
      const select = make('select', 'clp-select'); select.setAttribute('aria-label', t('clpNavigation'));
      const panels = items.map(() => make('section', 'tab-panel'));
      const loaded = new Set();
      navigation = {select: (index) => {
        // Preserve a selected project even when a previous search hid its option.
        filter.value = ''; populate(); select.value = String(index);
        panels.forEach((panel, ordinal) => { panel.hidden = ordinal !== index; });
        if (!loaded.has(index)) { loaded.add(index); items[index].render(panels[index]); }
      }};
      function populate() {
        const query = filter.value.toLocaleLowerCase('it'); const current = select.value;
        select.replaceChildren();
        items.forEach((item, index) => {
          const label = index ? item.label + ' · ' + shortTitle(projects[index - 1]) : item.label;
          if (!index || String(index) === current || label.toLocaleLowerCase('it').includes(query)) {
            const option = make('option', '', label); option.value = String(index); select.append(option);
          }
        });
        if ([...select.options].some((option) => option.value === current)) select.value = current;
      }
      filter.addEventListener('input', populate);
      select.addEventListener('change', () => navigation.select(Number(select.value)));
      chooser.append(filter, select); card.append(chooser, ...panels); navigation.select(0);
    }
  }
  return { mount };
})();
