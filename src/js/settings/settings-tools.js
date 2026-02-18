// ─── Tools Settings ──────────────────────────────────────

function _renderToolsSettings() {
  var chatToolsToggle = _settingToggleLS(null, null, 'chatTools', { defaultOn: true });
  var chatToolsSection = _settingSection('Chat Tools', [chatToolsToggle], { desc: 'Let the chat assistant use tools autonomously. Requires qwen3:8b.' });

  var clickAetherSection = _settingSection(null, [
    _settingToggleLS('Click Aether', 'Right-click anywhere to open an aether panel with chat and web search', 'clickAether', { defaultOn: true })
  ], { borderTop: true });

  var vaultInput = new View('input');
  vaultInput.el.type = 'text'; vaultInput.el.id = 'vault-path-input';
  vaultInput.className('flex-1 px-3 py-1.5 rounded-md text-[0.8rem] border border-border-input bg-card text-primary placeholder:text-dimmer outline-none focus:border-accent');
  vaultInput.el.placeholder = 'Loading...';
  var saveBtn = new View('button');
  saveBtn.el.textContent = 'Save';
  saveBtn.className('px-3 py-1.5 rounded-md text-[0.78rem] border border-border-input text-muted bg-card hover:border-accent hover:text-primary cursor-pointer transition-colors');
  saveBtn.onTap(function() { saveVaultPath(); });
  var resetBtn = new View('button');
  resetBtn.el.textContent = 'Reset';
  resetBtn.className('px-3 py-1.5 rounded-md text-[0.78rem] border border-border-input text-muted bg-card hover:border-accent hover:text-primary cursor-pointer transition-colors');
  resetBtn.onTap(function() { resetVaultPath(); });
  var vaultSection = _settingSection('Vault', [
    HStack(vaultInput, saveBtn, resetBtn).spacing(2),
    RawHTML('<div id="vault-path-status" class="text-[0.75rem] mt-2 text-dimmer"></div>')
  ], { borderTop: true, desc: 'Set a custom folder for your notes. Uses ~/Documents/Vault by default.' });

  return VStack(chatToolsSection, clickAetherSection, vaultSection);
}

async function loadVaultPath() {
  const input = document.getElementById('vault-path-input');
  const status = document.getElementById('vault-path-status');
  if (!input) return;
  try {
    const data = await apiGet('/api/vault/path');
    input.value = data.path || '';
    input.placeholder = data.default || '';
    if (status) {
      status.textContent = data.isCustom ? 'Using custom path' : 'Using default path';
      status.className = 'text-[0.75rem] mt-2 ' + (data.isCustom ? 'text-accent' : 'text-dimmer');
    }
  } catch (e) {
    if (status) status.textContent = 'Failed to load vault path';
  }
}

async function saveVaultPath() {
  const input = document.getElementById('vault-path-input');
  const status = document.getElementById('vault-path-status');
  if (!input) return;
  const path = input.value.trim();
  try {
    const data = await apiPut('/api/vault/path', { path });
    input.value = data.path || '';
    if (status) {
      status.textContent = data.message;
      status.className = 'text-[0.75rem] mt-2 text-green-500';
    }
    if (window.location.hash === '#vault') {
      loadVaultNotes();
      renderVaultFileTree();
    }
  } catch (e) {
    if (status) {
      status.textContent = e.error || 'Failed to save vault path';
      status.className = 'text-[0.75rem] mt-2 text-red-400';
    }
  }
}

async function resetVaultPath() {
  const input = document.getElementById('vault-path-input');
  const status = document.getElementById('vault-path-status');
  try {
    await apiPut('/api/vault/path', { path: '' });
    loadVaultPath();
    if (status) {
      status.textContent = 'Reset to default';
      status.className = 'text-[0.75rem] mt-2 text-green-500';
    }
    if (window.location.hash === '#vault') {
      loadVaultNotes();
      renderVaultFileTree();
    }
  } catch (e) {
    if (status) {
      status.textContent = 'Failed to reset';
      status.className = 'text-[0.75rem] mt-2 text-red-400';
    }
  }
}
