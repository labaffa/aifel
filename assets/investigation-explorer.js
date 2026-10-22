/* One CUP index for every investigation type, with native CLP programme paths. */
window.aifelInvestigationExplorer = (() => {
  const normalize = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const kinds = ['procurement', 'questions', 'referents'];
  const sections = {procurement: 'procurement', questions: 'questions', referents: 'subjects'};
  const missing = '__missing__';
  function make(tag, cls, value) {
    const item = document.createElement(tag);
    if (cls) item.className = cls;
    if (value != null) item.textContent = String(value);
    return item;
  }
  async function mount(host, records, openCup) {
    await window.aifelConsultation.ready;
    const t = (key) => window.aifelConsultation.text(key, key);
    const kindLabel = (kind) => t('explorerKind_' + kind);
    const root = make('section', 'investigation-explorer');
    root.append(make('h3', '', t('explorerTitle')));
    const filters = make('div', 'explorer-filters');
    const controls = {};
    for (const field of ['kind', 'mission', 'component', 'measure', 'submeasure', 'search']) {
      const label = make('label', 'explorer-field', t('explorerField_' + field));
      const input = make(field === 'search' ? 'input' : 'select');
      input.dataset.field = field;
      if (field === 'search') { input.type = 'search'; input.maxLength = 200; input.placeholder = t('explorerSearchHint'); }
      label.append(input); filters.append(label); controls[field] = input;
    }
    for (const [value, label] of [['', t('explorerAll')], ...kinds.map((kind) => [kind, kindLabel(kind)])]) {
      const option = make('option', '', label); option.value = value; controls.kind.append(option);
    }
    root.append(filters);
    const toolbar = make('div', 'explorer-toolbar');
    const count = make('p', 'consultation-note'); count.setAttribute('aria-live', 'polite');
    const reset = make('button', 'investigation-more', t('explorerReset')); reset.type = 'button';
    toolbar.append(count, reset); root.append(toolbar);
    const table = make('table', 'explorer-table');
    const head = make('thead'), header = make('tr');
    const columns = ['cup', 'project', 'programme', 'territory', 'investigations'];
    for (const column of columns) { const th = make('th', '', t('explorerColumn_' + column)); th.scope = 'col'; header.append(th); }
    head.append(header);
    const body = make('tbody'); table.append(head, body); root.append(table);
    const empty = make('p', 'consultation-note', t('explorerNoMatches')); root.append(empty);
    const paging = make('nav', 'explorer-pagination'); paging.setAttribute('aria-label', t('explorerPagination'));
    const previous = make('button', 'investigation-more', t('explorerPrevious')); previous.type = 'button';
    const pageLabel = make('span');
    const next = make('button', 'investigation-more', t('explorerNext')); next.type = 'button';
    paging.append(previous, pageLabel, next); root.append(paging); host.append(root);
    let page = 0;
    const pageSize = 10;
    const paths = (record) => record.projects?.length ? record.projects : [{clp: null,
      title: record.titles?.join(' · '), municipalities: record.municipalities || [], implementers: record.implementers || []}];
    const hasKind = (record) => !controls.kind.value || record.kinds.includes(controls.kind.value);
    function pathMatches(path, fields = ['mission', 'component', 'measure', 'submeasure']) {
      return fields.every((field) => !controls[field].value || (path[field] || missing) === controls[field].value);
    }
    function updateFacets() {
      const fields = ['mission', 'component', 'measure', 'submeasure'];
      for (const [index, field] of fields.entries()) {
        const values = new Map();
        for (const record of records.filter(hasKind)) for (const path of paths(record)) {
          if (!pathMatches(path, fields.slice(0, index))) continue;
          const value = path[field] || missing;
          let label = value === missing ? t('explorerMissing_' + field) : field === 'mission'
            ? t('explorerField_mission') + ' ' + value.slice(1) : field === 'component' ? value
            : value + (path[field + '_label'] && path[field + '_label'] !== value ? ' · ' + path[field + '_label'] : '');
          if (!values.has(value) || label.length > values.get(value).length) values.set(value, label);
        }
        const selected = controls[field].value;
        controls[field].replaceChildren();
        const all = make('option', '', t('explorerAll')); all.value = ''; controls[field].append(all);
        for (const [value, label] of [...values].sort((a,b) => a[0].localeCompare(b[0], 'it', {numeric:true}))) {
          const option = make('option', '', label); option.value = value; option.title = label; controls[field].append(option);
        }
        controls[field].value = values.has(selected) ? selected : '';
        controls[field].disabled = values.size === 0 || (values.size === 1 && values.has(missing));
      }
    }
    function matchedPaths(record) {
      if (!hasKind(record)) return [];
      const query = normalize(controls.search.value.trim());
      return paths(record).filter((path) => pathMatches(path) && (!query || normalize(record.cup).includes(query)
        || normalize([path.title, ...(path.municipalities || []), ...(path.implementers || [])].join(' ')).includes(query)));
    }
    function open(record, matches, kind = controls.kind.value, clp = matches.length === 1 ? matches[0].clp : null) {
      openCup(record.cup, {section: sections[kind], clp});
    }
    function draw() {
      const matches = records.map((record) => ({record, paths: matchedPaths(record)})).filter((item) => item.paths.length);
      page = Math.min(page, Math.max(0, Math.ceil(matches.length / pageSize) - 1));
      const start = page * pageSize;
      body.replaceChildren();
      for (const {record, paths: selected} of matches.slice(start, start + pageSize)) {
        const row = make('tr');
        const cells = columns.map((column) => {
          const td = make('td'); td.dataset.label = t('explorerColumn_' + column);
          const content = make('div', 'explorer-cell'); td.append(content); row.append(td); return content;
        });
        const link = make('button', 'explorer-cup-link', record.cup); link.type = 'button';
        link.addEventListener('click', () => open(record, selected)); cells[0].append(link);
        const titles = [...new Set(selected.map((path) => path.title).filter(Boolean))];
        const title = make('span', 'explorer-project-title', titles.join(' · ') || t('incompleteTitle'));
        title.title = titles.join(' · '); cells[1].append(title);
        if (record.projects?.length > 1) {
          const details = make('details', 'explorer-clps');
          details.append(make('summary', '', selected.length + ' ' + t('explorerMatchingClps')));
          const options = make('div', 'explorer-clp-options');
          const list = make('div'); options.append(list); details.append(options);
          let shown = 0;
          const more = make('button', 'text-button', t('loadMore')); more.type = 'button';
          function showPaths() {
            for (const path of selected.slice(shown, shown + 20)) {
              const button = make('button', 'explorer-clp-link', path.clp + ' · ' + (path.title || t('incompleteTitle')));
              button.type = 'button'; button.addEventListener('click', () => open(record, selected, controls.kind.value, path.clp)); list.append(button);
            }
            shown += 20; more.hidden = shown >= selected.length;
          }
          more.addEventListener('click', showPaths); options.append(more);
          details.addEventListener('toggle', () => { if (details.open && !shown) showPaths(); }); cells[1].append(details);
        }
        const programmes = [...new Set(selected.map((path) => path.measure
          ? path.measure + (path.submeasure ? ' / ' + path.submeasure : '') : t('explorerMissing_measure')))];
        const programme = make('span', 'explorer-truncated', programmes.join(' · '));
        programme.title = programmes.join(' · '); cells[2].append(programme);
        const places = [...new Set(selected.flatMap((path) => path.municipalities || []))];
        const entities = [...new Set(selected.flatMap((path) => path.implementers || []))];
        const territory = make('span', 'explorer-truncated', places.join(' · ') || '—');
        territory.title = places.join(' · ');
        const implementers = make('small', 'explorer-truncated explorer-implementers', entities.join(' · '));
        implementers.title = entities.join(' · '); cells[3].append(territory, implementers);
        for (const kind of record.kinds) {
          const badge = make('button', 'explorer-kind', kindLabel(kind)); badge.type = 'button';
          badge.addEventListener('click', () => open(record, selected, kind)); cells[4].append(badge);
        }
        body.append(row);
      }
      count.textContent = (matches.length ? start + 1 + '–' + Math.min(start + pageSize, matches.length) + ' / ' : '') + matches.length + ' CUP';
      empty.hidden = Boolean(matches.length); table.hidden = !matches.length; paging.hidden = matches.length <= pageSize;
      previous.disabled = page === 0; next.disabled = start + pageSize >= matches.length;
      pageLabel.textContent = page + 1 + ' / ' + Math.max(1, Math.ceil(matches.length / pageSize));
    }
    for (const field of ['kind', 'mission', 'component', 'measure', 'submeasure']) controls[field].addEventListener('change', () => {
      const dependent = ['mission', 'component', 'measure', 'submeasure'];
      const index = dependent.indexOf(field);
      if (index >= 0) dependent.slice(index + 1).forEach((name) => { controls[name].value = ''; });
      page = 0; updateFacets(); draw();
    });
    controls.search.addEventListener('input', () => { page = 0; draw(); });
    reset.addEventListener('click', () => { Object.values(controls).forEach((control) => { control.value = ''; }); page = 0; updateFacets(); draw(); });
    previous.addEventListener('click', () => { page--; draw(); root.scrollIntoView({block:'start'}); });
    next.addEventListener('click', () => { page++; draw(); root.scrollIntoView({block:'start'}); });
    updateFacets(); draw();
  }
  return {mount};
})();
