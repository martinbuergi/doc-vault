/**
 * Document Viewer Block
 * View document details, metadata, and content
 */

import {
  isAuthenticated,
  getDocument,
  deleteDocument,
  apiRequest,
  getApiBaseUrl,
} from '../../scripts/api.js';

export default async function decorate(block) {
  if (!isAuthenticated()) {
    block.innerHTML = `
      <div class="viewer-auth-required">
        <p>Please <a href="/login">sign in</a> to view documents.</p>
      </div>
    `;
    return;
  }

  // Get document ID from URL
  const urlParams = new URLSearchParams(window.location.search);
  const docId = urlParams.get('id');

  if (!docId) {
    block.innerHTML = `
      <div class="viewer-error">
        <p>No document specified.</p>
        <a href="/documents" class="button">Back to Documents</a>
      </div>
    `;
    return;
  }

  block.innerHTML = `
    <div class="viewer-container">
      <div class="viewer-loading">
        <div class="loading-spinner"></div>
        <p>Loading document...</p>
      </div>
    </div>
  `;

  try {
    const doc = await getDocument(docId);

    block.innerHTML = `
      <div class="viewer-container">
        <div class="viewer-header">
          <a href="/documents" class="back-link">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
            Back to Documents
          </a>
          <div class="viewer-actions">
            <a href="${getApiBaseUrl()}/api/v1/documents/${docId}/download" class="button download-btn" target="_blank">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Download
            </a>
            <button class="button danger delete-btn" type="button">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              Delete
            </button>
          </div>
        </div>
        
        <div class="viewer-body">
          <main class="viewer-content">
            <div class="viewer-preview" data-mime="${doc.mime_type}">
              ${renderPreview(doc)}
            </div>
          </main>
          
          <aside class="viewer-sidebar">
            <div class="sidebar-section">
              <h3>${escapeHtml(doc.title)}</h3>
              <span class="doc-status ${doc.status}">${doc.status}</span>
            </div>
            
            <div class="sidebar-section">
              <h4>Details</h4>
              <dl class="doc-details">
                <dt>Type</dt>
                <dd>${doc.mime_type}</dd>
                <dt>Size</dt>
                <dd>${formatFileSize(doc.file_size_bytes)}</dd>
                ${doc.page_count ? `<dt>Pages</dt><dd>${doc.page_count}</dd>` : ''}
                <dt>Uploaded</dt>
                <dd>${formatDate(doc.created_at)}</dd>
                <dt>Modified</dt>
                <dd>${formatDate(doc.updated_at)}</dd>
              </dl>
            </div>
            
            <div class="sidebar-section">
              <h4>Tags</h4>
              <div class="doc-tags">
                ${(doc.tags || []).map((tag) => `
                  <span class="tag-chip ${tag.source || ''}" title="${tag.source === 'ai_suggested' ? 'AI Suggested' : 'User Added'}">
                    ${escapeHtml(tag.name)}
                    <button class="tag-remove" data-tag-id="${tag.id}" type="button">&times;</button>
                  </span>
                `).join('')}
                <button class="add-tag-btn" type="button">+ Add Tag</button>
              </div>
              <div class="add-tag-input" hidden>
                <input type="text" placeholder="Enter tag name..." />
                <button class="add-tag-confirm" type="button">Add</button>
                <button class="add-tag-cancel" type="button">Cancel</button>
              </div>
            </div>
            
            ${doc.error_message ? `
              <div class="sidebar-section error-section">
                <h4>Error</h4>
                <p class="error-message">${escapeHtml(doc.error_message)}</p>
              </div>
            ` : ''}
          </aside>
        </div>
      </div>
    `;

    // Setup event handlers
    setupEventHandlers(block, doc);
  } catch (error) {
    block.innerHTML = `
      <div class="viewer-container">
        <div class="viewer-error">
          <p>Failed to load document: ${escapeHtml(error.message)}</p>
          <a href="/documents" class="button">Back to Documents</a>
        </div>
      </div>
    `;
  }

  function renderPreview(doc) {
    const mimeType = doc.mime_type || '';

    if (mimeType.includes('pdf')) {
      // PDF viewer using browser's native viewer
      return `
        <iframe 
          src="${getApiBaseUrl()}/api/v1/documents/${doc.id}/download#toolbar=0" 
          class="pdf-viewer"
          title="PDF Preview"
        ></iframe>
      `;
    }

    if (mimeType.includes('image')) {
      return `
        <img 
          src="${getApiBaseUrl()}/api/v1/documents/${doc.id}/download" 
          alt="${escapeHtml(doc.title)}"
          class="image-viewer"
        />
      `;
    }

    if (mimeType.includes('text') || doc.text_key) {
      // Load and display text
      return `
        <div class="text-viewer">
          <div class="text-loading">Loading text content...</div>
        </div>
      `;
    }

    // Fallback for unsupported types
    return `
      <div class="preview-unavailable">
        <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        <p>Preview not available for this file type</p>
        <a href="${getApiBaseUrl()}/api/v1/documents/${doc.id}/download" class="button" target="_blank">Download to View</a>
      </div>
    `;
  }

  async function setupEventHandlers(blockEl, doc) {
    // Load text content if applicable
    const textViewer = blockEl.querySelector('.text-viewer');
    if (textViewer && doc.status === 'ready') {
      try {
        const response = await apiRequest(`/api/v1/documents/${doc.id}/text`);
        if (response.ok) {
          const data = await response.json();
          textViewer.innerHTML = `<pre class="text-content">${escapeHtml(data.text)}</pre>`;
        } else {
          textViewer.innerHTML = '<p class="text-unavailable">Text content not available</p>';
        }
      } catch {
        textViewer.innerHTML = '<p class="text-unavailable">Failed to load text content</p>';
      }
    }

    // Delete button
    const deleteBtn = blockEl.querySelector('.delete-btn');
    deleteBtn?.addEventListener('click', async () => {
      // eslint-disable-next-line no-alert
      if (!window.confirm(`Delete "${doc.title}"? This cannot be undone.`)) {
        return;
      }

      deleteBtn.disabled = true;
      deleteBtn.innerHTML = 'Deleting...';

      try {
        await deleteDocument(doc.id);
        window.location.href = '/documents';
      } catch (error) {
        // eslint-disable-next-line no-alert
        alert(`Failed to delete: ${error.message}`);
        deleteBtn.disabled = false;
        deleteBtn.innerHTML = `
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          Delete
        `;
      }
    });

    // Add tag functionality
    const addTagBtn = blockEl.querySelector('.add-tag-btn');
    const addTagInput = blockEl.querySelector('.add-tag-input');
    const tagInput = addTagInput?.querySelector('input');

    addTagBtn?.addEventListener('click', () => {
      addTagBtn.hidden = true;
      addTagInput.hidden = false;
      tagInput?.focus();
    });

    addTagInput?.querySelector('.add-tag-cancel')?.addEventListener('click', () => {
      addTagInput.hidden = true;
      addTagBtn.hidden = false;
      tagInput.value = '';
    });

    addTagInput?.querySelector('.add-tag-confirm')?.addEventListener('click', async () => {
      const tagName = tagInput?.value.trim();
      if (!tagName) return;

      try {
        await apiRequest(`/api/v1/documents/${doc.id}/tags`, {
          method: 'PUT',
          body: JSON.stringify({ tags: [tagName], action: 'add' }),
        });

        // Reload page to show updated tags
        window.location.reload();
      } catch (error) {
        // eslint-disable-next-line no-alert
        alert(`Failed to add tag: ${error.message}`);
      }
    });

    tagInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        addTagInput.querySelector('.add-tag-confirm')?.click();
      } else if (e.key === 'Escape') {
        addTagInput.querySelector('.add-tag-cancel')?.click();
      }
    });

    // Remove tag
    blockEl.querySelectorAll('.tag-remove').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const { tagId } = btn.dataset;

        try {
          await apiRequest(`/api/v1/documents/${doc.id}/tags`, {
            method: 'PUT',
            body: JSON.stringify({ tag_ids: [tagId], action: 'remove' }),
          });

          btn.closest('.tag-chip')?.remove();
        } catch (error) {
          // eslint-disable-next-line no-alert
          alert(`Failed to remove tag: ${error.message}`);
        }
      });
    });
  }

  function formatFileSize(bytes) {
    if (!bytes) return 'Unknown';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function formatDate(dateStr) {
    if (!dateStr) return 'Unknown';
    const date = new Date(dateStr);
    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
