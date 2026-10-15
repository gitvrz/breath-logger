// Dialog windows and notifications (replace the browser's confirm() / prompt()).

// kind: 'info' | 'success' | 'error'
function toast(msg, kind = 'info') {
  const div = document.createElement('div');
  div.className = `toast ${kind}`;
  const ic = { success: 'check', error: 'alert', info: 'info' }[kind];
  div.innerHTML = `${icon(ic, 18)}<span>${escapeHtml(msg)}</span>`;
  $('#toasts').appendChild(div);
  requestAnimationFrame(() => div.classList.add('in'));
  setTimeout(() => {
    div.classList.remove('in');
    setTimeout(() => div.remove(), 250);
  }, kind === 'error' ? 7000 : 3500);
}

// Opens a modal window. Resolves with { fieldName: value, ... } or null if cancelled.
//   fields: [{ name, label, value, placeholder, type: 'text'|'textarea'|'checkbox', maxlength, validate(v) -> error|null }]
function openDialog({ title, text = '', fields = [], confirm = t('dlg.ok'), danger = false, iconName = null }) {
  return new Promise((resolve) => {
    const dlg = $('#dialog');
    let result = null;
    const fieldHtml = fields.map((f, i) => {
      const id = `dlgf${i}`;
      if (f.type === 'checkbox') {
        return `<label class="check"><input type="checkbox" id="${id}" name="${f.name}" ${f.value ? 'checked' : ''}><span>${escapeHtml(f.label)}</span></label>`;
      }
      const common = `id="${id}" name="${f.name}" placeholder="${escapeHtml(f.placeholder || '')}" maxlength="${f.maxlength || 500}" autocomplete="off"`;
      const input = f.type === 'textarea'
        ? `<textarea ${common} rows="4">${escapeHtml(f.value || '')}</textarea>`
        : `<input ${common} value="${escapeHtml(f.value || '')}">`;
      return `<div class="field"><label for="${id}">${escapeHtml(f.label)}</label>${input}<p class="field-error" data-for="${f.name}"></p></div>`;
    }).join('');

    dlg.innerHTML = `
      <form class="dlg" novalidate>
        <div class="dlg-head">
          ${iconName ? `<div class="dlg-icon ${danger ? 'danger' : ''}">${icon(iconName, 20)}</div>` : ''}
          <h3>${escapeHtml(title)}</h3>
        </div>
        ${text ? `<p class="dlg-text">${escapeHtml(text)}</p>` : ''}
        ${fieldHtml}
        <div class="dlg-actions">
          <button type="button" class="btn ghost" data-cancel>${escapeHtml(t('dlg.cancel'))}</button>
          <button type="submit" class="btn ${danger ? 'danger' : 'primary'}">${escapeHtml(confirm)}</button>
        </div>
      </form>`;

    const form = $('form', dlg);
    const values = () => Object.fromEntries(fields.map((f) => {
      const el = form.elements[f.name];
      return [f.name, f.type === 'checkbox' ? el.checked : el.value.trim()];
    }));
    const check = () => {
      let ok = true;
      const v = values();
      for (const f of fields) {
        const err = f.validate ? f.validate(v[f.name]) : null;
        const p = $(`.field-error[data-for="${f.name}"]`, form);
        if (p) p.textContent = err && v[f.name] !== '' ? err : '';
        form.elements[f.name].classList.toggle('invalid', !!err && v[f.name] !== '');
        if (err) ok = false;
      }
      $('button[type=submit]', form).disabled = !ok;
      return ok;
    };
    const confirmDialog = (e) => {
      e.preventDefault();
      if (!dlg.open || !check()) return;
      result = values();
      dlg.close();
    };
    form.addEventListener('input', check);
    form.addEventListener('submit', confirmDialog); // confirm button or Enter key
    $('[data-cancel]', form).onclick = () => dlg.close();
    // Click outside. Must not return false: that would cancel every click inside the
    // dialog (checkboxes could not be toggled, the confirm button would do nothing).
    dlg.onclick = (e) => {
      if (e.target === dlg) dlg.close();
    };
    dlg.onclose = () => resolve(result);
    check();
    dlg.showModal();
    const first = $('input:not([type=checkbox]), textarea', form);
    if (first) {
      first.focus();
      first.select?.();
    } else $('button[type=submit]', form).focus();
  });
}
