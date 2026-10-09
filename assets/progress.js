/* Native phases and indicator observations, without inferred progress scores. */
window.aifelProgress = (() => {
  const c = window.aifelConsultation;
  const t = (key) => c.text(key);
  const make = (tag, className, value) => {
    const item = document.createElement(tag); item.className = className || '';
    if (value !== undefined) item.textContent = String(value);
    return item;
  };
  const source = (row) => (row.source === 'regis' ? 'ReGiS' : t('openData')) + ' · '
    + t(row.source_dataset) + ' · ' + (row.source_reference_date ? dateLabel(row.source_reference_date) : t('dateUnavailable'));
  function phases(rows) {
    const timeline = make('ol', 'phase-timeline');
    const ordered = [...rows].sort((a, b) => {
      const left = a.data_inizio_prevista || a.data_inizio_effettiva;
      const right = b.data_inizio_prevista || b.data_inizio_effettiva;
      if (!left || !right) return !left && !right ? 0 : !left ? 1 : -1;
      return left.localeCompare(right);
    });
    for (const row of ordered) {
      const card = make('li', 'phase-step');
      const header = make('div', 'phase-heading');
      header.append(make('h4', '', row.descrizione_fase || row.codice_fase || t('missing')));
      const state = row.data_fine_effettiva ? 'actualEndRecorded' : row.data_inizio_effettiva ? 'actualStartRecorded'
        : row.data_inizio_prevista || row.data_fine_prevista ? 'plannedDatesOnly' : 'noPhaseDates';
      header.append(make('span', 'phase-state', t(state)));
      card.append(header, make('p', 'consultation-source', source(row)));
      const dates = make('div', 'phase-dates');
      for (const [label, start, end] of [
        ['plannedDates', row.data_inizio_prevista, row.data_fine_prevista],
        ['actualDates', row.data_inizio_effettiva, row.data_fine_effettiva],
      ]) {
        const field = make('div');
        field.append(make('span', 'metric-label', t(label)),
          make('p', '', t('phaseStart') + ': ' + (start ? dateLabel(start) : t('missing'))),
          make('p', '', t('phaseEnd') + ': ' + (end ? dateLabel(end) : t('missing'))));
        dates.append(field);
        if (start && end && end < start) card.append(make('p', 'metric-warning', t('phaseDateConflict') + ' · ' + t(label)));
      }
      card.append(dates); timeline.append(card);
    }
    return timeline;
  }
  function period(row) {
    if (row.period_is_calendar === false) return [row.anno, row.mese_sorgente || row.mese, t('nonCalendar')].filter((v) => v !== null && v !== undefined && v !== '').join(' · ');
    if (row.anno && row.mese) return String(row.mese).padStart(2, '0') + '/' + row.anno;
    if (row.observation_values) return t('sourcePeriods');
    return t('missing');
  }
  function indicators(rows) {
    const wrap = make('div', 'indicator-table-wrap');
    const table = make('table', 'indicator-table');
    const headers = ['descrizione_indicatore', 'indicatorUnit', 'valore_programmato', 'valore_realizzato', 'observationPeriod', 'observationSource', 'detailsLabel'];
    const head = make('thead'), header = make('tr');
    for (const key of headers) { const th = make('th', '', t(key)); th.scope = 'col'; header.append(th); }
    head.append(header); const body = make('tbody');
    for (const row of rows) {
      const tr = make('tr');
      const values = [row.descrizione_indicatore || t('missing'), row.descrizione_unita_misura || row.unita_misura || t('missing'),
        c.display('valore_programmato', row.valore_programmato),
        row.valore_realizzato == null && row.observation_values ? t('sourcePeriods') : c.display('valore_realizzato', row.valore_realizzato), period(row), source(row)];
      values.forEach((value, index) => {
        const cell = make('td', '', value); cell.dataset.label = t(headers[index]);
        if (!index) cell.append(make('small', 'indicator-code', [row.codice_indicatore, t(row.indicator_type)].filter(Boolean).join(' · ')));
        tr.append(cell);
      });
      const cell = make('td'); cell.dataset.label = t('detailsLabel');
      const details = make('details', 'indicator-observations');
      details.append(make('summary', '', t('detailsLabel')));
      details.addEventListener('toggle', () => {
        if (details.open && !details.querySelector('.consultation-row')) details.append(c.renderRow(row, 'indicators'));
      });
      cell.append(details); tr.append(cell); body.append(tr);
    }
    table.append(head, body); wrap.append(table); return wrap;
  }
  function mount(panel, cup, project) {
    panel.append(make('p', 'consultation-note', t('progressNotice')));
    const iter = c.section(cup, project, 'phases', false, {renderRows: phases});
    iter.querySelector('.consultation-body').append(make('p', 'consultation-note', t('phaseOrdering')));
    const observations = c.section(cup, project, 'indicators', false, {renderRows: indicators});
    panel.append(iter, observations); iter.open = true; observations.open = true;
  }
  return {mount};
})();
