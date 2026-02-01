/**
 * Search Block
 * Faceted search with semantic search capability
 */

import {
  isAuthenticated, searchDocuments, getTags,
} from '../../scripts/api.js';

export default async function decorate(block) {
  if (!isAuthenticated()) {
    block.innerHTML = `
      <div class="search-auth-required">
        <p>Please <a href="/login">sign in</a> to search documents.</p>
      </div>
    `;
    return;
  }

  // State
  let searchQuery = '';
  let selectedTags = [];
  let dateFrom = '';
  let dateTo = '';
  let allTags = [];

  block.innerHTML = `
    <div class="search-container">
      <div class="search-header">
        <div class="search-input-wrapper">
          <svg class="search-icon" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input type="search" class="search-input" placeholder="Search your documents..." />
          <button class="search-btn" type="button">Search</button>
        </div>
      </div>
      
      <div class="search-body">
        <aside class="search-filters">
          <div class="filter-section">
            <h4>Tags</h4>
            <div class="filter-tags loading">
              <div class="loading-spinner-small"></div>
            </div>
          </div>
          
          <div class="filter-section">
            <h4>Date Range</h4>
            <div class="date-filters">
              <label>
                <span>From</span>
                <input type="date" class="date-from" />
              </label>
              <label>
                <span>To</span>
                <input type="date" class="date-to" />
              </label>
            </div>
          </div>
          
          <button class="clear-filters-btn" type="button" hidden>Clear All Filters</button>
        </aside>
        
        <main class="search-results">
          <div class="search-results-header">
            <span class="results-count"></span>
          </div>
          <div class="search-results-list">
            <div class="search-placeholder">
              <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <p>Enter a search query to find documents</p>
            </div>
          </div>
        </main>
      </div>
    </div>
  `;

  const searchInput = block.querySelector('.search-input');
  const searchBtn = block.querySelector('.search-btn');
  const filterTagsContainer = block.querySelector('.filter-tags');
  const resultsContainer = block.querySelector('.search-results-list');
  const resultsCount = block.querySelector('.results-count');
  const clearFiltersBtn = block.querySelector('.clear-filters-btn');
  const dateFromInput = block.querySelector('.date-from');
  const dateToInput = block.querySelector('.date-to');

  // Load tags for filters
  await loadTags();

  // Event handlers
  searchBtn.addEventListener('click', performSearch);

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      performSearch();
    }
  });

  dateFromInput.addEventListener('change', () => {
    dateFrom = dateFromInput.value;
    updateClearButton();
  });

  dateToInput.addEventListener('change', () => {
    dateTo = dateToInput.value;
    updateClearButton();
  });

  clearFiltersBtn.addEventListener('click', () => {
    selectedTags = [];
    dateFrom = '';
    dateTo = '';
    dateFromInput.value = '';
    dateToInput.value = '';

    block.querySelectorAll('.filter-tag.active').forEach((t) => t.classList.remove('active'));
    updateClearButton();

    if (searchQuery) {
      performSearch();
    }
  });

  async function loadTags() {
    try {
      const result = await getTags();
      allTags = result.tags || [];

      if (allTags.length === 0) {
        filterTagsContainer.innerHTML = '<p class="no-tags">No tags yet</p>';
        return;
      }

      filterTagsContainer.innerHTML = allTags.slice(0, 20).map((tag) => `
        <button class="filter-tag" data-tag="${escapeHtml(tag.name)}" type="button">
          ${escapeHtml(tag.name)}
          <span class="tag-count">${tag.usage_count}</span>
        </button>
      `).join('');

      if (allTags.length > 20) {
        filterTagsContainer.innerHTML += `<button class="filter-tag show-more" type="button">+${allTags.length - 20} more</button>`;
      }

      // Add click handlers
      filterTagsContainer.querySelectorAll('.filter-tag:not(.show-more)').forEach((tagBtn) => {
        tagBtn.addEventListener('click', () => {
          const tagName = tagBtn.dataset.tag;
          tagBtn.classList.toggle('active');

          if (tagBtn.classList.contains('active')) {
            selectedTags.push(tagName);
          } else {
            selectedTags = selectedTags.filter((t) => t !== tagName);
          }

          updateClearButton();

          if (searchQuery || selectedTags.length > 0) {
            performSearch();
          }
        });
      });
    } catch (error) {
      filterTagsContainer.innerHTML = '<p class="error">Failed to load tags</p>';
    } finally {
      filterTagsContainer.classList.remove('loading');
    }
  }

  async function performSearch() {
    searchQuery = searchInput.value.trim();

    if (!searchQuery && selectedTags.length === 0 && !dateFrom && !dateTo) {
      resultsContainer.innerHTML = `
        <div class="search-placeholder">
          <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <p>Enter a search query or select filters</p>
        </div>
      `;
      resultsCount.textContent = '';
      return;
    }

    resultsContainer.innerHTML = '<div class="loading-spinner"></div>';

    try {
      const result = await searchDocuments(searchQuery, {
        tags: selectedTags.length > 0 ? selectedTags : undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        limit: 50,
      });

      resultsCount.textContent = `${result.total} result${result.total !== 1 ? 's' : ''}`;

      if (result.documents.length === 0) {
        resultsContainer.innerHTML = `
          <div class="no-results">
            <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
            <h4>No results found</h4>
            <p>Try different keywords or adjust your filters</p>
          </div>
        `;
        return;
      }

      resultsContainer.innerHTML = result.documents.map((doc) => `
        <a class="search-result" href="/document?id=${doc.id}">
          <div class="result-icon">${getTypeIcon(doc.mime_type)}</div>
          <div class="result-content">
            <span class="result-title">${escapeHtml(doc.title)}</span>
            ${doc.snippet ? `<p class="result-snippet">${escapeHtml(doc.snippet)}</p>` : ''}
            <div class="result-meta">
              <span class="result-date">${formatDate(doc.created_at)}</span>
              ${doc.relevance_score ? `<span class="result-score">${Math.round(doc.relevance_score * 100)}% match</span>` : ''}
            </div>
            ${doc.tags && doc.tags.length > 0 ? `
              <div class="result-tags">
                ${doc.tags.slice(0, 5).map((t) => `<span class="result-tag">${escapeHtml(t.name || t)}</span>`).join('')}
              </div>
            ` : ''}
          </div>
        </a>
      `).join('');
    } catch (error) {
      resultsContainer.innerHTML = `
        <div class="search-error">
          <p>Search failed: ${escapeHtml(error.message)}</p>
          <button class="button retry-btn">Retry</button>
        </div>
      `;
      resultsContainer.querySelector('.retry-btn').addEventListener('click', performSearch);
    }
  }

  function updateClearButton() {
    clearFiltersBtn.hidden = selectedTags.length === 0 && !dateFrom && !dateTo;
  }

  function getTypeIcon(mimeType) {
    if (mimeType?.includes('pdf')) {
      return '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>';
    }
    if (mimeType?.includes('image')) {
      return '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>';
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
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
