/* Reviewed source assertions; names alone never merge people or contact owners. */
window.aifelReferents = (() => {
  const t = (key) => window.aifelConsultation.text(key, key);
  function displayDate(value) {
    const raw = String(value || '');
    if (/^\d{4}$/.test(raw)) return raw;
    if (/^\d{4}-\d{2}$/.test(raw)) return raw.slice(5) + '/' + raw.slice(0, 4);
    return dateLabel(raw.slice(0, 10));
  }
  function make(tag, cls, value) {
    const item = document.createElement(tag);
    if (cls) item.className = cls;
    if (value != null) item.textContent = String(value);
    return item;
  }
  function sourceList(host, sources) {
    if (!sources?.length) return;
    const details = make('details', 'referent-sources');
    details.append(make('summary', '', t('referentSources')));
    const groups = new Map();
    for (const source of sources) {
      const key = source.url || source.title;
      if (!groups.has(key)) groups.set(key, {source, excerpts: new Map()});
      if (source.quote) groups.get(key).excerpts.set(source.quote, source.locator);
    }
    for (const {source, excerpts} of groups.values()) {
      const block = make('div', 'referent-source');
      let url;
      try { url = new URL(source.url); } catch (_) { url = null; }
      if (url && ['http:', 'https:'].includes(url.protocol)) {
        const link = make('a', '', source.title || t('referentSource'));
        link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer'; block.append(link);
      } else block.append(make('span', '', source.title || t('referentSource')));
      if (source.document_date) block.append(make('p', 'consultation-source', t('referentDocumentDate') + ': ' + displayDate(source.document_date)));
      for (const [quote, locator] of excerpts) {
        if (locator) block.append(make('p', 'consultation-source', locator));
        block.append(make('blockquote', '', quote));
      }
      details.append(block);
    }
    host.append(details);
  }
  function contactGroups(rows) {
    const groups = new Map();
    for (const row of rows) {
      // Group publication contexts, never infer a canonical person from a name.
      const personAnchor = row.role_reference_ids?.length
        ? [...row.role_reference_ids].sort() : [row.reference_id];
      const owner = row.attribution === 'office' ? row.office_label || row.reference_id
        : row.attribution === 'entity' ? row.entity_name || row.reference_id : [row.research_subject_name, personAnchor];
      const key = JSON.stringify([row.attribution, row.entity_name || row.reference_id, row.research_run_id,
        row.scope_type, row.clp, owner]);
      if (!groups.has(key)) groups.set(key, {row, values: new Map()});
      const group = groups.get(key);
      const valueKey = JSON.stringify([row.contact_type, row.value]);
      if (!group.values.has(valueKey)) group.values.set(valueKey, {row, sources: new Map()});
      const value = group.values.get(valueKey);
      for (const source of row.sources || []) value.sources.set(JSON.stringify(source), source);
    }
    return [...groups.values()];
  }
  function contactCard(group) {
    const row = group.row;
    const card = make('article', 'referent-card contact-card');
    const owner = row.attribution === 'office' ? row.office_label
      : row.attribution === 'entity' ? row.entity_name : row.research_subject_name;
    card.append(make('h4', '', owner || t('missing')),
      make('span', 'referent-status', t('referentAttribution_' + row.attribution)));
    if (row.attribution !== 'entity' && row.entity_name) card.append(make('p', 'consultation-note', row.entity_name));
    const order = {email: 0, phone: 1, pec: 2};
    const entries = [...group.values.values()].sort((a, b) =>
      (order[a.row.contact_type] ?? 3) - (order[b.row.contact_type] ?? 3));
    for (const entry of entries) {
      const contact = entry.row;
      const field = make('div', 'contact-entry');
      const line = make('p', 'referent-value');
      const key = 'referentContact_' + contact.contact_type;
      line.append(make('span', 'contact-type-label', (t(key) === key ? t('referentContact_other') : t(key)) + ': '));
      const linked = ['email', 'phone', 'pec'].includes(contact.contact_type);
      const value = make(linked ? 'a' : 'span', '', contact.value);
      if (linked) value.href = contact.contact_type === 'phone' ? 'tel:' + contact.value.replace(/[^+\d]/g, '')
        : 'mailto:' + encodeURIComponent(contact.value);
      line.append(value); field.append(line);
      sourceList(field, [...entry.sources.values()]); card.append(field);
    }
    return card;
  }
  function roleCard(row, options = {}) {
    const card = make('article', 'referent-card');
    card.dataset.referenceId = row.reference_id;
    card.append(make('h4', '', row.display_name), make('p', 'referent-role', row.role_label));
    if (row.entity_name) card.append(make('p', 'consultation-note', row.entity_name));
    const status = make('span', 'referent-status', t(row.source_report_only ? 'referentSourceReport' : 'referentTemporal_' + row.temporal_status));
    if (row.temporal_status === 'historical') status.classList.add('is-historical');
    card.append(status);
    const scope = row.scope_type === 'cig' ? 'CIG ' + row.cig
      : row.scope_type === 'cup_clp' ? 'CUP ' + row.cup + ' · CLP ' + row.clp : 'CUP ' + row.cup;
    if (!options.hideScope) card.append(make('p', 'consultation-source', scope));
    if (row.valid_from || row.valid_to) card.append(make('p', 'consultation-note',
      t('referentValidity') + ': ' + (row.valid_from ? displayDate(row.valid_from) : '—') + ' – '
      + (row.valid_to ? displayDate(row.valid_to) : '—')));
    if (!options.hideSources) sourceList(card, row.sources);
    return card;
  }
  function procedureGroups(rows) {
    const groups = new Map();
    for (const row of rows) {
      // The source supplies an opaque, evidenced grouping key. No name matching.
      const key = row.person_reference || row.reference_id;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }
    return [...groups.values()];
  }
  function procedureCard(rows) {
    const card = roleCard({...rows[0], role_label: [...new Set(rows.map((row) => row.role_label))].join(' / ')},
      {hideScope: true, hideSources: true});
    const cigs = new Map();
    for (const row of rows) {
      if (!cigs.has(row.cig)) cigs.set(row.cig, []);
      cigs.get(row.cig).push(row);
    }
    const details = make('details', 'referent-procedures');
    details.append(make('summary', '', t('referentObservedCigs') + ' · ' + cigs.size));
    for (const [cig, observations] of [...cigs].sort((a, b) => a[0].localeCompare(b[0]))) {
      const item = make('div', 'referent-procedure');
      item.append(make('strong', '', 'CIG ' + cig), make('p', 'consultation-note',
        [...new Set(observations.map((row) => row.role_label))].join(' / ')));
      sourceList(item, observations.flatMap((row) => row.sources || [])); details.append(item);
    }
    card.append(details);
    return card;
  }
  function create(cup) {
    const requests = new Map();
    function page(project, offset, cig) {
      const params = new URLSearchParams({offset: String(offset), limit: '100'});
      if (project) params.set('clp', project.codice_locale_progetto);
      if (cig) params.set('cig', cig);
      const key = params.toString();
      if (!requests.has(key)) requests.set(key, fetch('/api/cup/' + encodeURIComponent(cup) + '/referents?' + key)
        .then((response) => { if (!response.ok) throw new Error('Referent request failed'); return response.json(); })
        .catch((error) => { requests.delete(key); throw error; }));
      return requests.get(key);
    }
    function mount(host, project = null, cig = null) {
      const section = make('section', 'referents-section'); host.append(section);
      if (!cig || !host.classList.contains('cig-detail-section')) {
        section.append(make('h3', 'section-title', t(cig ? 'referentProcedureTitle' : 'referentTitle')));
      }
      const state = make('p', 'consultation-note'); section.append(state);
      let offset = 0;
      const roles = new Map(), contacts = new Map();
      const content = make('div'); section.append(content);
      const loadMore = make('button', 'text-button', t('loadMore')); loadMore.type = 'button'; loadMore.hidden = true;
      section.append(loadMore);
      let loadedInvestigation = false;
      async function load() {
        state.replaceChildren(document.createTextNode(t('loading'))); loadMore.disabled = true;
        try {
          const data = await page(project, offset, cig);
          if (!data.available) { state.textContent = t('referentNotPublished'); return; }
          if (!loadedInvestigation) {
            loadedInvestigation = true;
            if (!cig) {
              for (const investigation of data.investigations) {
                section.insertBefore(make('p', 'consultation-source', t('referentResearchDate') + ': '
                  + displayDate(investigation.researched_at)), content);
                if (!investigation.project_research_complete) section.insertBefore(
                  make('p', 'referent-coverage', t('referentPartialCoverage')), content);
              }
              section.insertBefore(make('p', 'consultation-note', t('referentScopeNotice')), content);
            }
          }
          for (const role of data.roles) roles.set(role.reference_id, role);
          for (const contact of data.contacts) contacts.set(contact.reference_id, contact);
          content.replaceChildren();
          if (!roles.size && !contacts.size) state.textContent = t(data.investigations.length ? 'referentNoAcceptedResults' : 'referentNotRun');
          else state.textContent = '';
          for (const [procedure, label] of [[false, 'referentProjectTitle'], [true, 'referentProcedureTitle']]) {
            const rows = [...roles.values()].filter((r) => r.source_report_only === procedure);
            if (!rows.length) continue;
            const entries = procedure ? procedureGroups(rows) : rows.map((row) => [row]);
            const group = make(cig ? 'div' : 'details', cig ? '' : 'consultation-section');
            if (!cig) group.append(make('summary', '', t(label) + ' · ' + entries.length));
            if (procedure) group.append(make('p', 'consultation-note', t('referentProcedureNotice')));
            for (const observations of entries) {
              const card = procedure ? procedureCard(observations) : roleCard(observations[0]);
              // Explicit task references connect findings, without canonical identity merging.
              const references = new Set(observations.map((row) => row.reference_id));
              const linked = [...contacts.values()].filter((c) => c.role_reference_ids.some((ref) => references.has(ref)));
              if (linked.length) {
                const grouped = contactGroups(linked);
                const details = make('details', 'referent-linked-contacts');
                details.append(make('summary', '', t('referentLinkedContacts') + ' · ' + grouped.reduce((sum, group) => sum + group.values.size, 0)));
                grouped.forEach((group) => details.append(contactCard(group)));
                card.insertBefore(details, card.querySelector('.referent-procedures'));
              }
              group.append(card);
            }
            content.append(group);
          }
          const visibleRoleIds = new Set(roles.keys());
          const additional = [...contacts.values()].filter((contact) =>
            !(contact.role_reference_ids || []).some((ref) => visibleRoleIds.has(ref)));
          if (additional.length && !cig) {
            const grouped = contactGroups(additional);
            const group = make('details', 'consultation-section');
            group.append(make('summary', '', t('referentAdditionalContacts') + ' · ' + grouped.reduce((sum, item) => sum + item.values.size, 0)));
            grouped.forEach((item) => group.append(contactCard(item))); content.append(group);
          }
          offset += 100;
          loadMore.hidden = offset >= Math.max(data.role_total, data.contact_total);
          loadMore.disabled = false;
        } catch (_) {
          state.textContent = t('loadError');
          const retry = make('button', 'text-button', t('retry')); retry.type = 'button';
          retry.addEventListener('click', load); state.append(retry);
        }
      }
      loadMore.addEventListener('click', load); load();
    }
    return {mount, mountProcedure: (host, project, cig) => mount(host, project, cig)};
  }
  return {create};
})();
