/**
 * Upload Block
 * Drag-and-drop file upload with progress indicators
 */

import { getApiBaseUrl, getAuthToken, isAuthenticated } from '../../scripts/api.js';

export default async function decorate(block) {
  // Check if user is authenticated
  if (!isAuthenticated()) {
    block.innerHTML = `
      <div class="upload-auth-required">
        <p>Please <a href="/login">sign in</a> to upload documents.</p>
      </div>
    `;
    return;
  }

  // Create upload UI
  block.innerHTML = `
    <div class="upload-container">
      <div class="upload-dropzone" tabindex="0" role="button" aria-label="Drop files here or click to browse">
        <div class="upload-icon">
          <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/>
            <line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
        </div>
        <p class="upload-text">Drag and drop files here</p>
        <p class="upload-subtext">or click to browse</p>
        <p class="upload-formats">PDF, DOCX, XLSX, JPG, PNG, TXT (max 50MB)</p>
        <input type="file" class="upload-input" multiple accept=".pdf,.docx,.xlsx,.jpg,.jpeg,.png,.txt,.eml" />
      </div>
      <div class="upload-progress-list"></div>
    </div>
  `;

  const dropzone = block.querySelector('.upload-dropzone');
  const fileInput = block.querySelector('.upload-input');
  const progressList = block.querySelector('.upload-progress-list');

  // Handle drag and drop
  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });

  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('dragover');
  });

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    handleFiles(e.dataTransfer.files);
  });

  // Handle click to browse
  dropzone.addEventListener('click', () => {
    fileInput.click();
  });

  // Handle keyboard activation
  dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInput.click();
    }
  });

  fileInput.addEventListener('change', () => {
    handleFiles(fileInput.files);
    fileInput.value = ''; // Reset for re-upload
  });

  async function handleFiles(files) {
    const validFiles = Array.from(files).filter(validateFile);

    if (validFiles.length === 0) {
      return;
    }

    // Create progress items
    validFiles.forEach((file) => {
      const progressItem = createProgressItem(file);
      progressList.appendChild(progressItem);
    });

    // Upload files
    const formData = new FormData();
    validFiles.forEach((file) => {
      formData.append('files', file);
    });

    try {
      const response = await fetch(`${getApiBaseUrl()}/api/v1/documents/upload`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${getAuthToken()}`,
        },
        body: formData,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Upload failed');
      }

      const result = await response.json();

      // Update progress items
      result.documents.forEach((doc, index) => {
        const progressItem = progressList.children[progressList.children.length - validFiles.length + index];
        if (progressItem) {
          updateProgressItem(progressItem, doc);
        }
      });

      // Dispatch custom event for other blocks to listen to
      block.dispatchEvent(new CustomEvent('documents-uploaded', {
        bubbles: true,
        detail: { documents: result.documents },
      }));
    } catch (error) {
      // Mark all as error
      Array.from(progressList.children).slice(-validFiles.length).forEach((item) => {
        item.classList.add('error');
        item.querySelector('.upload-item-status').textContent = error.message;
      });
    }
  }

  function validateFile(file) {
    const maxSize = 50 * 1024 * 1024; // 50MB
    const allowedTypes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'image/jpeg',
      'image/png',
      'text/plain',
      'message/rfc822',
    ];

    if (file.size > maxSize) {
      // eslint-disable-next-line no-alert
      alert(`File "${file.name}" exceeds 50MB limit`);
      return false;
    }

    // Check by extension if MIME type is not reliable
    const ext = file.name.split('.').pop().toLowerCase();
    const allowedExts = ['pdf', 'docx', 'xlsx', 'jpg', 'jpeg', 'png', 'txt', 'eml'];

    if (!allowedTypes.includes(file.type) && !allowedExts.includes(ext)) {
      // eslint-disable-next-line no-alert
      alert(`File type not supported: ${file.name}`);
      return false;
    }

    return true;
  }

  function createProgressItem(file) {
    const item = document.createElement('div');
    item.className = 'upload-item uploading';
    item.innerHTML = `
      <div class="upload-item-icon">${getFileIcon(file.type)}</div>
      <div class="upload-item-info">
        <span class="upload-item-name">${escapeHtml(file.name)}</span>
        <span class="upload-item-size">${formatFileSize(file.size)}</span>
      </div>
      <div class="upload-item-status">Uploading...</div>
      <div class="upload-item-progress">
        <div class="upload-item-progress-bar"></div>
      </div>
    `;
    return item;
  }

  function updateProgressItem(item, doc) {
    item.classList.remove('uploading');

    if (doc.status === 'duplicate') {
      item.classList.add('duplicate');
      item.querySelector('.upload-item-status').textContent = 'Already exists';
    } else {
      item.classList.add('success');
      item.querySelector('.upload-item-status').textContent = 'Processing...';
    }

    item.querySelector('.upload-item-progress').remove();
  }

  function getFileIcon(mimeType) {
    if (mimeType.includes('pdf')) {
      return '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>';
    }
    if (mimeType.includes('image')) {
      return '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>';
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
  }

  function formatFileSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
