/* Isolated local preview; this page does not call the production API. */
(async () => {
  await window.aifelConsultation.ready;
  const t = key => window.aifelConsultation.text(key, key);
  for (const node of document.querySelectorAll('[data-message]')) node.textContent = t(node.dataset.message);
  const host = document.querySelector('#answer-preview-list');
  try {
    const response = await fetch('./preview-data.json');
    if (!response.ok) throw new Error('Preview data is unavailable');
    const payload = await response.json();
    const rows = payload.rows;
    const count = document.querySelector('#answer-preview-count');
    const search = document.querySelector('#answer-preview-search');
    function render() {
      const query = search.value.toLocaleLowerCase('it').trim();
      const matching = rows.filter(row => [row.source_question_id, row.requester_entity,
        row.question_text, row.answer?.proposed_answer].join(' ').toLocaleLowerCase('it').includes(query));
      host.replaceChildren(...matching.map(row => window.aifelQuestions.questionCard(row)));
      count.textContent = matching.length + ' / ' + rows.length + ' ' + t('questionAnswerPreviewCount');
    }
    search.addEventListener('input', render); render();
    // Demonstrate the empty state without fabricating a question or appointment.
    window.aifelQuestionAnswer.mount({source_question_id:'state-example', answer:null},
      document.querySelector('#answer-preview-empty'), document.createElement('div'));
  } catch {
    host.textContent = t('questionAnswerPreviewError');
  }
})();
