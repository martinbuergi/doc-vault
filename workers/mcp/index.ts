// DocVault MCP Server - SSE Endpoint

import type { Env, McpToolResult } from '../shared/types';
import { hashApiKey, jsonResponse, errorResponse, isoNow } from '../shared/utils';

// MCP Protocol types
interface McpRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

interface McpResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: { code: number; message: string };
}

// Tool definitions
const TOOLS = [
  {
    name: 'docvault_upload',
    description: 'Upload a document to DocVault. Accepts base64-encoded file content.',
    inputSchema: {
      type: 'object',
      properties: {
        filename: { type: 'string', description: 'The name of the file' },
        content: { type: 'string', description: 'Base64-encoded file content' },
        mime_type: { type: 'string', description: 'MIME type of the file' },
      },
      required: ['filename', 'content'],
    },
  },
  {
    name: 'docvault_list_documents',
    description: 'List documents in the user\'s DocVault workspace.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['pending', 'processing', 'ready', 'error'], description: 'Filter by status' },
        limit: { type: 'number', description: 'Maximum number of documents to return (default 20, max 100)' },
        offset: { type: 'number', description: 'Offset for pagination' },
      },
    },
  },
  {
    name: 'docvault_get_document',
    description: 'Get details of a specific document including its extracted text.',
    inputSchema: {
      type: 'object',
      properties: {
        document_id: { type: 'string', description: 'The ID of the document' },
        include_text: { type: 'boolean', description: 'Whether to include extracted text (default false)' },
      },
      required: ['document_id'],
    },
  },
  {
    name: 'docvault_search',
    description: 'Search documents using semantic (natural language) search.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query in natural language' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Filter by tags' },
        limit: { type: 'number', description: 'Maximum number of results (default 10, max 50)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'docvault_ask',
    description: 'Ask a question about your documents. Uses RAG to retrieve relevant context and generate an answer with citations.',
    inputSchema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'The question to ask about your documents' },
      },
      required: ['question'],
    },
  },
  {
    name: 'docvault_add_tags',
    description: 'Add tags to a document.',
    inputSchema: {
      type: 'object',
      properties: {
        document_id: { type: 'string', description: 'The ID of the document' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Tags to add' },
      },
      required: ['document_id', 'tags'],
    },
  },
  {
    name: 'docvault_remove_tags',
    description: 'Remove tags from a document.',
    inputSchema: {
      type: 'object',
      properties: {
        document_id: { type: 'string', description: 'The ID of the document' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Tags to remove' },
      },
      required: ['document_id', 'tags'],
    },
  },
  {
    name: 'docvault_delete_document',
    description: 'Delete a document from DocVault.',
    inputSchema: {
      type: 'object',
      properties: {
        document_id: { type: 'string', description: 'The ID of the document to delete' },
      },
      required: ['document_id'],
    },
  },
];

// Resource definitions
const RESOURCES = [
  {
    uri: 'docvault://documents',
    name: 'All Documents',
    description: 'List of all documents in the workspace',
    mimeType: 'application/json',
  },
  {
    uri: 'docvault://tags',
    name: 'All Tags',
    description: 'List of all tags in the workspace',
    mimeType: 'application/json',
  },
];

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        },
      });
    }
    
    // Authenticate via API key
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return errorResponse('Unauthorized', 401);
    }
    
    const apiKey = authHeader.substring(7);
    const keyHash = await hashApiKey(apiKey);
    
    const keyData = await env.DB.prepare(`
      SELECT ak.user_id, ak.workspace_id, ak.role, u.email
      FROM api_keys ak
      JOIN users u ON ak.user_id = u.id
      WHERE ak.key_hash = ? AND (ak.expires_at IS NULL OR ak.expires_at > ?)
    `).bind(keyHash, isoNow()).first<{
      user_id: string;
      workspace_id: string;
      role: string;
      email: string;
    }>();
    
    if (!keyData) {
      return errorResponse('Invalid API key', 401);
    }
    
    // Update last used
    await env.DB.prepare(
      'UPDATE api_keys SET last_used_at = ? WHERE key_hash = ?'
    ).bind(isoNow(), keyHash).run();
    
    // SSE endpoint
    if (url.pathname === '/mcp/sse' || url.pathname === '/sse') {
      return handleSSE(request, env, keyData);
    }
    
    return errorResponse('Not Found', 404);
  },
};

async function handleSSE(
  request: Request,
  env: Env,
  keyData: { user_id: string; workspace_id: string; role: string; email: string }
): Promise<Response> {
  const encoder = new TextEncoder();
  
  const stream = new ReadableStream({
    async start(controller) {
      // Send server info
      sendEvent(controller, encoder, 'message', {
        jsonrpc: '2.0',
        method: 'notifications/initialized',
        params: {
          serverInfo: {
            name: 'docvault',
            version: '1.0.0',
          },
          capabilities: {
            tools: {},
            resources: {},
          },
        },
      });
    },
    
    async pull(controller) {
      // Keep connection alive
      await new Promise(resolve => setTimeout(resolve, 30000));
      sendEvent(controller, encoder, 'ping', {});
    },
  });
  
  // For a full implementation, we'd need to handle incoming messages
  // This simplified version shows the structure
  
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

function sendEvent(
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  event: string,
  data: unknown
): void {
  controller.enqueue(encoder.encode(`event: ${event}\n`));
  controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
}

// Tool handlers
async function handleToolCall(
  toolName: string,
  args: Record<string, unknown>,
  env: Env,
  keyData: { user_id: string; workspace_id: string; role: string }
): Promise<McpToolResult> {
  try {
    switch (toolName) {
      case 'docvault_upload':
        return await toolUpload(args, env, keyData);
      case 'docvault_list_documents':
        return await toolListDocuments(args, env, keyData);
      case 'docvault_get_document':
        return await toolGetDocument(args, env, keyData);
      case 'docvault_search':
        return await toolSearch(args, env, keyData);
      case 'docvault_ask':
        return await toolAsk(args, env, keyData);
      case 'docvault_add_tags':
        return await toolAddTags(args, env, keyData);
      case 'docvault_remove_tags':
        return await toolRemoveTags(args, env, keyData);
      case 'docvault_delete_document':
        return await toolDeleteDocument(args, env, keyData);
      default:
        return { content: [{ type: 'text', text: `Unknown tool: ${toolName}` }], isError: true };
    }
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` }],
      isError: true,
    };
  }
}

async function toolUpload(
  args: Record<string, unknown>,
  env: Env,
  keyData: { user_id: string; workspace_id: string; role: string }
): Promise<McpToolResult> {
  if (keyData.role === 'viewer') {
    return { content: [{ type: 'text', text: 'Insufficient permissions to upload' }], isError: true };
  }
  
  const filename = args.filename as string;
  const content = args.content as string;
  const mimeType = args.mime_type as string || 'application/octet-stream';
  
  // Decode base64 content
  const binaryContent = Uint8Array.from(atob(content), c => c.charCodeAt(0));
  
  // Upload to R2
  const docId = crypto.randomUUID();
  const fileKey = `documents/${keyData.workspace_id}/${docId}/${filename}`;
  
  await env.FILES.put(fileKey, binaryContent);
  
  // Create document record
  const now = isoNow();
  await env.DB.prepare(`
    INSERT INTO documents (id, workspace_id, user_id, title, file_key, content_hash, mime_type, file_size_bytes, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
  `).bind(docId, keyData.workspace_id, keyData.user_id, filename, fileKey, '', mimeType, binaryContent.length, now, now).run();
  
  // Queue for processing
  await env.PROCESSING_QUEUE.send({
    type: 'document_uploaded',
    document_id: docId,
    workspace_id: keyData.workspace_id,
    user_id: keyData.user_id,
    file_key: fileKey,
    mime_type: mimeType,
  });
  
  return {
    content: [{
      type: 'text',
      text: `Document uploaded successfully.\nID: ${docId}\nFilename: ${filename}\nStatus: pending (processing will begin shortly)`,
    }],
  };
}

async function toolListDocuments(
  args: Record<string, unknown>,
  env: Env,
  keyData: { user_id: string; workspace_id: string; role: string }
): Promise<McpToolResult> {
  const limit = Math.min((args.limit as number) || 20, 100);
  const offset = (args.offset as number) || 0;
  const status = args.status as string;
  
  let query = 'SELECT id, title, status, mime_type, created_at FROM documents WHERE workspace_id = ?';
  const params: (string | number)[] = [keyData.workspace_id];
  
  if (status) {
    query += ' AND status = ?';
    params.push(status);
  }
  
  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);
  
  const result = await env.DB.prepare(query).bind(...params).all();
  
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result.results || [], null, 2),
    }],
  };
}

async function toolGetDocument(
  args: Record<string, unknown>,
  env: Env,
  keyData: { user_id: string; workspace_id: string; role: string }
): Promise<McpToolResult> {
  const docId = args.document_id as string;
  const includeText = args.include_text as boolean;
  
  const doc = await env.DB.prepare(`
    SELECT * FROM documents WHERE id = ? AND workspace_id = ?
  `).bind(docId, keyData.workspace_id).first();
  
  if (!doc) {
    return { content: [{ type: 'text', text: 'Document not found' }], isError: true };
  }
  
  let result: Record<string, unknown> = { ...doc };
  
  // Get tags
  const tags = await env.DB.prepare(`
    SELECT t.name, t.category FROM tags t
    JOIN document_tags dt ON t.id = dt.tag_id
    WHERE dt.document_id = ?
  `).bind(docId).all();
  
  result.tags = tags.results || [];
  
  // Get text if requested
  if (includeText && doc.text_key) {
    const textFile = await env.FILES.get(doc.text_key as string);
    if (textFile) {
      result.text = await textFile.text();
    }
  }
  
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2),
    }],
  };
}

async function toolSearch(
  args: Record<string, unknown>,
  env: Env,
  keyData: { user_id: string; workspace_id: string; role: string }
): Promise<McpToolResult> {
  const query = args.query as string;
  const limit = Math.min((args.limit as number) || 10, 50);
  
  // Generate query embedding
  const embeddingResult = await env.AI.run('@cf/baai/bge-base-en-v1.5', {
    text: [query],
  });
  
  const queryEmbedding = embeddingResult.data[0];
  
  // Search Vectorize
  const vectorResults = await env.VECTORS.query(queryEmbedding, {
    topK: limit * 2,
    filter: {
      workspace_id: keyData.workspace_id,
    },
    returnMetadata: 'all',
  });
  
  // Dedupe and format results
  const seenDocs = new Set<string>();
  const results: Array<{ document_id: string; title: string; snippet: string; score: number }> = [];
  
  for (const match of vectorResults.matches) {
    const docId = match.metadata?.document_id as string;
    if (!docId || seenDocs.has(docId)) continue;
    seenDocs.add(docId);
    
    const doc = await env.DB.prepare(
      'SELECT title FROM documents WHERE id = ?'
    ).bind(docId).first<{ title: string }>();
    
    results.push({
      document_id: docId,
      title: doc?.title || 'Unknown',
      snippet: (match.metadata?.text as string)?.substring(0, 200) || '',
      score: match.score || 0,
    });
    
    if (results.length >= limit) break;
  }
  
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(results, null, 2),
    }],
  };
}

async function toolAsk(
  args: Record<string, unknown>,
  env: Env,
  keyData: { user_id: string; workspace_id: string; role: string }
): Promise<McpToolResult> {
  const question = args.question as string;
  
  // Generate query embedding
  const embeddingResult = await env.AI.run('@cf/baai/bge-base-en-v1.5', {
    text: [question],
  });
  
  const queryEmbedding = embeddingResult.data[0];
  
  // Retrieve context
  const vectorResults = await env.VECTORS.query(queryEmbedding, {
    topK: 10,
    filter: {
      workspace_id: keyData.workspace_id,
    },
    returnMetadata: 'all',
  });
  
  // Build context
  const sources: Array<{ document_id: string; title: string; text: string }> = [];
  const seenDocs = new Set<string>();
  
  for (const match of vectorResults.matches) {
    const docId = match.metadata?.document_id as string;
    if (!docId) continue;
    
    let title = 'Unknown';
    if (!seenDocs.has(docId)) {
      const doc = await env.DB.prepare(
        'SELECT title FROM documents WHERE id = ?'
      ).bind(docId).first<{ title: string }>();
      title = doc?.title || 'Unknown';
      seenDocs.add(docId);
    }
    
    sources.push({
      document_id: docId,
      title,
      text: (match.metadata?.text as string) || '',
    });
  }
  
  const contextText = sources.map((s, i) => 
    `[Source ${i + 1}: ${s.title}]\n${s.text}`
  ).join('\n\n');
  
  // Generate answer
  const response = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
    messages: [
      {
        role: 'system',
        content: 'You are a helpful document assistant. Answer questions based ONLY on the provided context. Cite your sources.',
      },
      {
        role: 'user',
        content: `Context:\n${contextText}\n\nQuestion: ${question}\n\nProvide a helpful answer with citations.`,
      },
    ],
  });
  
  const answer = response.response;
  
  // Format sources for display
  const uniqueSources = [...new Set(sources.map(s => `- ${s.title} (${s.document_id})`))];
  
  return {
    content: [{
      type: 'text',
      text: `${answer}\n\n**Sources:**\n${uniqueSources.join('\n')}`,
    }],
  };
}

async function toolAddTags(
  args: Record<string, unknown>,
  env: Env,
  keyData: { user_id: string; workspace_id: string; role: string }
): Promise<McpToolResult> {
  if (keyData.role === 'viewer') {
    return { content: [{ type: 'text', text: 'Insufficient permissions' }], isError: true };
  }
  
  const docId = args.document_id as string;
  const tagNames = args.tags as string[];
  
  // Verify document exists
  const doc = await env.DB.prepare(
    'SELECT id FROM documents WHERE id = ? AND workspace_id = ?'
  ).bind(docId, keyData.workspace_id).first();
  
  if (!doc) {
    return { content: [{ type: 'text', text: 'Document not found' }], isError: true };
  }
  
  const now = isoNow();
  const addedTags: string[] = [];
  
  for (const tagName of tagNames) {
    // Find or create tag
    let tag = await env.DB.prepare(
      'SELECT id FROM tags WHERE workspace_id = ? AND name = ?'
    ).bind(keyData.workspace_id, tagName).first<{ id: string }>();
    
    if (!tag) {
      const tagId = crypto.randomUUID();
      await env.DB.prepare(`
        INSERT INTO tags (id, workspace_id, name, usage_count, created_at)
        VALUES (?, ?, ?, 0, ?)
      `).bind(tagId, keyData.workspace_id, tagName, now).run();
      tag = { id: tagId };
    }
    
    // Add to document
    const existing = await env.DB.prepare(
      'SELECT 1 FROM document_tags WHERE document_id = ? AND tag_id = ?'
    ).bind(docId, tag.id).first();
    
    if (!existing) {
      await env.DB.prepare(`
        INSERT INTO document_tags (document_id, tag_id, source, created_at)
        VALUES (?, ?, 'user_added', ?)
      `).bind(docId, tag.id, now).run();
      
      await env.DB.prepare(
        'UPDATE tags SET usage_count = usage_count + 1 WHERE id = ?'
      ).bind(tag.id).run();
      
      addedTags.push(tagName);
    }
  }
  
  return {
    content: [{
      type: 'text',
      text: addedTags.length > 0 
        ? `Added tags: ${addedTags.join(', ')}`
        : 'All tags already present on document',
    }],
  };
}

async function toolRemoveTags(
  args: Record<string, unknown>,
  env: Env,
  keyData: { user_id: string; workspace_id: string; role: string }
): Promise<McpToolResult> {
  if (keyData.role === 'viewer') {
    return { content: [{ type: 'text', text: 'Insufficient permissions' }], isError: true };
  }
  
  const docId = args.document_id as string;
  const tagNames = args.tags as string[];
  
  // Verify document exists
  const doc = await env.DB.prepare(
    'SELECT id FROM documents WHERE id = ? AND workspace_id = ?'
  ).bind(docId, keyData.workspace_id).first();
  
  if (!doc) {
    return { content: [{ type: 'text', text: 'Document not found' }], isError: true };
  }
  
  const removedTags: string[] = [];
  
  for (const tagName of tagNames) {
    const tag = await env.DB.prepare(
      'SELECT id FROM tags WHERE workspace_id = ? AND name = ?'
    ).bind(keyData.workspace_id, tagName).first<{ id: string }>();
    
    if (tag) {
      const result = await env.DB.prepare(
        'DELETE FROM document_tags WHERE document_id = ? AND tag_id = ?'
      ).bind(docId, tag.id).run();
      
      if (result.meta.changes > 0) {
        await env.DB.prepare(
          'UPDATE tags SET usage_count = MAX(0, usage_count - 1) WHERE id = ?'
        ).bind(tag.id).run();
        removedTags.push(tagName);
      }
    }
  }
  
  return {
    content: [{
      type: 'text',
      text: removedTags.length > 0 
        ? `Removed tags: ${removedTags.join(', ')}`
        : 'No matching tags found on document',
    }],
  };
}

async function toolDeleteDocument(
  args: Record<string, unknown>,
  env: Env,
  keyData: { user_id: string; workspace_id: string; role: string }
): Promise<McpToolResult> {
  if (keyData.role === 'viewer') {
    return { content: [{ type: 'text', text: 'Insufficient permissions' }], isError: true };
  }
  
  const docId = args.document_id as string;
  
  const doc = await env.DB.prepare(`
    SELECT id, file_key, text_key, user_id FROM documents 
    WHERE id = ? AND workspace_id = ?
  `).bind(docId, keyData.workspace_id).first<{
    id: string;
    file_key: string;
    text_key: string;
    user_id: string;
  }>();
  
  if (!doc) {
    return { content: [{ type: 'text', text: 'Document not found' }], isError: true };
  }
  
  // Editors can only delete their own documents
  if (keyData.role === 'editor' && doc.user_id !== keyData.user_id) {
    return { content: [{ type: 'text', text: 'Can only delete your own documents' }], isError: true };
  }
  
  // Delete from R2
  await env.FILES.delete(doc.file_key);
  if (doc.text_key) {
    await env.FILES.delete(doc.text_key);
  }
  
  // Delete vectors
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
  
  return {
    content: [{
      type: 'text',
      text: `Document ${docId} deleted successfully`,
    }],
  };
}
