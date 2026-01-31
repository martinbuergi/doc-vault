/**
 * Document List Block
 * Grid/list view of documents with status indicators
 */

import {
  isAuthenticated, getDocuments, deleteDocument, getDocument,
} from '../../scripts/api.js';

export default async function decorate(block) {
  if (!isAuthenticated()) {
    block.innerHTML = `
      <div class="document-list-auth-required">
        <p>Please <a href="/login">sign in</a> to view your documents.</p>
      </div>
    `;
    return;
  }

  // State
  let viewMode = localStorage.getItem('docvault_view_mode') || 'grid';
  let currentPage = 0;
  const pageSize = 20;

  block.innerHTML = `
    <div class="document-list-container">
      <div class="document-list-header">
        <div class="document-list-stats">
          <span class="doc-count">Loading...</span>
        </div>
        <div class="document-list-controls">
          <div class="view-toggle" role="group" aria-label="View mode">
            <button class="view-btn grid ${viewMode === 'grid' ? 'active' : ''}" data-view="grid" title="Grid view">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
            </button>
            <button class="view-btn list ${viewMode === 'list' ? 'active' : ''}" data-view="list" title="List view">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
            </button>
          </div>
        </div>
      </div>
      
      <div class="document-list-content ${viewMode}" data-view="${viewMode}">
        <div class="loading-spinner"></div>
      </div>
      
      <div class="document-list-pagination"></div>
    </div>
  `;

  const content = block.querySelector('.document-list-content');
  const pagination = block.querySelector('.document-list-pagination');
  const docCount = block.querySelector('.doc-count');

  // View toggle
  block.querySelectorAll('.view-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      viewMode = btn.dataset.view;
      localStorage.setItem('docvault_view_mode', viewMode);

      block.querySelectorAll('.view-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');

      content.className = `document-list-content ${viewMode}`;
      content.dataset.view = viewMode;
    });
  });

  // Listen for upload events
  document.addEventListener('documents-uploaded', () => {
    loadDocuments();
  });

  // Initial load
  await loadDocuments();

  async function loadDocuments() {
    content.innerHTML = '<div class="loading-spinner"></div>';

    try {
      const result = await getDocuments({
        limit: pageSize,
        offset: currentPage * pageSize,
      });

      docCount.textContent = `${result.total} document${result.total !== 1 ? 's' : ''}`;

      if (result.documents.length === 0) {
        content.innerHTML = `
          <div class="document-list-empty">
            <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            <h3>No documents yet</h3>
            <p>Upload your first document to get started.</p>
            <a href="/upload" class="button primary">Upload Documents</a>
          </div>
        `;
        pagination.innerHTML = '';
        return;
      }

      content.innerHTML = result.documents.map((doc) => renderDocument(doc)).join('');

      // Add click handlers
      content.querySelectorAll('.document-card').forEach((card) => {
        card.addEventListener('click', (e) => {
          if (!e.target.closest('.doc-actions')) {
            window.location.href = `/document?id=${card.dataset.docId}`;
          }
        });
      });

      // Add delete handlers
      content.querySelectorAll('.delete-btn').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const card = btn.closest('.document-card');
          const docId = card.dataset.docId;
          const docTitle = card.querySelector('.doc-title').textContent;

          // eslint-disable-next-line no-alert
          if (!window.confirm(`Delete "${docTitle}"? This cannot be undone.`)) {
            return;
          }

          btn.disabled = true;
          card.classList.add('deleting');

          try {
            await deleteDocument(docId);
            card.remove();

            // Update count
            const countEl = block.querySelector('.doc-count');
            const currentCount = parseInt(countEl.textContent, 10);
            countEl.textContent = `${currentCount - 1} document${currentCount - 1 !== 1 ? 's' : ''}`;
          } catch (error) {
            // eslint-disable-next-line no-alert
            alert(`Failed to delete: ${error.message}`);
            btn.disabled = false;
            card.classList.remove('deleting');
          }
        });
      });

      // Render pagination
      renderPagination(result.total);
    } catch (error) {
      content.innerHTML = `
        <div class="document-list-error">
          <p>Failed to load documents: ${escapeHtml(error.message)}</p>
          <button class="button retry-btn">Retry</button>
        </div>
      `;
      content.querySelector('.retry-btn').addEventListener('click', loadDocuments);
    }
  }

  function renderDocument(doc) {
    const statusClass = doc.status;
    const statusLabel = {
      pending: 'Pending',
      processing: 'Processing...',
      ready: 'Ready',
      error: 'Error',
    }[doc.status] || doc.status;

    const typeIcon = getTypeIcon(doc.mime_type);
    const tags = doc.tags || [];

    return `
      <div class="document-card" data-doc-id="${doc.id}" tabindex="0" role="button">
        <div class="doc-icon">${typeIcon}</div>
        <div class="doc-info">
          <span class="doc-title">${escapeHtml(doc.title)}</span>
          <div class="doc-meta">
            <span class="doc-date">${formatDate(doc.created_at)}</span>
            <span class="doc-status ${statusClass}">${statusLabel}</span>
          </div>
          ${tags.length > 0 ? `
            <div class="doc-tags">
              ${tags.slice(0, 3).map((tag) => `<span class="doc-tag">${escapeHtml(tag)}</span>`).join('')}
              ${tags.length > 3 ? `<span class="doc-tag-more">+${tags.length - 3}</span>` : ''}
            </div>
          ` : ''}
        </div>
        <div class="doc-actions">
          <button class="action-btn delete-btn" title="Delete" type="button">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        </div>
      </div>
    `;
  }

  function renderPagination(total) {
    const totalPages = Math.ceil(total / pageSize);

    if (totalPages <= 1) {
      pagination.innerHTML = '';
      return;
    }

    pagination.innerHTML = `
      <button class="page-btn prev" ${currentPage === 0 ? 'disabled' : ''}>Previous</button>
      <span class="page-info">Page ${currentPage + 1} of ${totalPages}</span>
      <button class="page-btn next" ${currentPage >= totalPages - 1 ? 'disabled' : ''}>Next</button>
    `;

    pagination.querySelector('.prev').addEventListener('click', () => {
      if (currentPage > 0) {
        currentPage -= 1;
        loadDocuments();
      }
    });

    pagination.querySelector('.next').addEventListener('click', () => {
      if (currentPage < totalPages - 1) {
        currentPage += 1;
        loadDocuments();
      }
    });
  }

  function getTypeIcon(mimeType) {
    if (mimeType?.includes('pdf')) {
      return '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>';
    }
    if (mimeType?.includes('image')) {
      return '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>';
    }
    if (mimeType?.includes('spreadsheet') || mimeType?.includes('excel')) {
      return '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/><line x1="12" y1="9" x2="12" y2="21"/></svg>';
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
  }

  function formatDate(dateStr) {
    const date = new Date(dateStr);
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
    });
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
