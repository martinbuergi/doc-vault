/**
 * DocVault API Utilities
 * Shared functions for API communication and authentication
 */

// Configuration
const API_BASE_URL = window.DOCVAULT_API_URL || 'http://localhost:8787';
const TOKEN_KEY = 'docvault_token';
const USER_KEY = 'docvault_user';
const WORKSPACE_KEY = 'docvault_workspace';

/**
 * Get the API base URL
 */
export function getApiBaseUrl() {
  return API_BASE_URL;
}

/**
 * Get the stored auth token
 */
export function getAuthToken() {
  return localStorage.getItem(TOKEN_KEY);
}

/**
 * Set the auth token
 */
export function setAuthToken(token) {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

/**
 * Get the current user
 */
export function getCurrentUser() {
  const user = localStorage.getItem(USER_KEY);
  return user ? JSON.parse(user) : null;
}

/**
 * Set the current user
 */
export function setCurrentUser(user) {
  if (user) {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  } else {
    localStorage.removeItem(USER_KEY);
  }
}

/**
 * Get the current workspace
 */
export function getCurrentWorkspace() {
  const workspace = localStorage.getItem(WORKSPACE_KEY);
  return workspace ? JSON.parse(workspace) : null;
}

/**
 * Set the current workspace
 */
export function setCurrentWorkspace(workspace) {
  if (workspace) {
    localStorage.setItem(WORKSPACE_KEY, JSON.stringify(workspace));
  } else {
    localStorage.removeItem(WORKSPACE_KEY);
  }
}

/**
 * Check if user is authenticated
 */
export function isAuthenticated() {
  const token = getAuthToken();
  if (!token) return false;

  // Check if token is expired (basic JWT parsing)
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.exp > Date.now() / 1000;
  } catch {
    return false;
  }
}

/**
 * Clear all auth data (logout)
 */
export function clearAuth() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem(WORKSPACE_KEY);
}

/**
 * Make an authenticated API request
 */
export async function apiRequest(endpoint, options = {}) {
  const url = `${API_BASE_URL}${endpoint}`;
  const token = getAuthToken();

  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (response.status === 401) {
    clearAuth();
    window.location.href = '/login';
    throw new Error('Session expired');
  }

  return response;
}

/**
 * Register a new user
 */
export async function register(email, password, displayName) {
  const response = await fetch(`${API_BASE_URL}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, display_name: displayName }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Registration failed');
  }

  const data = await response.json();
  setAuthToken(data.token);
  setCurrentUser(data.user);
  setCurrentWorkspace(data.workspace);

  return data;
}

/**
 * Login a user
 */
export async function login(email, password) {
  const response = await fetch(`${API_BASE_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Login failed');
  }

  const data = await response.json();
  setAuthToken(data.token);
  setCurrentUser(data.user);
  setCurrentWorkspace(data.workspace);

  return data;
}

/**
 * Logout the current user
 */
export async function logout() {
  try {
    await apiRequest('/api/v1/auth/logout', { method: 'POST' });
  } catch {
    // Ignore errors, still clear local auth
  }
  clearAuth();
  window.location.href = '/';
}

/**
 * Get list of documents
 */
export async function getDocuments(options = {}) {
  const params = new URLSearchParams();
  if (options.status) params.set('status', options.status);
  if (options.limit) params.set('limit', options.limit.toString());
  if (options.offset) params.set('offset', options.offset.toString());

  const response = await apiRequest(`/api/v1/documents?${params}`);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch documents');
  }

  return response.json();
}

/**
 * Get a single document
 */
export async function getDocument(id) {
  const response = await apiRequest(`/api/v1/documents/${id}`);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch document');
  }

  return response.json();
}

/**
 * Delete a document
 */
export async function deleteDocument(id) {
  const response = await apiRequest(`/api/v1/documents/${id}`, { method: 'DELETE' });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to delete document');
  }

  return response.json();
}

/**
 * Search documents
 */
export async function searchDocuments(query, options = {}) {
  const response = await apiRequest('/api/v1/search/combined', {
    method: 'POST',
    body: JSON.stringify({
      query,
      tags: options.tags,
      document_types: options.documentTypes,
      date_from: options.dateFrom,
      date_to: options.dateTo,
      limit: options.limit,
      offset: options.offset,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Search failed');
  }

  return response.json();
}

/**
 * Get list of tags
 */
export async function getTags() {
  const response = await apiRequest('/api/v1/tags');

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch tags');
  }

  return response.json();
}

/**
 * Add tags to a document
 */
export async function addTagsToDocument(documentId, tagIds) {
  const response = await apiRequest(`/api/v1/documents/${documentId}/tags`, {
    method: 'PUT',
    body: JSON.stringify({ tag_ids: tagIds, action: 'add' }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to add tags');
  }

  return response.json();
}

/**
 * Create a chat session
 */
export async function createChatSession() {
  const response = await apiRequest('/api/v1/chat/sessions', {
    method: 'POST',
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to create chat session');
  }

  return response.json();
}

/**
 * Send a chat message (returns EventSource for streaming)
 */
export function sendChatMessage(sessionId, message) {
  const token = getAuthToken();

  return fetch(`${API_BASE_URL}/api/v1/chat/sessions/${sessionId}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({ message }),
  });
}

/**
 * Get chat session history
 */
export async function getChatSession(sessionId) {
  const response = await apiRequest(`/api/v1/chat/sessions/${sessionId}`);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch chat session');
  }

  return response.json();
}

/**
 * Get API keys
 */
export async function getApiKeys() {
  const response = await apiRequest('/api/v1/auth/keys');

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch API keys');
  }

  return response.json();
}

/**
 * Create an API key
 */
export async function createApiKey(name, role, expiresInDays) {
  const workspace = getCurrentWorkspace();

  const response = await apiRequest('/api/v1/auth/keys', {
    method: 'POST',
    body: JSON.stringify({
      name,
      workspace_id: workspace?.id,
      role,
      expires_in_days: expiresInDays,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to create API key');
  }

  return response.json();
}

/**
 * Revoke an API key
 */
export async function revokeApiKey(keyId) {
  const response = await apiRequest(`/api/v1/auth/keys/${keyId}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to revoke API key');
  }

  return response.json();
}
