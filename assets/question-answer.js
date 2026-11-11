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
  let citationSequence = 0;
  function citationControl(source, index, claimIndex = 0, locator = '') {
    const wrapper = make('span', 'question-inline-citation');
    const button = make('button', 'question-citation-button', '[' + index + (locator ? ', ' + locator : '') + ']');
    button.type = 'button';
    button.setAttribute('aria-label', t('questionAnswerSource') + ' ' + index + ': ' + (source.title || '') + (locator ? ', ' + locator : ''));
    const popup = make('span', 'question-citation-popup');
    popup.id = 'question-citation-' + (++citationSequence);
    popup.hidden = true;
    popup.setAttribute('role', 'note');
    button.setAttribute('aria-controls', popup.id);
    button.setAttribute('aria-expanded', 'false');
    popup.append(make('strong', 'question-citation-title', source.title || t('questionAnswerSource')));
    if (locator) popup.append(make('span', 'question-answer-meta', locator));
    const claim = claimIndex > 0 ? source.claims?.[claimIndex - 1] : null;
    if (claim?.statement) popup.append(make('span', 'question-citation-statement', claim.statement));
    if (claim?.supporting_quote) popup.append(make('q', 'question-citation-quotation', claim.supporting_quote));
    if (!claim) popup.append(make('span', 'question-answer-meta', t('questionAnswerSourceOnly')));
    const url = safeUrl(source.url);
    if (url) {
      const link = make('a', '', t('questionAnswerOpenSource'));
      link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; popup.append(link);
    }
    button.addEventListener('click', () => {
      const opening = popup.hidden;
      closeCitations();
      popup.hidden = !opening;
      button.setAttribute('aria-expanded', String(opening));
      if (opening) {
        const rect = button.getBoundingClientRect();
        const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
        popup.style.maxWidth = Math.max(0, viewportWidth - 24) + 'px';
        const width = popup.getBoundingClientRect().width;
        popup.style.left = Math.max(12, Math.min(rect.left, viewportWidth - width - 12)) + 'px';
        const height = popup.getBoundingClientRect().height;
        popup.style.top = Math.max(12, Math.min(rect.bottom + 6, window.innerHeight - height - 12)) + 'px';
      }
    });
    wrapper.append(button, popup);
    return wrapper;
  }
  function closeCitations() {
    for (const popup of document.querySelectorAll('.question-citation-popup')) {
      popup.hidden = true;
      popup.previousElementSibling?.setAttribute('aria-expanded', 'false');
    }
  }
  if (document.addEventListener) {
    document.addEventListener('click', event => {
      if (!event.target.closest?.('.question-inline-citation')) closeCitations();
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        const popup = document.querySelector('.question-citation-popup:not([hidden])');
        const button = popup?.previousElementSibling;
        closeCitations(); button?.focus();
      }
    });
  }
  function decorateAnswer(container, answer) {
    if (!container.querySelectorAll) return;
    const sources = Array.isArray(answer.sources) ? answer.sources : [];
    const citations = Array.isArray(answer.answer_citations) ? answer.answer_citations : [];
    // Only explicit mappings and existing source links are used; no semantic matching.
    for (const paragraph of container.querySelectorAll('p')) {
      const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
      const nodes = []; let node;
      while ((node = walker.nextNode())) nodes.push(node);
      for (const textNode of nodes) {
        const text = textNode.textContent;
        const matches = [];
        for (const match of text.matchAll(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+|urn:ifel:local-document:[a-f0-9]{64})\)/g)) {
          const sourceIndex = sources.findIndex(source => source.reference === match[2]
            || (safeUrl(source.url) && safeUrl(source.url) === safeUrl(match[2])));
          if (sourceIndex >= 0) matches.push({start:match.index, end:match.index + match[0].length,
            sourceIndex, claimIndex:0, locator:''});
        }
        for (const citation of citations) {
          const sourceIndex = citation.source_index - 1;
          const claimIndex = citation.claim_index;
          if (!Number.isInteger(sourceIndex) || !sources[sourceIndex]
            || !Number.isInteger(claimIndex) || claimIndex < 0
            || claimIndex > (sources[sourceIndex].claims || []).length
            || typeof citation.answer_excerpt !== 'string' || !citation.answer_excerpt.trim()
            || typeof citation.locator !== 'string'
            || answer.proposed_answer.split(citation.answer_excerpt).length !== 2) continue;
          const start = text.indexOf(citation.answer_excerpt);
          if (start >= 0) matches.push({start:start + citation.answer_excerpt.length,
            end:start + citation.answer_excerpt.length, sourceIndex, claimIndex, locator:citation.locator});
        }
        if (!matches.length) continue;
        matches.sort((a,b) => a.start - b.start || a.end - b.end);
        const fragment = document.createDocumentFragment(); let end = 0;
        for (const match of matches) {
          if (match.start < end) continue;
          fragment.append(document.createTextNode(text.slice(end, match.start)),
            citationControl(sources[match.sourceIndex], match.sourceIndex + 1, match.claimIndex, match.locator));
          end = match.end;
        }
        fragment.append(document.createTextNode(text.slice(end))); textNode.replaceWith(fragment);
      }
    }
  }
  let layoutsRequest;
  async function applySavedLayout(container, value, identity, answer) {
    try {
      layoutsRequest ||= fetch('/assets/answer-layouts.json').then(response => response.ok ? response.json() : {});
      const saved = (await layoutsRequest).layouts?.[String(identity)];
      if (!saved || !window.crypto?.subtle) return;
      const bytes = new TextEncoder().encode(value);
      const hash = [...new Uint8Array(await window.crypto.subtle.digest('SHA-256', bytes))]
        .map(byte => byte.toString(16).padStart(2, '0')).join('');
      const entry = (Array.isArray(saved) ? saved : [saved]).find(item => item.sha256 === hash);
      if (!entry || !Array.isArray(entry.sections)) return;
      // Stored offsets use Unicode code points, as in the source-side audit.
      const characters = Array.from(value);
      const sections = entry.sections;
      if (!sections.length || sections[0].start !== 0 || sections.some((section, index) =>
        !Number.isInteger(section.start) || section.start < 0 || section.start >= characters.length
        || typeof section.title !== 'string' || !section.title.trim()
        || (index > 0 && section.start <= sections[index - 1].start))) return;
      const nodes = [];
      sections.forEach((section, index) => {
        nodes.push(make('h5', '', section.title));
        nodes.push(make('p', 'question-text', characters.slice(section.start,
          sections[index + 1]?.start ?? characters.length).join('')));
      });
      container.replaceChildren(...nodes);
      decorateAnswer(container, answer);
    } catch {
      // Optional presentation metadata must never prevent opening an answer.
    }
  }
  function answerText(value, identity, answer) {
    const container = make('div', 'question-answer-text');
    for (const block of value.split(/\n\s*\n/)) {
      const text = block.trim();
      if (!text) continue;
      const leading = text.match(/^\*\*([^*\n]+)\*\*[ \t]+([\s\S]+)$/);
      if (leading) {
        container.append(make('h5', '', leading[1]), make('p', 'question-text', leading[2]));
        continue;
      }
      const heading = !text.includes('\n') && (text.match(/^\*\*(.+)\*\*$/) || text.match(/^#{2,4}\s+(.+)$/));
      container.append(make(heading ? 'h5' : 'p', 'question-text', heading ? heading[1] : text));
    }
    decorateAnswer(container, answer);
    applySavedLayout(container, value, identity, answer);
    return container;
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
      make('p', 'question-answer-notice', t('questionAnswerNotice')));
    if (typeof answer.problem === 'string' && answer.problem.trim()) {
      const request = make('section', 'question-answer-request');
      request.append(make('h4', '', t('questionAnswerRequest')), make('p', 'question-text', answer.problem));
      content.append(request);
    }
    const reply = make('section', 'question-answer-main');
    reply.append(make('h4', '', t('questionAnswerProposed')),
      answerText(answer.proposed_answer, row.source_question_id, answer));
    content.append(reply);
    if ([answer.desk_actions, answer.conditions_and_uncertainties, answer.documentation_gaps]
      .some(values => Array.isArray(values) && values.length)) {
      const support = make('section', 'question-answer-support');
      support.append(make('h4', '', t('questionAnswerSupport')));
      listSection(support, 'questionAnswerActions', answer.desk_actions, true);
      listSection(support, 'questionAnswerConditions', answer.conditions_and_uncertainties);
      listSection(support, 'questionAnswerGaps', answer.documentation_gaps);
      content.append(support);
    }
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
  function mountVersions(panel, row, result) {
    if (!Array.isArray(result.versions) || !result.versions.length) return;
    const content = panel.querySelector('.question-answer-content');
    const display = make('div');
    display.append(...content.childNodes);
    const label = make('label', 'question-answer-meta', t('questionAnswerVersions') + ' ');
    const select = make('select', 'question-answer-version-select');
    for (const version of result.versions) {
      const type = version.pipeline === 'autonomous' ?
        (version.stage === 'initial' ? 'questionAnswerAutonomousInitial' : 'questionAnswerAutonomousRevised') : version.pipeline === 'adversarial' ?
        (version.stage === 'initial' ? 'questionAnswerInitial' : 'questionAnswerRevised') : 'questionAnswerOrdinary';
      const option = make('option', '', dateLabel(version.generated_at) + ' — ' + t(type));
      option.value = version.version;
      option.selected = version.version === result.version;
      select.append(option);
    }
    label.append(select); content.append(label, display);
    select.addEventListener('change', async () => {
      const version = select.value;
      select.disabled = true;
      try {
        const response = await fetch('/api/questions/' + encodeURIComponent(row.source_question_id)
          + '/answer?version=' + encodeURIComponent(version));
        if (!response.ok) throw new Error('Version request failed');
        const selected = await response.json();
        if (!panel.isConnected) return;
        if (String(selected.source_question_id) !== String(row.source_question_id)
          || selected.version !== version || selected.status !== 'available'
          || String(selected.answer?.question_id) !== String(row.source_question_id)) throw new Error('Invalid version');
        const heading = make('div'), body = make('div');
        mount({...row, answer:selected.answer}, heading, body);
        const rendered = body.querySelector('.question-answer-content');
        if (!rendered) throw new Error('Invalid version presentation');
        display.replaceChildren(...rendered.childNodes);
        if (selected.update_recommended) {
          display.prepend(make('p', 'question-answer-notice', t('questionAnswerRetainedNotice')));
        }
        if (version !== result.version) {
          display.prepend(make('p', 'question-answer-notice', t('questionAnswerHistoricalVersion')));
        }
        if (selected.previous_question_text && selected.previous_question_text !== row.question_text) {
          const original = make('details', 'question-answer-original-question');
          original.append(make('summary', '', t('questionAnswerOriginalQuestion')),
            make('p', 'question-text', selected.previous_question_text));
          display.prepend(original);
        }
      } catch {
        if (!panel.isConnected) return;
        select.value = select.dataset.loadedVersion || result.version;
        const oldError = content.querySelector('.question-answer-version-error');
        if (oldError) oldError.remove();
        content.append(make('p', 'question-answer-version-error', t('loadError')));
        return;
      } finally { select.disabled = false; }
      select.dataset.loadedVersion = version;
      content.querySelector('.question-answer-version-error')?.remove();
    });
  }
  function mountRemote(row, heading, body) {
    const state = row.answer_summary || {};
    const badge = make('span', 'question-answer-badge' + (state.status === 'available' ? '' : ' question-answer-badge-muted'),
      t(state.status === 'available' ? (state.update_recommended ? 'questionAnswerRetainedBadge' : 'questionAnswerBadge') : stateLabel(state.status)));
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
      const key = String(row.source_question_id) + ':' + state.status + ':' + String(state.version)
        + ':' + Boolean(state.update_recommended) + ':' + JSON.stringify(state.changes || []);
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
        if (previous || result.update_recommended) {
          if (!previous) badge.textContent = t('questionAnswerRetainedBadge');
          if (previous) replacement.querySelector('summary > span').textContent = t('questionAnswerPreviousTitle');
          const notice = make('div', 'question-answer-notice');
          notice.append(make('p', '', t(previous ? 'questionAnswerPreviousNotice' : 'questionAnswerRetainedNotice')));
          if (typeof result.previous_question_text === 'string' && result.previous_question_text === row.question_text) {
            notice.append(make('p', '', t('questionAnswerQuestionUnchanged')));
          }
          const labels = {question_changed:'questionAnswerQuestionChanged', minutes_changed:'questionAnswerMinutesChanged',
            closure_changed:'questionAnswerClosureChanged', status_changed:'questionAnswerStatusChanged',
            appointment_changed:'questionAnswerAppointmentChanged', service_changed:'questionAnswerServiceChanged',
            source_or_context_changed:'questionAnswerSourceChanged', source_changed:'questionAnswerSourceChanged',
            context_changed:'questionAnswerSourceChanged', configuration_changed:'questionAnswerConfigurationChanged'};
          for (const label of new Set((result.changes || []).map(change => labels[change]).filter(Boolean))) {
            notice.append(make('p', '', t(label)));
          }
          if ((result.changes || []).includes('question_changed')) {
            const original = make('details', 'question-answer-original-question');
            original.append(make('summary', '', t('questionAnswerOriginalQuestion')),
              make('p', 'question-text', result.previous_question_text || ''));
            notice.append(original);
          }
          replacement.querySelector('.question-answer-content').prepend(notice);
        } else badge.replaceWith(newHeading.firstElementChild);
        mountVersions(replacement, row, result);
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
