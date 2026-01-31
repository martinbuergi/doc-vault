// Document Routes

import type { Env, Document, DocumentUploadResponse, ProcessingQueueMessage } from '../../shared/types';
import { generateId, jsonResponse, errorResponse, isoNow, sha256 } from '../../shared/utils';
import { authenticateRequest } from './auth';
import { processDocument } from '../../shared/processing';

export async function handleDocuments(request: Request, env: Env, path: string): Promise<Response> {
  const user = await authenticateRequest(request, env);
  if (!user) {
    return errorResponse('Unauthorized', 401, env.CORS_ORIGIN);
  }
  
  const method = request.method;
  
  // POST /upload
  if (path === '/upload' && method === 'POST') {
    return handleUpload(request, env, user.id);
  }
  
  // GET / - List documents
  if ((path === '' || path === '/') && method === 'GET') {
    return handleList(request, env, user.id);
  }
  
  // GET /:id - Get document
  if (path.match(/^\/[^\/]+$/) && method === 'GET') {
    const docId = path.substring(1);
    return handleGet(request, env, user.id, docId);
  }
  
  // GET /:id/download - Download document
  if (path.match(/^\/[^\/]+\/download$/) && method === 'GET') {
    const docId = path.replace('/download', '').substring(1);
    return handleDownload(request, env, user.id, docId);
  }
  
  // GET /:id/text - Get extracted text
  if (path.match(/^\/[^\/]+\/text$/) && method === 'GET') {
    const docId = path.replace('/text', '').substring(1);
    return handleGetText(request, env, user.id, docId);
  }
  
  // PATCH /:id - Update document
  if (path.match(/^\/[^\/]+$/) && method === 'PATCH') {
    const docId = path.substring(1);
    return handleUpdate(request, env, user.id, docId);
  }
  
  // DELETE /:id - Delete document
  if (path.match(/^\/[^\/]+$/) && method === 'DELETE') {
    const docId = path.substring(1);
    return handleDelete(request, env, user.id, docId);
  }
  
  return errorResponse('Not Found', 404, env.CORS_ORIGIN);
}

async function handleUpload(request: Request, env: Env, userId: string): Promise<Response> {
  try {
    const contentType = request.headers.get('Content-Type') || '';
    
    // Get user's workspace
    const workspace = await env.DB.prepare(`
      SELECT w.id FROM workspaces w
      JOIN workspace_members wm ON w.id = wm.workspace_id
      WHERE wm.user_id = ? AND wm.role IN ('owner', 'editor')
      LIMIT 1
    `).bind(userId).first<{ id: string }>();
    
    if (!workspace) {
      return errorResponse('No writable workspace found', 403, env.CORS_ORIGIN);
    }
    
    const uploadedDocs: DocumentUploadResponse[] = [];
    
    if (contentType.includes('multipart/form-data')) {
      // Handle multipart form upload
      const formData = await request.formData();
      const files = formData.getAll('files') as File[];
      
      if (files.length === 0) {
        return errorResponse('No files provided', 400, env.CORS_ORIGIN);
      }
      
      if (files.length > 100) {
        return errorResponse('Maximum 100 files per upload', 400, env.CORS_ORIGIN);
      }
      
      for (const file of files) {
        if (file.size > 50 * 1024 * 1024) {
          return errorResponse(`File ${file.name} exceeds 50MB limit`, 400, env.CORS_ORIGIN);
        }
        
        const doc = await uploadFile(file, workspace.id, userId, env);
        uploadedDocs.push(doc);
      }
    } else {
      // Handle single file upload with filename in header
      const filename = request.headers.get('X-Filename') || 'untitled';
      const mimeType = contentType || 'application/octet-stream';
      const body = await request.arrayBuffer();
      
      if (body.byteLength > 50 * 1024 * 1024) {
        return errorResponse('File exceeds 50MB limit', 400, env.CORS_ORIGIN);
      }
      
      const file = new File([body], filename, { type: mimeType });
      const doc = await uploadFile(file, workspace.id, userId, env);
      uploadedDocs.push(doc);
    }
    
    return jsonResponse({ documents: uploadedDocs }, 201, env.CORS_ORIGIN);
    
  } catch (error) {
    console.error('Upload error:', error);
    return errorResponse('Upload failed', 500, env.CORS_ORIGIN);
  }
}

async function uploadFile(
  file: File,
  workspaceId: string,
  userId: string,
  env: Env
): Promise<DocumentUploadResponse> {
  const docId = generateId();
  const now = isoNow();
  const content = await file.arrayBuffer();
  const contentHash = await sha256(content);
  
  // Check for duplicate
  const existing = await env.DB.prepare(
    'SELECT id, title FROM documents WHERE workspace_id = ? AND content_hash = ?'
  ).bind(workspaceId, contentHash).first<{ id: string; title: string }>();
  
  if (existing) {
    // Return existing document with a flag
    return {
      id: existing.id,
      title: existing.title,
      status: 'duplicate',
      created_at: now,
    };
  }
  
  // Determine mime type
  const mimeType = file.type || getMimeType(file.name);
  
  // Validate mime type
  const allowedTypes = [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'image/jpeg',
    'image/png',
    'text/plain',
    'message/rfc822',
  ];
  
  if (!allowedTypes.includes(mimeType)) {
    throw new Error(`Unsupported file type: ${mimeType}`);
  }
  
  // Upload to R2
  const fileKey = `documents/${workspaceId}/${docId}/${file.name}`;
  await env.FILES.put(fileKey, content, {
    customMetadata: {
      document_id: docId,
      workspace_id: workspaceId,
      original_name: file.name,
    },
  });
  
  // Create document record
  await env.DB.prepare(`
    INSERT INTO documents (id, workspace_id, user_id, title, file_key, content_hash, mime_type, file_size_bytes, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
  `).bind(docId, workspaceId, userId, file.name, fileKey, contentHash, mimeType, file.size, now, now).run();
  
  // Process document - use queue if available (paid plan), otherwise process synchronously
  const message: ProcessingQueueMessage = {
    type: 'document_uploaded',
    document_id: docId,
    workspace_id: workspaceId,
    user_id: userId,
    file_key: fileKey,
    mime_type: mimeType,
  };
  
  if (env.PROCESSING_QUEUE) {
    // Paid plan: queue for async processing
    await env.PROCESSING_QUEUE.send(message);
    return {
      id: docId,
      title: file.name,
      status: 'pending',
      created_at: now,
    };
  } else {
    // Free tier: process synchronously (may be slower for large files)
    // Process in background without blocking response
    try {
      await processDocument(message, env);
      return {
        id: docId,
        title: file.name,
        status: 'ready',
        created_at: now,
      };
    } catch (error) {
      console.error('Sync processing failed:', error);
      return {
        id: docId,
        title: file.name,
        status: 'error',
        created_at: now,
      };
    }
  }
}

function getMimeType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  const mimeTypes: Record<string, string> = {
    pdf: 'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    txt: 'text/plain',
    eml: 'message/rfc822',
  };
  return mimeTypes[ext || ''] || 'application/octet-stream';
}

async function handleList(request: Request, env: Env, userId: string): Promise<Response> {
  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 100);
  const offset = parseInt(url.searchParams.get('offset') || '0');
  const status = url.searchParams.get('status');
  const workspaceId = url.searchParams.get('workspace_id');
  
  // Get user's accessible workspaces
  const workspaces = await env.DB.prepare(`
    SELECT workspace_id FROM workspace_members WHERE user_id = ?
  `).bind(userId).all<{ workspace_id: string }>();
  
  const workspaceIds = workspaces.results?.map(w => w.workspace_id) || [];
  
  if (workspaceIds.length === 0) {
    return jsonResponse({ documents: [], total: 0, has_more: false }, 200, env.CORS_ORIGIN);
  }
  
  // Build query
  let query = `SELECT d.*, GROUP_CONCAT(t.name) as tag_names
    FROM documents d
    LEFT JOIN document_tags dt ON d.id = dt.document_id
    LEFT JOIN tags t ON dt.tag_id = t.id
    WHERE d.workspace_id IN (${workspaceIds.map(() => '?').join(',')})`;
  
  const params: (string | number)[] = [...workspaceIds];
  
  if (status) {
    query += ' AND d.status = ?';
    params.push(status);
  }
  
  if (workspaceId && workspaceIds.includes(workspaceId)) {
    query += ' AND d.workspace_id = ?';
    params.push(workspaceId);
  }
  
  query += ' GROUP BY d.id ORDER BY d.created_at DESC LIMIT ? OFFSET ?';
  params.push(limit + 1, offset);
  
  const result = await env.DB.prepare(query).bind(...params).all<Document & { tag_names: string }>();
  
  const documents = (result.results || []).slice(0, limit).map(doc => ({
    ...doc,
    tags: doc.tag_names ? doc.tag_names.split(',') : [],
  }));
  
  const hasMore = (result.results?.length || 0) > limit;
  
  // Get total count
  let countQuery = `SELECT COUNT(*) as count FROM documents WHERE workspace_id IN (${workspaceIds.map(() => '?').join(',')})`;
  const countParams: string[] = [...workspaceIds];
  
  if (status) {
    countQuery += ' AND status = ?';
    countParams.push(status);
  }
  
  const countResult = await env.DB.prepare(countQuery).bind(...countParams).first<{ count: number }>();
  
  return jsonResponse({
    documents,
    total: countResult?.count || 0,
    has_more: hasMore,
  }, 200, env.CORS_ORIGIN);
}

async function handleGet(request: Request, env: Env, userId: string, docId: string): Promise<Response> {
  // Verify access
  const doc = await env.DB.prepare(`
    SELECT d.* FROM documents d
    JOIN workspace_members wm ON d.workspace_id = wm.workspace_id
    WHERE d.id = ? AND wm.user_id = ?
  `).bind(docId, userId).first<Document>();
  
  if (!doc) {
    return errorResponse('Document not found', 404, env.CORS_ORIGIN);
  }
  
  // Get tags
  const tags = await env.DB.prepare(`
    SELECT t.id, t.name, t.category, dt.source, dt.confidence
    FROM tags t
    JOIN document_tags dt ON t.id = dt.tag_id
    WHERE dt.document_id = ?
  `).bind(docId).all();
  
  return jsonResponse({
    ...doc,
    tags: tags.results || [],
  }, 200, env.CORS_ORIGIN);
}

async function handleDownload(request: Request, env: Env, userId: string, docId: string): Promise<Response> {
  // Verify access
  const doc = await env.DB.prepare(`
    SELECT d.file_key, d.title, d.mime_type FROM documents d
    JOIN workspace_members wm ON d.workspace_id = wm.workspace_id
    WHERE d.id = ? AND wm.user_id = ?
  `).bind(docId, userId).first<{ file_key: string; title: string; mime_type: string }>();
  
  if (!doc) {
    return errorResponse('Document not found', 404, env.CORS_ORIGIN);
  }
  
  // Get file from R2
  const file = await env.FILES.get(doc.file_key);
  if (!file) {
    return errorResponse('File not found in storage', 404, env.CORS_ORIGIN);
  }
  
  return new Response(file.body, {
    headers: {
      'Content-Type': doc.mime_type,
      'Content-Disposition': `attachment; filename="${doc.title}"`,
      'Access-Control-Allow-Origin': env.CORS_ORIGIN,
    },
  });
}

async function handleGetText(request: Request, env: Env, userId: string, docId: string): Promise<Response> {
  // Verify access
  const doc = await env.DB.prepare(`
    SELECT d.text_key, d.status FROM documents d
    JOIN workspace_members wm ON d.workspace_id = wm.workspace_id
    WHERE d.id = ? AND wm.user_id = ?
  `).bind(docId, userId).first<{ text_key: string; status: string }>();
  
  if (!doc) {
    return errorResponse('Document not found', 404, env.CORS_ORIGIN);
  }
  
  if (doc.status !== 'ready' || !doc.text_key) {
    return errorResponse('Text not yet extracted', 400, env.CORS_ORIGIN);
  }
  
  // Get text from R2
  const text = await env.FILES.get(doc.text_key);
  if (!text) {
    return errorResponse('Text file not found', 404, env.CORS_ORIGIN);
  }
  
  const content = await text.text();
  
  return jsonResponse({ text: content }, 200, env.CORS_ORIGIN);
}

async function handleUpdate(request: Request, env: Env, userId: string, docId: string): Promise<Response> {
  // Verify access (editor or owner)
  const access = await env.DB.prepare(`
    SELECT wm.role FROM documents d
    JOIN workspace_members wm ON d.workspace_id = wm.workspace_id
    WHERE d.id = ? AND wm.user_id = ? AND wm.role IN ('owner', 'editor')
  `).bind(docId, userId).first<{ role: string }>();
  
  if (!access) {
    return errorResponse('Document not found or insufficient permissions', 404, env.CORS_ORIGIN);
  }
  
  try {
    const body = await request.json() as { title?: string };
    
    if (body.title) {
      await env.DB.prepare(
        'UPDATE documents SET title = ?, updated_at = ? WHERE id = ?'
      ).bind(body.title, isoNow(), docId).run();
    }
    
    return jsonResponse({ message: 'Document updated' }, 200, env.CORS_ORIGIN);
    
  } catch (error) {
    console.error('Update error:', error);
    return errorResponse('Update failed', 500, env.CORS_ORIGIN);
  }
}

async function handleDelete(request: Request, env: Env, userId: string, docId: string): Promise<Response> {
  // Verify access (editor can delete own, owner can delete any)
  const doc = await env.DB.prepare(`
    SELECT d.id, d.file_key, d.text_key, d.workspace_id, d.user_id, wm.role
    FROM documents d
    JOIN workspace_members wm ON d.workspace_id = wm.workspace_id
    WHERE d.id = ? AND wm.user_id = ?
  `).bind(docId, userId).first<Document & { role: string }>();
  
  if (!doc) {
    return errorResponse('Document not found', 404, env.CORS_ORIGIN);
  }
  
  // Check permissions
  if (doc.role !== 'owner' && doc.user_id !== userId) {
    return errorResponse('Insufficient permissions', 403, env.CORS_ORIGIN);
  }
  
  // Delete from R2
  await env.FILES.delete(doc.file_key);
  if (doc.text_key) {
    await env.FILES.delete(doc.text_key);
  }
  
  // Delete vectors from Vectorize
  const chunks = await env.DB.prepare(
    'SELECT id FROM document_chunks WHERE document_id = ?'
  ).bind(docId).all<{ id: string }>();
  
  if (chunks.results && chunks.results.length > 0) {
    await env.VECTORS.deleteByIds(chunks.results.map(c => c.id));
  }
  
  // Delete from D1
  await env.DB.prepare('DELETE FROM document_chunks WHERE document_id = ?').bind(docId).run();
  await env.DB.prepare('DELETE FROM document_tags WHERE document_id = ?').bind(docId).run();
  await env.DB.prepare('DELETE FROM documents WHERE id = ?').bind(docId).run();
  
  return jsonResponse({ message: 'Document deleted' }, 200, env.CORS_ORIGIN);
}
