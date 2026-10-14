/* Appointment navigation and the full current question archive. */
(async () => {
  await window.aifelConsultation.ready;
  const t = (key) => window.aifelConsultation.text(key, key);
  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const host = document.querySelector('#questions-home');
  if (new URLSearchParams(location.search).has('cup')) return;
  const title = make('h2', '', t('questionsUpcoming'));
  const modeBar = make('div', 'question-mode-bar');
  const upcoming = make('button', 'text-button', t('questionsUpcoming'));
  const archive = make('button', 'text-button', t('questionsArchive'));
  upcoming.type = archive.type = 'button';
  modeBar.append(upcoming, archive);
  const filters = make('div', 'question-home-filters');
  const periodLabel = make('label', '', t('questionsPeriod'));
  const period = make('select'); period.id = 'questions-period'; periodLabel.htmlFor = period.id;
  const searchLabel = make('label', '', t('questionsSearch'));
  const search = make('input'); search.id = 'questions-search'; search.type = 'search'; search.maxLength = 200;
  search.placeholder = t('questionsSearchHint'); searchLabel.htmlFor = search.id;
  const periodField = make('div'); periodField.append(periodLabel, period);
  const searchField = make('div'); searchField.append(searchLabel, search);
  filters.append(periodField, searchField);
  const count = make('p', 'consultation-note'); count.setAttribute('aria-live', 'polite');
  const list = make('div', 'question-list');
  const controls = make('div', 'question-controls');
  host.append(modeBar, title, filters, count, list, controls);
  let offset = 0, generation = 0, timer, controller, projectOpened = false;
  window.addEventListener('aifel:project-opened', () => {
    projectOpened = true; controller?.abort(); clearTimeout(timer); host.hidden = true;
  });
  function mode(isArchive) {
    title.textContent = t(isArchive ? 'questionsArchive' : 'questionsUpcoming');
    upcoming.setAttribute('aria-pressed', String(!isArchive));
    archive.setAttribute('aria-pressed', String(isArchive));
    period.replaceChildren();
    for (const value of (isArchive ? ['all', 'future', 'today', 'week', 'past'] : ['future', 'today', 'week'])) {
      const option = make('option', '', t('questionsPeriod_' + value)); option.value = value; period.append(option);
    }
    reset();
  }
  async function load(token, append = false) {
    controller?.abort(); controller = new AbortController();
    controls.replaceChildren(make('p', 'consultation-note', t('loading')));
    try {
      const query = new URLSearchParams({period: period.value, search: search.value.trim(), offset: String(offset), limit: '25'});
      const response = await fetch('/api/questions?' + query, {signal: controller.signal});
      if (!response.ok) throw new Error('Question archive request failed.');
      const result = await response.json();
      if (token !== generation || projectOpened) return;
      if (!result.available) { host.hidden = true; return; }
      host.hidden = false;
      if (!append) list.replaceChildren();
      controls.replaceChildren();
      count.textContent = result.total + ' ' + t(result.total === 1 ? 'questionFound' : 'questionsFound');
      if (!result.total) list.append(make('p', 'empty-state', t('questionsNoAppointments')));
      for (const row of result.rows) list.append(window.aifelQuestions.questionCard(row));
      offset += result.rows.length;
      if (offset < result.total) {
        const more = make('button', 'text-button', t('moreQuestions') + ' (' + offset + ' / ' + result.total + ')');
        more.type = 'button'; more.addEventListener('click', () => load(token, true)); controls.append(more);
      }
    } catch (error) {
      if (error.name === 'AbortError' || token !== generation || projectOpened) return;
      host.hidden = false;
      controls.replaceChildren(make('p', 'consultation-note', t('loadError')));
      const retry = make('button', 'text-button', t('retry')); retry.type = 'button';
      retry.addEventListener('click', () => load(token, append)); controls.append(retry);
    }
  }
  function reset() {
    clearTimeout(timer); generation += 1; offset = 0; list.replaceChildren();
    load(generation);
  }
  upcoming.addEventListener('click', () => mode(false)); archive.addEventListener('click', () => mode(true));
  period.addEventListener('change', reset);
  search.addEventListener('input', () => {
    controller?.abort(); generation += 1; clearTimeout(timer); timer = setTimeout(reset, 250);
  });
  mode(false);
})();
