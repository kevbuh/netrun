import Settings from '../core/core-settings.js';
import { apiGet } from '/js/api.js';
import { escapeHtml, escapeAttr } from '/js/core/core-utils.js';

// ─── Panel Settings (utilities — render merged into AI section) ──

export function _loadSettingsModels() {
  const provider = Settings.get('aiProvider') || 'ollama';
  const fetchModels = (window.electronAPI && window.electronAPI.providerModels)
    ? window.electronAPI.providerModels(provider)
    : apiGet('/api/models').then(data => data.models || []);

  fetchModels.then(models => {
    models = models || [];
    document.querySelectorAll('.settings-model-select').forEach(sel => {
      const key = sel.dataset.key;
      const fallback = sel.dataset.fallback;
      const current = Settings.get(key) || fallback;
      sel.innerHTML = models.map(m =>
        `<option value="${escapeAttr(m)}" ${m === current ? 'selected' : ''}>${escapeHtml(m)}</option>`
      ).join('');
      if (current && !models.includes(current)) {
        sel.insertAdjacentHTML('afterbegin',
          `<option value="${escapeAttr(current)}" selected>${escapeHtml(current)}</option>`);
      }
    });
  }).catch(() => {
    document.querySelectorAll('.settings-model-select').forEach(sel => {
      const key = sel.dataset.key;
      const fallback = sel.dataset.fallback;
      const current = Settings.get(key) || fallback;
      sel.innerHTML = `<option value="${escapeAttr(current)}" selected>${escapeHtml(current)}</option>`;
    });
  });
}

