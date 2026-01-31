// DocVault Type Definitions

export interface Env {
  // D1 Database
  DB: D1Database;
  // R2 Bucket for file storage
  FILES: R2Bucket;
  // Vectorize index for embeddings
  VECTORS: VectorizeIndex;
  // AI binding for AI Gateway
  AI: Ai;
  // Queue for async processing
  PROCESSING_QUEUE: Queue;
  // Environment variables
  ENVIRONMENT: string;
  API_VERSION: string;
  CORS_ORIGIN: string;
  // Secrets (set via wrangler secret)
  JWT_SECRET: string;
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
}

// User types
export interface User {
  id: string;
  email: string;
  password_hash?: string;
  oauth_provider?: string;
  oauth_id?: string;
  display_name?: string;
  created_at: string;
  updated_at: string;
}

export interface ApiKey {
  id: string;
  user_id: string;
  workspace_id: string;
  key_hash: string;
  key_prefix: string;
  name: string;
  role: 'owner' | 'editor' | 'viewer';
  last_used_at?: string;
  expires_at?: string;
  created_at: string;
}

// Workspace types
export interface Workspace {
  id: string;
  name: string;
  owner_id: string;
  created_at: string;
  updated_at: string;
}

export interface WorkspaceMember {
  workspace_id: string;
  user_id: string;
  role: 'owner' | 'editor' | 'viewer';
  invited_by?: string;
  joined_at: string;
}

// Document types
export interface Document {
  id: string;
  workspace_id: string;
  user_id: string;
  title: string;
  file_key: string;
  text_key?: string;
  content_hash: string;
  mime_type: string;
  file_size_bytes: number;
  page_count?: number;
  status: 'pending' | 'processing' | 'ready' | 'error';
  error_message?: string;
  created_at: string;
  updated_at: string;
}

export interface DocumentChunk {
  id: string;
  document_id: string;
  chunk_index: number;
  text_content: string;
  token_count: number;
  page_number?: number;
}

// Tag types
export interface Tag {
  id: string;
  workspace_id: string;
  name: string;
  category?: string;
  usage_count: number;
  created_at: string;
}

export interface DocumentTag {
  document_id: string;
  tag_id: string;
  source: 'ai_suggested' | 'user_added' | 'user_modified';
  confidence?: number;
  created_at: string;
}

// Chat types
export interface ChatSession {
  id: string;
  workspace_id: string;
  user_id: string;
  title?: string;
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
  id: string;
  session_id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: ChatSource[];
  feedback?: 'up' | 'down';
  created_at: string;
}

export interface ChatSource {
  document_id: string;
  document_title: string;
  chunk_id: string;
  text_snippet: string;
  relevance_score: number;
}

// Audit log
export interface AuditLogEntry {
  id: string;
  user_id: string;
  event_type: string;
  detail?: string;
  ip_address?: string;
  user_agent?: string;
  auth_method: 'jwt' | 'api_key';
  created_at: string;
}

// API request/response types
export interface AuthRequest {
  email: string;
  password: string;
}

export interface AuthResponse {
  token: string;
  user: Omit<User, 'password_hash'>;
}

export interface ApiKeyCreateRequest {
  name: string;
  workspace_id: string;
  role: 'editor' | 'viewer';
  expires_in_days?: number;
}

export interface ApiKeyCreateResponse {
  id: string;
  key: string; // Full key, shown only once
  name: string;
  prefix: string;
  role: string;
  expires_at?: string;
  created_at: string;
}

export interface DocumentUploadResponse {
  id: string;
  title: string;
  status: string;
  created_at: string;
}

export interface SearchRequest {
  query?: string;
  tags?: string[];
  document_types?: string[];
  date_from?: string;
  date_to?: string;
  amount_min?: number;
  amount_max?: number;
  limit?: number;
  offset?: number;
}

export interface SearchResult {
  documents: DocumentSearchResult[];
  total: number;
  has_more: boolean;
}

export interface DocumentSearchResult {
  id: string;
  title: string;
  snippet: string;
  tags: Tag[];
  relevance_score?: number;
  created_at: string;
}

export interface ChatRequest {
  message: string;
}

export interface ChatResponse {
  message: ChatMessage;
  sources: ChatSource[];
}

// Queue message types
export interface ProcessingQueueMessage {
  type: 'document_uploaded';
  document_id: string;
  workspace_id: string;
  user_id: string;
  file_key: string;
  mime_type: string;
}

// MCP types
export interface McpToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface McpToolResult {
  content: Array<{
    type: 'text' | 'image' | 'resource';
    text?: string;
    data?: string;
    mimeType?: string;
  }>;
  isError?: boolean;
}
