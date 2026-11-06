/* Read-only answer presentation. Data is supplied by the owning question card. */
window.aifelQuestionAnswer = (() => {
  const requests = new Map();
  const t = key => window.aifelConsultation.text(key, key);
  const make = (tag, className, value) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined) node.textContent = String(value);
    return node;
  };
  function safeUrl(value) {
    try {
      const url = new URL(value);
      return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
    } catch { return null; }
  }
  function dateLabel(value) {
    const date = value ? new Date(value) : null;
    return date && Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('it-IT', {
      timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    }).format(date) : t('missing');
  }
  function listSection(parent, title, values, ordered = false) {
    if (!Array.isArray(values) || !values.length) return;
    const section = make('section', 'question-answer-section');
    const list = make(ordered ? 'ol' : 'ul', 'question-answer-list');
    for (const value of values) list.append(make('li', '', value));
    section.append(make('h5', '', t(title)), list); parent.append(section);
  }
  function mount(row, heading, body) {
    // An absent field means the transport is not connected, not that no answer exists.
    if (!Object.hasOwn(row, 'answer')) {
      if (Object.hasOwn(row, 'answer_summary')) mountRemote(row, heading, body);
      return;
    }
    const answer = row.answer;
    const available = answer && String(answer.question_id) === String(row.source_question_id)
      && typeof answer.proposed_answer === 'string' && answer.proposed_answer.trim();
    const missing = answer == null;
    const badge = make('span', 'question-answer-badge' + (available ? '' : ' question-answer-badge-muted'),
      t(available ? 'questionAnswerBadge' : missing ? 'questionAnswerMissing' : 'questionAnswerUnavailable'));
    heading.append(badge);
    if (!available) return;
    const panel = make('details', 'question-answer-panel');
    const summary = make('summary', 'question-answer-summary');
    summary.append(make('span', '', t('questionAnswerTitle')),
      make('span', 'question-answer-review', t('questionAnswerPending')));
    const content = make('div', 'question-answer-content');
    content.append(make('p', 'question-answer-meta', t('questionAnswerGenerated') + ' ' + dateLabel(answer.generated_at)),
      make('p', 'question-answer-notice', t('questionAnswerNotice')),
      make('p', 'question-text question-answer-text', answer.proposed_answer));
    listSection(content, 'questionAnswerActions', answer.desk_actions, true);
    listSection(content, 'questionAnswerConditions', answer.conditions_and_uncertainties);
    listSection(content, 'questionAnswerGaps', answer.documentation_gaps);
    const sources = make('details', 'question-answer-sources');
    const items = Array.isArray(answer.sources) ? answer.sources : [];
    sources.append(make('summary', '', t('questionAnswerSources') + ' (' + items.length + ')'));
    sources.append(make('p', 'consultation-note', t('questionAnswerSourcesNotice')));
    for (const [index, source] of items.entries()) {
      const item = make('article', 'question-answer-source');
      const title = make('h5');
      const url = safeUrl(source.url);
      const label = (index + 1) + '. ' + (source.title || t('questionAnswerSource'));
      if (url) {
        const link = make('a', '', label); link.href = url;
        link.target = '_blank'; link.rel = 'noopener noreferrer'; title.append(link);
      } else title.textContent = label;
      item.append(title);
      if (source.member_name) item.append(make('p', 'question-answer-meta',
        t('questionAnswerAttachment') + ': ' + source.member_name));
      for (const claim of source.claims || []) {
        const evidence = make('details', 'question-answer-claim');
        evidence.append(make('summary', '', claim.statement || t('questionAnswerQuotation')),
          make('blockquote', 'question-text', claim.supporting_quote || ''));
        item.append(evidence);
      }
      sources.append(item);
    }
    content.append(sources); panel.append(summary, content); body.append(panel);
  }
  function stateLabel(status) {
    return status === 'outdated' ? 'questionAnswerOutdated' : status === 'missing' ?
      'questionAnswerMissing' : 'questionAnswerUnavailable';
  }
  function mountRemote(row, heading, body) {
    const state = row.answer_summary || {};
    const badge = make('span', 'question-answer-badge' + (state.status === 'available' ? '' : ' question-answer-badge-muted'),
      t(state.status === 'available' ? 'questionAnswerBadge' : stateLabel(state.status)));
    heading.append(badge);
    const historical = state.status === 'outdated' && state.previous_available;
    if (state.status !== 'available' && !historical) {
      if (state.status === 'outdated') body.append(make('p', 'question-answer-notice', t('questionAnswerOutdatedNotice')));
      return;
    }
    const panel = make('details', 'question-answer-panel');
    const summary = make('summary', 'question-answer-summary', t(historical ? 'questionAnswerPreviousTitle' : 'questionAnswerTitle'));
    const content = make('div', 'question-answer-content');
    panel.append(summary, content); body.append(panel);
    let loading = false;
    async function load() {
      if (loading) return;
      loading = true;
      content.replaceChildren(make('p', 'consultation-note', t('loading')));
      const key = String(row.source_question_id) + ':' + state.status + ':' + String(state.version);
      if (!requests.has(key)) {
        const request = fetch('/api/questions/' + encodeURIComponent(row.source_question_id) + '/answer')
          .then(response => { if (!response.ok) throw new Error('Answer request failed'); return response.json(); })
          .catch(error => { requests.delete(key); throw error; });
        requests.set(key, request);
      }
      try {
        const result = await requests.get(key);
        if (!panel.isConnected) return;
        if (String(result.source_question_id) !== String(row.source_question_id)) throw new Error('Question mismatch');
        const previous = historical && result.status === 'outdated' && result.previous_answer;
        if (result.status !== 'available' && !previous) {
          badge.textContent = t(stateLabel(result.status));
          badge.classList.add('question-answer-badge-muted');
          content.replaceChildren(make('p', 'consultation-note',
            t(result.status === 'outdated' ? 'questionAnswerOutdatedNotice' : stateLabel(result.status))));
          return;
        }
        const answer = previous ? result.previous_answer : result.answer;
        if (String(answer?.question_id) !== String(row.source_question_id)) throw new Error('Answer mismatch');
        const newHeading = make('div'), newBody = make('div');
        mount({...row, answer}, newHeading, newBody);
        const replacement = newBody.querySelector('.question-answer-panel');
        if (!replacement) throw new Error('Invalid answer presentation');
        replacement.open = panel.open;
        const hadFocus = panel.contains(document.activeElement);
        if (previous) {
          replacement.querySelector('summary > span').textContent = t('questionAnswerPreviousTitle');
          const notice = make('div', 'question-answer-notice');
          notice.append(make('p', '', t('questionAnswerPreviousNotice')));
          if (typeof result.previous_question_text === 'string' && result.previous_question_text === row.question_text) {
            notice.append(make('p', '', t('questionAnswerQuestionUnchanged')));
          }
          const labels = {question_changed:'questionAnswerQuestionChanged', minutes_changed:'questionAnswerMinutesChanged',
            closure_changed:'questionAnswerClosureChanged', status_changed:'questionAnswerStatusChanged',
            appointment_changed:'questionAnswerAppointmentChanged', service_changed:'questionAnswerServiceChanged',
            source_or_context_changed:'questionAnswerSourceChanged'};
          for (const change of result.changes || []) {
            if (labels[change]) notice.append(make('p', '', t(labels[change])));
          }
          if ((result.changes || []).includes('question_changed')) {
            const original = make('details', 'question-answer-original-question');
            original.append(make('summary', '', t('questionAnswerOriginalQuestion')),
              make('p', 'question-text', result.previous_question_text || ''));
            notice.append(original);
          }
          replacement.querySelector('.question-answer-content').prepend(notice);
        } else badge.replaceWith(newHeading.firstElementChild);
        panel.replaceWith(replacement);
        if (hadFocus) replacement.querySelector('summary').focus({preventScroll:true});
      } catch {
        if (!panel.isConnected) return;
        requests.delete(key);
        const retry = make('button', 'text-button', t('retry')); retry.type = 'button';
        retry.addEventListener('click', load);
        content.replaceChildren(make('p', 'consultation-note', t('loadError')), retry);
      } finally { loading = false; }
    }
    panel.addEventListener('toggle', () => { if (panel.open) load(); });
  }
  return {mount};
})();
