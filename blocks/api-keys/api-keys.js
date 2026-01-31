/**
 * API Keys Block
 * Manage API keys for MCP and programmatic access
 */

import {
  isAuthenticated, getApiKeys, createApiKey, revokeApiKey,
} from '../../scripts/api.js';

export default async function decorate(block) {
  if (!isAuthenticated()) {
    block.innerHTML = `
      <div class="api-keys-auth-required">
        <p>Please <a href="/login">sign in</a> to manage API keys.</p>
      </div>
    `;
    return;
  }

  block.innerHTML = `
    <div class="api-keys-container">
      <div class="api-keys-header">
        <h3>API Keys</h3>
        <button class="button primary create-key-btn">Create New Key</button>
      </div>
      
      <div class="api-keys-description">
        <p>API keys allow you to access DocVault from Claude Desktop, Cursor, and other MCP-compatible clients.</p>
      </div>
      
      <div class="api-keys-list loading">
        <div class="loading-spinner"></div>
      </div>
      
      <!-- Create Key Modal -->
      <div class="api-keys-modal" hidden>
        <div class="modal-backdrop"></div>
        <div class="modal-content">
          <h4>Create API Key</h4>
          <form class="create-key-form">
            <div class="form-group">
              <label for="key-name">Key Name</label>
              <input type="text" id="key-name" name="name" required placeholder="e.g., Claude Desktop" />
            </div>
            <div class="form-group">
              <label for="key-role">Access Level</label>
              <select id="key-role" name="role">
                <option value="viewer">Viewer (read-only)</option>
                <option value="editor">Editor (read/write)</option>
              </select>
            </div>
            <div class="form-group">
              <label for="key-expiry">Expiration</label>
              <select id="key-expiry" name="expiry">
                <option value="">Never expires</option>
                <option value="30">30 days</option>
                <option value="90">90 days</option>
                <option value="365">1 year</option>
              </select>
            </div>
            <div class="form-error" role="alert"></div>
            <div class="modal-actions">
              <button type="button" class="button cancel-btn">Cancel</button>
              <button type="submit" class="button primary">Create Key</button>
            </div>
          </form>
        </div>
      </div>
      
      <!-- Key Created Modal -->
      <div class="api-keys-created-modal" hidden>
        <div class="modal-backdrop"></div>
        <div class="modal-content">
          <h4>API Key Created</h4>
          <p class="warning-text">Copy this key now. You won't be able to see it again!</p>
          <div class="key-display">
            <code class="key-value"></code>
            <button class="button copy-btn" type="button">Copy</button>
          </div>
          <div class="key-usage">
            <h5>Claude Desktop Configuration</h5>
            <pre class="config-example"></pre>
          </div>
          <div class="modal-actions">
            <button type="button" class="button primary done-btn">Done</button>
          </div>
        </div>
      </div>
    </div>
  `;

  const keysList = block.querySelector('.api-keys-list');
  const createModal = block.querySelector('.api-keys-modal');
  const createdModal = block.querySelector('.api-keys-created-modal');
  const createForm = block.querySelector('.create-key-form');

  // Load keys
  await loadKeys();

  // Create key button
  block.querySelector('.create-key-btn').addEventListener('click', () => {
    createModal.hidden = false;
    createForm.reset();
    createForm.querySelector('.form-error').textContent = '';
  });

  // Cancel button
  createModal.querySelector('.cancel-btn').addEventListener('click', () => {
    createModal.hidden = true;
  });

  // Backdrop click
  createModal.querySelector('.modal-backdrop').addEventListener('click', () => {
    createModal.hidden = true;
  });

  createdModal.querySelector('.modal-backdrop').addEventListener('click', () => {
    createdModal.hidden = true;
  });

  // Done button
  createdModal.querySelector('.done-btn').addEventListener('click', () => {
    createdModal.hidden = true;
  });

  // Copy button
  createdModal.querySelector('.copy-btn').addEventListener('click', async () => {
    const keyValue = createdModal.querySelector('.key-value').textContent;
    await navigator.clipboard.writeText(keyValue);
    const copyBtn = createdModal.querySelector('.copy-btn');
    copyBtn.textContent = 'Copied!';
    setTimeout(() => {
      copyBtn.textContent = 'Copy';
    }, 2000);
  });

  // Create form submit
  createForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(createForm);
    const errorEl = createForm.querySelector('.form-error');
    const submitBtn = createForm.querySelector('button[type="submit"]');

    errorEl.textContent = '';
    submitBtn.disabled = true;

    try {
      const result = await createApiKey(
        formData.get('name'),
        formData.get('role'),
        formData.get('expiry') ? parseInt(formData.get('expiry'), 10) : null,
      );

      // Hide create modal
      createModal.hidden = true;

      // Show created modal with key
      showCreatedKey(result);

      // Reload keys list
      await loadKeys();
    } catch (error) {
      errorEl.textContent = error.message;
    } finally {
      submitBtn.disabled = false;
    }
  });

  async function loadKeys() {
    keysList.innerHTML = '<div class="loading-spinner"></div>';
    keysList.classList.add('loading');

    try {
      const { keys } = await getApiKeys();

      if (keys.length === 0) {
        keysList.innerHTML = `
          <div class="api-keys-empty">
            <p>No API keys yet. Create one to get started with MCP integration.</p>
          </div>
        `;
      } else {
        keysList.innerHTML = keys.map((key) => `
          <div class="api-key-item" data-key-id="${key.id}">
            <div class="api-key-info">
              <span class="api-key-name">${escapeHtml(key.name)}</span>
              <span class="api-key-prefix">${key.prefix}...</span>
              <span class="api-key-role badge ${key.role}">${key.role}</span>
            </div>
            <div class="api-key-meta">
              <span class="api-key-created">Created ${formatDate(key.created_at)}</span>
              ${key.last_used_at ? `<span class="api-key-used">Last used ${formatDate(key.last_used_at)}</span>` : ''}
              ${key.expires_at ? `<span class="api-key-expires">Expires ${formatDate(key.expires_at)}</span>` : ''}
            </div>
            <button class="button danger revoke-btn" type="button">Revoke</button>
          </div>
        `).join('');

        // Add revoke handlers
        keysList.querySelectorAll('.revoke-btn').forEach((btn) => {
          btn.addEventListener('click', async () => {
            const item = btn.closest('.api-key-item');
            const keyId = item.dataset.keyId;
            const keyName = item.querySelector('.api-key-name').textContent;

            // eslint-disable-next-line no-alert
            if (!window.confirm(`Are you sure you want to revoke "${keyName}"? This cannot be undone.`)) {
              return;
            }

            btn.disabled = true;
            btn.textContent = 'Revoking...';

            try {
              await revokeApiKey(keyId);
              await loadKeys();
            } catch (error) {
              // eslint-disable-next-line no-alert
              alert(`Failed to revoke key: ${error.message}`);
              btn.disabled = false;
              btn.textContent = 'Revoke';
            }
          });
        });
      }
    } catch (error) {
      keysList.innerHTML = `
        <div class="api-keys-error">
          <p>Failed to load API keys: ${escapeHtml(error.message)}</p>
          <button class="button retry-btn">Retry</button>
        </div>
      `;
      keysList.querySelector('.retry-btn').addEventListener('click', loadKeys);
    } finally {
      keysList.classList.remove('loading');
    }
  }

  function showCreatedKey(result) {
    createdModal.querySelector('.key-value').textContent = result.key;

    const config = {
      mcpServers: {
        docvault: {
          type: 'url',
          url: 'https://your-worker.workers.dev/mcp/sse',
          headers: {
            Authorization: `Bearer ${result.key}`,
          },
        },
      },
    };

    createdModal.querySelector('.config-example').textContent = JSON.stringify(config, null, 2);
    createdModal.hidden = false;
  }

  function formatDate(dateStr) {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();

    if (diff < 60000) return 'just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;

    return date.toLocaleDateString();
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
