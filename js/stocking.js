/* Stocking — intake front door + stage board for the existing Sheet pipeline. */
(function () {
  // No separate "needs analysis" column: anything waiting on information —
  // whether that's research or a measurement off the tag — is details needed.
  const STAGES = [
    { id: 'pasted', label: 'Pasted' },
    { id: 'details_needed', label: 'Details needed' },
    { id: 'ready_for_drafts', label: 'Ready for drafts' },
    { id: 'ready_to_post', label: 'Ready to post' },
    { id: 'done', label: 'Done' },
  ];

  let stockingRows = [];
  let activeDetail = null;

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => (
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
    ));
  }

  function setStatus(el, msg, isError) {
    if (!el) return;
    el.textContent = msg || '';
    el.classList.toggle('error', !!isError);
  }

  async function refreshStocking() {
    const setup = document.getElementById('stockingSetupNote');
    const board = document.getElementById('stockingBoard');
    if (typeof connected === 'function' && !connected()) {
      if (setup) setup.style.display = '';
      if (board) board.innerHTML = '<p class="muted">Connect the Sheet to load Stocking.</p>';
      return;
    }
    if (setup) setup.style.display = 'none';
    if (board) board.innerHTML = '<p class="muted">Loading…</p>';
    try {
      const rows = await apiGetWithRetry('stocking', { timeoutMs: 45000 });
      stockingRows = Array.isArray(rows) ? rows : [];
      renderBoard();
    } catch (err) {
      if (board) {
        board.innerHTML = `<p class="error">Could not load Stocking: ${esc(err.message || err)}</p>`;
      }
    }
  }
  window.refreshStocking = refreshStocking;

  function renderBoard() {
    const board = document.getElementById('stockingBoard');
    if (!board) return;
    const byStage = Object.fromEntries(STAGES.map((s) => [s.id, []]));
    stockingRows.forEach((r) => {
      const stage = byStage[r.stage] ? r.stage : (r.rawEntry && !r.itemId ? 'pasted' : 'details_needed');
      byStage[stage].push(r);
    });
    board.innerHTML = STAGES.map((stage) => {
      const cards = byStage[stage.id];
      return `<div class="stocking-col" data-stage="${esc(stage.id)}">
        <div class="stocking-col-head"><h3>${esc(stage.label)}</h3><span class="count">${cards.length}</span></div>
        <div class="stocking-col-body">${cards.length ? cards.map(cardHtml).join('') : '<p class="muted empty">None</p>'}</div>
      </div>`;
    }).join('');

    board.querySelectorAll('[data-fill-form]').forEach((btn) => {
      btn.addEventListener('click', () => fillFormFrom(btn.getAttribute('data-fill-form')));
    });
    board.querySelectorAll('[data-delete-stocking]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const stockingId = btn.getAttribute('data-delete-stocking');
        if (!confirm(`Bin ${stockingId}? The pasted text goes with it.`)) return;
        btn.disabled = true;
        try {
          const res = await apiPost('deleteStocking', { stockingId });
          if (!res || res.ok === false) throw new Error((res && res.error) || 'Delete failed');
          await refreshStocking();
        } catch (err) {
          alert(err.message || String(err));
          btn.disabled = false;
        }
      });
    });
    board.querySelectorAll('[data-open-stocking]').forEach((btn) => {
      btn.addEventListener('click', () => openDetail(btn.getAttribute('data-open-stocking')));
    });
    board.querySelectorAll('[data-stage-to]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const stockingId = btn.getAttribute('data-stocking-id');
        const itemId = btn.getAttribute('data-item-id');
        const stage = btn.getAttribute('data-stage-to');
        btn.disabled = true;
        try {
          const res = await apiPost('updateStocking', {
            stockingId,
            itemId,
            stage,
            promoteIfDrafts: stage === 'ready_for_drafts',
          });
          if (!res || res.ok === false) throw new Error((res && (res.error || res.message)) || 'Update failed');
          await refreshStocking();
        } catch (err) {
          alert(err.message || String(err));
          btn.disabled = false;
        }
      });
    });
  }

  function cardHtml(r) {
    if (r.stage === 'pasted') return pastedCardHtml(r);
    const title = r.product || r.itemId || r.stockingId;
    const meta = [r.brand, r.model, r.version].filter(Boolean).join(' · ');
    return `<article class="stocking-card">
      <header>
        <b>${esc(title)}</b>
        <span class="mono">${esc(r.itemId || '')}</span>
      </header>
      ${meta ? `<p class="muted">${esc(meta)}</p>` : ''}
      ${r.analysisSummary ? `<p class="stk-summary">${esc(r.analysisSummary)}</p>` : ''}
      ${r.notes ? `<p class="stk-note-line"><b>Details:</b> ${esc(r.notes)}</p>` : ''}
      ${r.error ? `<p class="error">${esc(r.error)}</p>` : ''}
      <div class="stocking-card-actions">
        <button type="button" class="btn secondary small" data-open-stocking="${esc(r.stockingId)}">Open</button>
        ${stageAdvanceBtn(r)}
      </div>
    </article>`;
  }

  function pastedCardHtml(r) {
    return `<article class="stocking-card pasted">
      <header>
        <b>${esc(r.product || r.stockingId)}</b>
        <span class="mono">${esc(r.stockingId)}</span>
      </header>
      <pre class="stk-raw">${esc(r.rawEntry || '')}</pre>
      <p class="muted small">Parked ${esc(r.created || '')} — waiting to be processed.</p>
      <div class="stocking-card-actions">
        <button type="button" class="btn small" data-fill-form="${esc(r.stockingId)}">Fill in myself</button>
        <button type="button" class="btn secondary small" data-delete-stocking="${esc(r.stockingId)}">Bin it</button>
      </div>
    </article>`;
  }

  function stageAdvanceBtn(r) {
    const order = STAGES.map((s) => s.id);
    const idx = order.indexOf(r.stage);
    const next = idx >= 0 && idx < order.length - 1 ? order[idx + 1] : null;
    if (!next) return '';
    const labels = {
      details_needed: 'Needs details',
      ready_for_drafts: 'Submit for drafts',
      ready_to_post: 'Mark ready to post',
      done: 'Mark done',
    };
    return `<button type="button" class="btn small" data-stage-to="${next}" data-stocking-id="${esc(r.stockingId)}" data-item-id="${esc(r.itemId)}">${labels[next] || 'Advance'}</button>`;
  }

  // Hands a parked paste to the manual form. The raw text lands in Notes so
  // nothing is lost if the first line was a poor guess at the product.
  function fillFormFrom(stockingId) {
    const row = stockingRows.find((r) => String(r.stockingId) === String(stockingId));
    if (!row) return;
    const panel = document.getElementById('stockingIntakePanel');
    const product = document.getElementById('stkProduct');
    const notes = document.getElementById('stkNotes');
    const pastedField = document.getElementById('stkPastedId');
    if (panel) panel.open = true;
    if (product) product.value = row.product || '';
    if (notes) notes.value = row.rawEntry || '';
    if (pastedField) pastedField.value = row.stockingId;
    const status = document.getElementById('stkFormStatus');
    setStatus(status, `Processing ${row.stockingId} — saving turns this paste into the item.`);
    if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (product) product.focus();
  }

  async function openDetail(stockingId) {
    const row = stockingRows.find((r) => String(r.stockingId) === String(stockingId));
    if (!row) return;
    const dialog = document.getElementById('stockingDetailDialog');
    const title = document.getElementById('stockingDetailTitle');
    const body = document.getElementById('stockingDetailBody');
    const status = document.getElementById('stkDetailStatus');
    setStatus(status, 'Loading Listing Questions…');
    title.textContent = row.product || row.itemId || stockingId;
    body.innerHTML = `<p class="stk-meta">${esc(row.itemId)} · ${esc(row.stage)} · ${esc(row.sourceTab || '')}</p>
      ${row.analysisSummary ? `<p class="stk-analysis"><b>Analysis</b> — ${esc(row.analysisSummary)}</p>` : ''}
      <div class="stk-detail-field">
        <label for="stkDetailNotes">What's still needed / your answers</label>
        <textarea id="stkDetailNotes" rows="3" placeholder="e.g. Size L. Tested and working. Box included.">${esc(row.notes || '')}</textarea>
        <p class="muted small">Saved onto this item, so it travels with it.</p>
      </div>
      <div id="stkQuestionsWrap"></div>`;
    dialog.showModal();
    activeDetail = { stockingId: row.stockingId, itemId: row.itemId, notes: row.notes || '', questions: [] };
    try {
      const url = `${APPS_SCRIPT_URL}?action=listingQuestions&itemId=${encodeURIComponent(row.itemId)}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('Request failed');
      activeDetail.questions = await res.json();
      if (!Array.isArray(activeDetail.questions)) activeDetail.questions = [];
      renderQuestions();
      setStatus(status, '');
    } catch (err) {
      const wrap = document.getElementById('stkQuestionsWrap');
      if (wrap) wrap.innerHTML = `<p class="error">${esc(err.message || err)}</p>`;
      setStatus(status, '', true);
    }
  }

  function renderQuestions() {
    const wrap = document.getElementById('stkQuestionsWrap');
    if (!wrap) return;
    if (!activeDetail.questions.length) {
      wrap.innerHTML = '';
      return;
    }
    wrap.innerHTML = `<div class="stk-questions">${activeDetail.questions.map((q, i) => `
      <div class="stk-q" data-idx="${i}">
        <label>Q${i + 1}. ${esc(q.questions || q.question || '')}</label>
        ${q.draftPlaceholder ? `<p class="muted small">Draft placeholder: ${esc(q.draftPlaceholder)}</p>` : ''}
        <textarea rows="2" data-q-answer="${i}" placeholder="Your answer">${esc(q.answer || '')}</textarea>
        <p class="muted small">${esc(q.status || '')}</p>
      </div>`).join('')}</div>`;
  }

  async function saveAnswers() {
    if (!activeDetail) return;
    const status = document.getElementById('stkDetailStatus');
    const notesBox = document.getElementById('stkDetailNotes');
    const notes = notesBox ? notesBox.value.trim() : null;
    if (notes !== null && notes !== (activeDetail.notes || '')) {
      setStatus(status, 'Saving…');
      try {
        const res = await apiPost('updateStocking', { stockingId: activeDetail.stockingId, itemId: activeDetail.itemId, notes });
        if (!res || res.ok === false) throw new Error((res && res.error) || 'Save failed');
        activeDetail.notes = notes;
        await refreshStocking();
      } catch (err) {
        setStatus(status, err.message || String(err), true);
        return;
      }
    }
    if (!activeDetail.questions.length) {
      setStatus(status, 'Saved.');
      return;
    }
    const answers = activeDetail.questions.map((q, i) => {
      const ta = document.querySelector(`[data-q-answer="${i}"]`);
      return {
        row: q.sheetRow,
        question: q.questions,
        answer: ta ? ta.value : (q.answer || ''),
      };
    });
    setStatus(status, 'Saving…');
    try {
      const res = await apiPost('saveListingAnswers', { itemId: activeDetail.itemId, answers });
      if (!res || res.ok === false) throw new Error((res && res.error) || 'Save failed');
      setStatus(status, `Saved ${res.updated || answers.length} answer(s).`);
    } catch (err) {
      setStatus(status, err.message || String(err), true);
    }
  }

  async function submitForDrafts() {
    if (!activeDetail) return;
    const status = document.getElementById('stkDetailStatus');
    setStatus(status, 'Submitting for drafts…');
    try {
      if (activeDetail.questions.length) await saveAnswers();
      const res = await apiPost('updateStocking', {
        stockingId: activeDetail.stockingId,
        itemId: activeDetail.itemId,
        stage: 'ready_for_drafts',
      });
      if (!res || res.ok === false) throw new Error((res && res.error) || 'Update failed');
      setStatus(status, 'Moved to Ready for drafts.');
      await refreshStocking();
    } catch (err) {
      setStatus(status, err.message || String(err), true);
    }
  }

  function wireIntake() {
    const form = document.getElementById('stockingIntakeForm');
    const kind = document.getElementById('stkKind');
    const clothingFields = document.querySelectorAll('#stocking .clothing-only');
    function syncKind() {
      const clothing = !kind || kind.value === 'clothing';
      clothingFields.forEach((el) => { el.style.display = clothing ? '' : 'none'; });
    }
    if (kind) kind.addEventListener('change', syncKind);
    syncKind();
    if (!form) return;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const status = document.getElementById('stkFormStatus');
      const btn = document.getElementById('stkSubmitBtn');
      const product = (document.getElementById('stkProduct')?.value || '').trim();
      if (!product) { setStatus(status, 'Product is required.', true); return; }
      const isClothing = kind.value === 'clothing';
      const payload = {
        product,
        brand: (document.getElementById('stkBrand')?.value || '').trim(),
        model: (document.getElementById('stkModel')?.value || '').trim(),
        version: (document.getElementById('stkVersion')?.value || '').trim(),
        category: (document.getElementById('stkCategory')?.value || '').trim() || (isClothing ? 'Clothing' : ''),
        clothingType: (document.getElementById('stkClothingType')?.value || '').trim(),
        size: (document.getElementById('stkSize')?.value || '').trim(),
        condition: (document.getElementById('stkCondition')?.value || '').trim(),
        platforms: (document.getElementById('stkPlatforms')?.value || '').trim(),
        listPrice: (document.getElementById('stkListPrice')?.value || '').trim(),
        estValue: (document.getElementById('stkEstValue')?.value || '').trim(),
        floorPrice: (document.getElementById('stkFloorPrice')?.value || '').trim(),
        notes: (document.getElementById('stkNotes')?.value || '').trim(),
        isClothing,
        addIntakeRow: !!(document.getElementById('stkIntakeRow')?.checked),
        pastedId: (document.getElementById('stkPastedId')?.value || '').trim(),
      };
      btn.disabled = true;
      setStatus(status, 'Creating…');
      try {
        const res = await apiPost('createStocking', payload);
        if (!res || res.ok === false) throw new Error((res && res.error) || 'Create failed');
        setStatus(status, `Created ${res.itemId} (${res.stockingId}) in needs_analysis.`);
        form.reset();
        const pastedField = document.getElementById('stkPastedId');
        if (pastedField) pastedField.value = '';
        if (kind) kind.value = 'clothing';
        syncKind();
        await refreshStocking();
      } catch (err) {
        setStatus(status, err.message || String(err), true);
      } finally {
        btn.disabled = false;
      }
    });
  }

  function wirePaste() {
    const form = document.getElementById('stockingPasteForm');
    if (!form) return;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const status = document.getElementById('stkPasteStatus');
      const btn = document.getElementById('stkPasteBtn');
      const box = document.getElementById('stkPasteText');
      const text = (box?.value || '').trim();
      if (!text) { setStatus(status, 'Paste something first.', true); return; }
      btn.disabled = true;
      setStatus(status, 'Parking…');
      try {
        const res = await apiPost('addStockingPaste', { text });
        if (!res || res.ok === false) throw new Error((res && res.error) || 'Save failed');
        setStatus(status, `Parked as ${res.stockingId}.`);
        if (box) box.value = '';
        await refreshStocking();
      } catch (err) {
        setStatus(status, err.message || String(err), true);
      } finally {
        btn.disabled = false;
      }
    });
  }

  function wireChrome() {
    document.getElementById('stockingRefreshBtn')?.addEventListener('click', () => refreshStocking());
    document.getElementById('stkSaveAnswersBtn')?.addEventListener('click', () => saveAnswers());
    document.getElementById('stkSubmitDraftsBtn')?.addEventListener('click', () => submitForDrafts());
  }

  document.addEventListener('DOMContentLoaded', () => {
    wireIntake();
    wirePaste();
    wireChrome();
  });
})();
