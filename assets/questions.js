/* Current, literal CUP citations shared by every CLP workspace. */
window.aifelQuestions = (() => {
  const consultation = window.aifelConsultation;
  const t = (key) => consultation.text(key, key);
  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
  };
  function dateLabel(value) {
    if (!value) return t('missing');
    const date = String(value).slice(0, 10).split('-').reverse().join('/');
    const time = String(value).slice(11, 16);
    return date + (time ? ' · ' + time : '');
  }
  function stateLabel(value) {
    if (!value) return '';
    try {
      const states = JSON.parse(value);
      if (Array.isArray(states) && states.every((state) => typeof state === 'string')) return states.filter(Boolean).join(' · ');
    } catch (error) {
      // Native status values may be plain text rather than JSON arrays.
    }
    return value;
  }
  function deskBadge(value) {
    const name = String(value || '').trim();
    if (!name || /^[—–-]+$/.test(name)) return null;
    const key = name.normalize('NFKC').replace(/\s+/g, ' ').toUpperCase();
    const code = key.match(/^\((\d+)\)/)?.[1];
    const hues = {'301': 210, '303': 270, '402': 145, '403': 25,
      '404': 330, '405': 180, '406': 55, '407': 245};
    let hash = 0;
    for (const character of key) hash = (Math.imul(hash, 31) + character.codePointAt(0)) >>> 0;
    const badge = make('span', 'question-desk-badge', name);
    badge.style.setProperty('--desk-hue', String(hues[code] ?? hash % 360));
    badge.title = t('questionDesk') + ': ' + name;
    return badge;
  }
  function questionCard(row) {
    const card = make('details', 'question-card');
    const summary = make('summary', 'question-summary');
    const heading = make('span', 'question-heading');
    const title = make('span', 'question-title');
    title.append(make('strong', '', t('questionId') + ' ' + row.source_question_id));
    const badge = deskBadge(row.desk);
    if (badge) title.append(badge);
    heading.append(title,
      make('span', 'question-date', t('questionAppointment') + ': ' + dateLabel(row.appointment_at)));
    const entity = make('span', 'question-entity', t('questionEntity') + ': ' + (row.requester_entity || t('missing')));
    const status = make('span', 'question-status', t('questionStatus') + ': ' + (stateLabel(row.outcome_status) || stateLabel(row.external_status) || t('missing')));
    const citations = make('span', 'question-citations');
    for (const field of ['question_text', 'consultation_minutes']) {
      if ((row.citation_fields || []).includes(field)) citations.append(make('span', 'question-citation',
        t(field === 'question_text' ? 'cupCitedInQuestion' : 'cupCitedInMinutes')));
    }
    summary.append(heading, entity, status, citations);
    if (row.cited_cups) {
      const name = [row.requester_first_name, row.requester_last_name].filter(Boolean).join(' ');
      if (name) summary.append(make('span', 'question-entity', t('questionRequester') + ': ' + name));
      summary.append(make('span', 'question-entity question-preview', (row.question_text || '').slice(0, 160)));
      if (!row.cited_cups.length) citations.append(make('span', 'question-citation', t('questionNoCups')));
      for (const cup of row.cited_cups) {
        const link = make('a', 'question-citation', cup); link.href = '/?cup=' + encodeURIComponent(cup);
        link.addEventListener('click', (event) => event.stopPropagation()); citations.append(link);
      }
    }
    const body = make('div', 'question-body');
    function fieldsSection(title, fields) {
      const section = make('section', 'question-section');
      section.append(make('h4', '', t(title)));
      const grid = make('dl', 'question-fields');
      for (const [label, value] of fields) {
        const field = make('div', 'question-field');
        field.append(make('dt', '', t(label)), make('dd', '', value || t('missing')));
        grid.append(field);
      }
      section.append(grid); body.append(section);
      return section;
    }
    fieldsSection('questionRequester', [
      ['questionFirstName', row.requester_first_name], ['questionLastName', row.requester_last_name],
      ['questionEntity', row.requester_entity], ['questionEmail', row.requester_email],
      ['questionMobile', row.requester_mobile], ['questionPhone', row.requester_phone]
    ]);
    fieldsSection('questionConsultation', [
      ['questionService', row.service], ['questionDesk', row.desk],
      ['questionBooked', dateLabel(row.booked_at)], ['questionAppointment', dateLabel(row.appointment_at)],
      ['questionOutcome', stateLabel(row.outcome_status)], ['questionExternalStatus', stateLabel(row.external_status)],
      ['questionClosed', row.closed_definitively == null ? t('missing') : t(row.closed_definitively ? 'questionYes' : 'questionNo')]
    ]);
    const references = fieldsSection('questionReferences', [
      ...(row.cup ? [['questionCurrentCup', row.cup]] : []),
      ['questionMeasures', (row.cited_measures || []).join(' · ') || t('questionNoMeasures')]
    ]);
    const linkedCups = row.cited_cups || row.other_cups || [];
    if (linkedCups.length) {
      const section = make('section', 'question-text-section');
      section.append(make('h4', '', t(row.cited_cups ? 'questionCitedCups' : 'questionOtherCups')));
      const links = make('div', 'question-cup-links');
      for (const cup of linkedCups) {
        const link = make('a', 'question-citation', cup);
        link.href = '/?cup=' + encodeURIComponent(cup);
        links.append(link);
      }
      section.append(links);
      references.append(section);
    } else if (row.cited_cups) {
      references.append(make('p', 'consultation-note', t('questionNoCups')));
    }
    for (const [key, value] of [['questionText', row.question_text], ['consultationMinutes', row.consultation_minutes]]) {
      const section = make('section', 'question-section question-text-section');
      section.append(make('h4', '', t(key)), make('p', 'question-text', value || t('missing')));
      body.append(section);
    }
    fieldsSection('questionProvenance', [
      ['questionDataSource', 'CEPOSTO'],
      ['questionExtracted', dateLabel(row.source_extracted_at)],
      ['questionImported', dateLabel(row.source_imported_at)]
    ]);
    body.append(make('p', 'consultation-source', t('questionSource')));
    card.append(summary, body);
    return card;
  }
  function create(cup) {
    const cache = new Map();
    const page = (offset) => {
      if (!cache.has(offset)) {
        const query = new URLSearchParams({offset: String(offset), limit: '25'});
        cache.set(offset, fetch('/api/cup/' + encodeURIComponent(cup) + '/questions?' + query).then((response) => {
          if (!response.ok) throw new Error('Question request failed.');
          return response.json();
        }).catch((error) => { cache.delete(offset); throw error; }));
      }
      return cache.get(offset);
    };
    async function mount(host) {
      await consultation.ready;
      if (!host.isConnected) return;
      host.append(make('p', 'consultation-note questions-scope', t('questionsCupScope')));
      const heading = make('h3', 'section-title', t('tab_questions'));
      const list = make('div', 'question-list');
      const controls = make('div', 'question-controls');
      host.append(heading, list, controls);
      let offset = 0;
      async function load() {
        controls.replaceChildren(make('p', 'consultation-note', t('loading')));
        try {
          const result = await page(offset);
          if (!host.isConnected) return;
          controls.replaceChildren();
          if (!result.available) {
            list.append(make('p', 'empty-state', t('questionsUnavailable')));
            return;
          }
          heading.textContent = t('tab_questions') + ' · ' + result.total;
          if (!result.total) list.append(make('p', 'empty-state', t('noExplicitQuestions')));
          for (const row of result.rows) list.append(questionCard(row));
          offset += result.rows.length;
          if (offset < result.total) {
            const more = make('button', 'text-button', t('moreQuestions') + ' (' + offset + ' / ' + result.total + ')');
            more.type = 'button'; more.addEventListener('click', load); controls.append(more);
          }
        } catch (error) {
          if (!host.isConnected) return;
          controls.replaceChildren(make('p', 'consultation-note', t('loadError')));
          const retry = make('button', 'text-button', t('retry'));
          retry.type = 'button'; retry.addEventListener('click', load); controls.append(retry);
        }
      }
      await load();
    }
    return {mount};
  }
  return {create, questionCard};
})();
