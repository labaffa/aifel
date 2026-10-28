/* One set of filters for demand counts and the appointment list. */
(async () => {
  await window.aifelConsultation.ready;
  if (new URLSearchParams(location.search).has('cup')) return;
  const t = key => window.aifelConsultation.text(key, key);
  const make = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const host = document.querySelector('#questions-home');
  const title = make('h2', '', t('questionsWorkspace'));
  const filters = make('div', 'question-home-filters question-shared-filters');
  function selectField(id, label, values) {
    const field = make('div');
    const caption = make('label', '', label); caption.htmlFor = id;
    const select = make('select'); select.id = id;
    for (const [value, text] of values) {
      const option = make('option', '', text); option.value = value; select.append(option);
    }
    field.append(caption, select); filters.append(field); return select;
  }
  const period = selectField('questions-period', t('questionsPeriod'), [
    ['fortnight', t('demandFortnight')], ['future', t('demandAllFuture')],
    ['today', t('questionsPeriod_today')], ['week', t('questionsPeriod_week')],
    ['past', t('questionsPeriod_past')], ['all', t('questionsArchive')]]);
  if (new URLSearchParams(location.search).get('consultations') === 'all') period.value = 'all';
  const desk = selectField('questions-desk', t('demandDesk'), [['*', t('demandAllDesks')]]);
  const searchField = make('div');
  const searchLabel = make('label', '', t('questionsSearch')); searchLabel.htmlFor = 'questions-search';
  const search = make('input'); search.id = 'questions-search'; search.type = 'search'; search.maxLength = 200;
  search.placeholder = t('questionsSearchHint'); searchField.append(searchLabel, search); filters.append(searchField);
  const demand = make('section', 'question-demand'); demand.id = 'questions-demand';
  demand.setAttribute('aria-labelledby', 'demand-title');
  const demandTitle = make('h3', '', t('demandTitle')); demandTitle.id = 'demand-title';
  const status = make('p', 'consultation-note'); status.setAttribute('aria-live', 'polite');
  const freshness = make('p', 'consultation-note');
  const groups = make('div', 'demand-groups');
  const note = make('p', 'consultation-note', t('demandMultiLabel'));
  demand.append(demandTitle, status, freshness, groups, note);
  const listHeading = make('div', 'question-list-heading');
  const listTitle = make('h3', '', t('questionsUpcoming'));
  const clearCategory = make('button', 'text-button', t('demandClearCategory')); clearCategory.type = 'button'; clearCategory.hidden = true;
  listHeading.append(listTitle, clearCategory);
  const count = make('p', 'consultation-note'); count.setAttribute('aria-live', 'polite');
  const list = make('div', 'question-list'); list.id = 'questions-results';
  const controls = make('div', 'question-controls');
  host.append(title, filters, demand, listHeading, count, list, controls);
  let category = null, offset = 0, generation = 0, timer, controller, projectOpened = false;
  window.addEventListener('aifel:project-opened', () => {
    projectOpened = true; generation += 1; controller?.abort(); clearTimeout(timer); host.hidden = true;
  });
  function renderGroups(result) {
    const historical = ['all', 'past'].includes(period.value);
    demand.hidden = historical;
    status.textContent = result.total_questions + ' ' + t('questionsFound') + ' · ' +
      result.classified_questions + ' ' + t('demandClassified') + ' · ' +
      result.unclassified_questions + ' ' + t('demandUnclassified');
    const date = result.run?.completed_at;
    freshness.textContent = date ? t('demandUpdated') + ' ' + new Intl.DateTimeFormat('it-IT', {
      dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Rome'}).format(new Date(date)) : t('demandNoRun');
    groups.replaceChildren();
    note.hidden = !result.demand_available;
    if (!result.demand_available) {
      status.textContent = t('demandUnavailable'); freshness.textContent = ''; return;
    }
    function groupButton(code, label, total) {
      const button = make('button', 'demand-group'); button.type = 'button';
      button.append(make('strong', 'demand-count', String(total)), make('span', '', label));
      button.setAttribute('aria-pressed', String(category === code));
      button.setAttribute('aria-controls', list.id);
      button.addEventListener('click', () => {
        category = category === code ? null : code; reset(false);
      });
      groups.append(button);
    }
    for (const item of result.categories) {
      if (item.question_count || category === item.code) groupButton(item.code, item.label, item.question_count);
    }
    if (result.unclassified_questions || category === 'unclassified') {
      groupButton('unclassified', t('demandUnclassified'), result.unclassified_questions);
    }
  }
  function questionRow(row) {
    const wrapper = make('div', 'demand-question');
    for (const item of (row.demand_classification?.assignments || []).filter(item => item.category_code === category)) {
      wrapper.append(make('p', 'demand-summary', item.request_summary));
      const evidence = make('details', 'demand-evidence');
      evidence.append(make('summary', '', t('demandEvidence')));
      for (const quote of item.evidence_quotes) evidence.append(make('blockquote', '', quote));
      wrapper.append(evidence);
    }
    if (category && row.demand_classification?.needs_review) {
      wrapper.append(make('p', 'consultation-note', t('demandNeedsReview')));
    }
    const card = window.aifelQuestions.questionCard(row);
    const classifiedAt = row.demand_classification?.classified_at;
    if (classifiedAt) {
      const body = card.querySelector('.question-body');
      const date = new Intl.DateTimeFormat('it-IT', {
        dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Rome'}).format(new Date(classifiedAt));
      body?.append(make('p', 'consultation-note', t('demandClassifiedAt') + ' ' + date));
    }
    wrapper.append(card); return wrapper;
  }
  async function load(token, append = false) {
    controller?.abort(); controller = new AbortController();
    host.hidden = false; host.setAttribute('aria-busy', 'true');
    controls.replaceChildren(make('p', 'consultation-note', t('loading')));
    try {
      const query = new URLSearchParams({period: period.value, search: search.value.trim(), offset: String(offset), limit: '25'});
      if (desk.value !== '*') query.set('desk', desk.value);
      if (category) query.set('category', category);
      const response = await fetch('/api/questions/demand?' + query, {signal: controller.signal});
      if (!response.ok) throw new Error('Question workspace request failed');
      const result = await response.json();
      if (token !== generation || projectOpened) return;
      if (!result.available) { host.hidden = true; return; }
      const selectedDesk = desk.value;
      desk.replaceChildren();
      const all = make('option', '', t('demandAllDesks')); all.value = '*'; desk.append(all);
      const options = [...result.desks];
      if (selectedDesk !== '*' && !options.includes(selectedDesk)) options.push(selectedDesk);
      for (const value of options) {
        const option = make('option', '', value || t('demandUnknownDesk')); option.value = value; desk.append(option);
      }
      desk.value = selectedDesk;
      renderGroups(result);
      const categoryLabel = category === 'unclassified' ? t('demandUnclassified') :
        result.categories.find(item => item.code === category)?.label;
      listTitle.textContent = categoryLabel || t(['all', 'past'].includes(period.value) ? 'questionsArchive' : 'questionsUpcoming');
      clearCategory.hidden = !category;
      count.textContent = result.total + ' ' + t(result.total === 1 ? 'questionFound' : 'questionsFound');
      if (!append) list.replaceChildren();
      for (const row of result.rows) list.append(questionRow(row));
      if (!result.total) list.append(make('p', 'empty-state', t('questionsNoAppointments')));
      offset += result.rows.length;
      controls.replaceChildren();
      if (offset < result.total) {
        const more = make('button', 'text-button', t('moreQuestions') + ' (' + offset + ' / ' + result.total + ')');
        more.type = 'button'; more.addEventListener('click', () => load(token, true)); controls.append(more);
      }
    } catch (error) {
      if (error.name === 'AbortError' || token !== generation || projectOpened) return;
      controls.replaceChildren(make('p', 'consultation-note', t('loadError')));
      const retry = make('button', 'text-button', t('retry')); retry.type = 'button';
      retry.addEventListener('click', () => load(token, append)); controls.append(retry);
    } finally {
      if (token === generation) host.setAttribute('aria-busy', 'false');
    }
  }
  function reset(clear = true) {
    controller?.abort(); clearTimeout(timer); generation += 1; offset = 0;
    if (clear) category = null;
    list.replaceChildren(); groups.replaceChildren(); status.textContent = t('loading');
    count.textContent = ''; clearCategory.hidden = !category;
    load(generation);
  }
  clearCategory.addEventListener('click', () => reset());
  for (const field of [period, desk]) field.addEventListener('change', () => reset());
  search.addEventListener('input', () => {
    controller?.abort(); generation += 1; clearTimeout(timer);
    // Do not leave results from the previous query visible during debounce.
    list.replaceChildren(); groups.replaceChildren(); count.textContent = ''; status.textContent = t('loading');
    timer = setTimeout(() => reset(false), 250);
  });
  reset();
})();
