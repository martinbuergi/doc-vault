/**
 * Tag Review Block
 * Review and accept/edit AI-suggested tags for documents
 */

import {
  isAuthenticated, getDocuments, getDocument, getTags, apiRequest,
} from '../../scripts/api.js';

export default async function decorate(block) {
  if (!isAuthenticated()) {
    block.innerHTML = `
      <div class="tag-review-auth-required">
        <p>Please <a href="/login">sign in</a> to review tags.</p>
      </div>
    `;
    return;
  }

  block.innerHTML = `
    <div class="tag-review-container">
      <div class="tag-review-header">
        <h3>Review Document Tags</h3>
        <p>Accept, modify, or add tags to your recently uploaded documents.</p>
      </div>
      
      <div class="tag-review-list loading">
        <div class="loading-spinner"></div>
      </div>
      
      <div class="tag-review-actions" hidden>
        <button class="button accept-all-btn">Accept All Suggestions</button>
      </div>
    </div>
  `;

  const list = block.querySelector('.tag-review-list');
  const actionsEl = block.querySelector('.tag-review-actions');
  let existingTags = [];

  // Load existing tags for autocomplete
  try {
    const tagsResult = await getTags();
    existingTags = tagsResult.tags || [];
  } catch {
    // Continue without autocomplete
  }

  await loadDocumentsForReview();

  async function loadDocumentsForReview() {
    list.innerHTML = '<div class="loading-spinner"></div>';
    list.classList.add('loading');

    try {
      // Get documents with pending tag review (recently uploaded, status ready)
      const result = await getDocuments({ status: 'ready', limit: 20 });

      // Filter to documents that have AI-suggested tags not yet accepted
      const docsWithPendingTags = [];

      for (const doc of result.documents) {
        // eslint-disable-next-line no-await-in-loop
        const fullDoc = await getDocument(doc.id);
        const pendingTags = (fullDoc.tags || []).filter((t) => t.source === 'ai_suggested');

        if (pendingTags.length > 0) {
          docsWithPendingTags.push({ ...fullDoc, pendingTags });
        }
      }

      if (docsWithPendingTags.length === 0) {
        list.innerHTML = `
          <div class="tag-review-empty">
            <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
            <h4>All caught up!</h4>
            <p>No documents need tag review.</p>
          </div>
        `;
        actionsEl.hidden = true;
        return;
      }

      list.innerHTML = docsWithPendingTags.map((doc) => renderDocumentForReview(doc)).join('');
      actionsEl.hidden = false;

      // Add event handlers
      setupEventHandlers();
    } catch (error) {
      list.innerHTML = `
        <div class="tag-review-error">
          <p>Failed to load documents: ${escapeHtml(error.message)}</p>
          <button class="button retry-btn">Retry</button>
        </div>
      `;
      list.querySelector('.retry-btn').addEventListener('click', loadDocumentsForReview);
    } finally {
      list.classList.remove('loading');
    }
  }

  function renderDocumentForReview(doc) {
    return `
      <div class="tag-review-item" data-doc-id="${doc.id}">
        <div class="tag-review-doc-header">
          <span class="tag-review-doc-title">${escapeHtml(doc.title)}</span>
          <span class="tag-review-doc-date">${formatDate(doc.created_at)}</span>
        </div>
        
        <div class="tag-review-tags">
          ${doc.pendingTags.map((tag) => `
            <div class="tag-chip suggested" data-tag-id="${tag.id}" data-tag-name="${escapeHtml(tag.name)}">
              <span class="tag-name">${escapeHtml(tag.name)}</span>
              ${tag.confidence ? `<span class="tag-confidence">${Math.round(tag.confidence * 100)}%</span>` : ''}
              <button class="tag-remove" title="Remove tag" type="button">&times;</button>
            </div>
          `).join('')}
          <button class="add-tag-btn" type="button">+ Add tag</button>
        </div>
        
        <div class="tag-input-container" hidden>
          <input type="text" class="tag-input" placeholder="Type tag name..." list="tag-suggestions-${doc.id}" />
          <datalist id="tag-suggestions-${doc.id}">
            ${existingTags.map((t) => `<option value="${escapeHtml(t.name)}">`).join('')}
          </datalist>
          <button class="tag-input-cancel" type="button">Cancel</button>
        </div>
        
        <div class="tag-review-doc-actions">
          <button class="button accept-btn">Accept Tags</button>
        </div>
      </div>
    `;
  }

  function setupEventHandlers() {
    // Remove tag
    list.querySelectorAll('.tag-remove').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const chip = btn.closest('.tag-chip');
        chip.remove();
      });
    });

    // Add tag button
    list.querySelectorAll('.add-tag-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const item = btn.closest('.tag-review-item');
        const inputContainer = item.querySelector('.tag-input-container');
        const input = item.querySelector('.tag-input');

        btn.hidden = true;
        inputContainer.hidden = false;
        input.focus();
      });
    });

    // Cancel add tag
    list.querySelectorAll('.tag-input-cancel').forEach((btn) => {
      btn.addEventListener('click', () => {
        const item = btn.closest('.tag-review-item');
        const inputContainer = item.querySelector('.tag-input-container');
        const addBtn = item.querySelector('.add-tag-btn');
        const input = item.querySelector('.tag-input');

        input.value = '';
        inputContainer.hidden = true;
        addBtn.hidden = false;
      });
    });

    // Add tag on Enter
    list.querySelectorAll('.tag-input').forEach((input) => {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && input.value.trim()) {
          addTagToItem(input.closest('.tag-review-item'), input.value.trim());
          input.value = '';
        } else if (e.key === 'Escape') {
          input.closest('.tag-input-cancel').click();
        }
      });
    });

    // Accept tags for individual document
    list.querySelectorAll('.accept-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const item = btn.closest('.tag-review-item');
        await acceptTagsForDocument(item);
      });
    });

    // Accept all
    actionsEl.querySelector('.accept-all-btn').addEventListener('click', async () => {
      const items = list.querySelectorAll('.tag-review-item');
      for (const item of items) {
        // eslint-disable-next-line no-await-in-loop
        await acceptTagsForDocument(item);
      }
    });
  }

  function addTagToItem(item, tagName) {
    const tagsContainer = item.querySelector('.tag-review-tags');
    const addBtn = item.querySelector('.add-tag-btn');
    const inputContainer = item.querySelector('.tag-input-container');

    // Check if tag already exists
    const existingChips = tagsContainer.querySelectorAll('.tag-chip');
    for (const chip of existingChips) {
      if (chip.dataset.tagName.toLowerCase() === tagName.toLowerCase()) {
        return; // Already exists
      }
    }

    // Create new tag chip
    const chip = document.createElement('div');
    chip.className = 'tag-chip user-added';
    chip.dataset.tagName = tagName;
    chip.innerHTML = `
      <span class="tag-name">${escapeHtml(tagName)}</span>
      <button class="tag-remove" title="Remove tag" type="button">&times;</button>
    `;

    chip.querySelector('.tag-remove').addEventListener('click', () => chip.remove());

    tagsContainer.insertBefore(chip, addBtn);

    // Reset input state
    inputContainer.hidden = true;
    addBtn.hidden = false;
  }

  async function acceptTagsForDocument(item) {
    const { docId } = item.dataset;
    const tagChips = item.querySelectorAll('.tag-chip');
    const tagNames = Array.from(tagChips).map((chip) => chip.dataset.tagName);

    const acceptBtn = item.querySelector('.accept-btn');
    acceptBtn.disabled = true;
    acceptBtn.textContent = 'Saving...';

    try {
      // Update tags on server - accept suggested + add new ones
      await apiRequest(`/api/v1/documents/${docId}/tags`, {
        method: 'PUT',
        body: JSON.stringify({
          tags: tagNames,
          accept_suggestions: true,
        }),
      });

      // Remove item from list
      item.classList.add('accepted');
      setTimeout(() => {
        item.remove();

        // Check if list is empty
        if (list.querySelectorAll('.tag-review-item').length === 0) {
          list.innerHTML = `
            <div class="tag-review-empty">
              <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
              <h4>All caught up!</h4>
              <p>No documents need tag review.</p>
            </div>
          `;
          actionsEl.hidden = true;
        }
      }, 300);
    } catch (error) {
      acceptBtn.disabled = false;
      acceptBtn.textContent = 'Accept Tags';
      // eslint-disable-next-line no-alert
      alert(`Failed to save tags: ${error.message}`);
    }
  }

  function formatDate(dateStr) {
    const date = new Date(dateStr);
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    });
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
