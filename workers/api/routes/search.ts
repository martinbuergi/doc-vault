// Search Routes

import type { Env, SearchRequest, SearchResult, DocumentSearchResult } from '../../shared/types';
import { jsonResponse, errorResponse } from '../../shared/utils';
import { authenticateRequest } from './auth';

export async function handleSearch(request: Request, env: Env, path: string): Promise<Response> {
  const user = await authenticateRequest(request, env);
  if (!user) {
    return errorResponse('Unauthorized', 401, env.CORS_ORIGIN);
  }
  
  const method = request.method;
  
  // POST / - Faceted search
  if ((path === '' || path === '/') && method === 'POST') {
    return handleFacetedSearch(request, env, user.id);
  }
  
  // POST /semantic - Semantic vector search
  if (path === '/semantic' && method === 'POST') {
    return handleSemanticSearch(request, env, user.id);
  }
  
  // POST /combined - Combined faceted + semantic search
  if (path === '/combined' && method === 'POST') {
    return handleCombinedSearch(request, env, user.id);
  }
  
  return errorResponse('Not Found', 404, env.CORS_ORIGIN);
}

async function handleFacetedSearch(request: Request, env: Env, userId: string): Promise<Response> {
  try {
    const body = await request.json() as SearchRequest;
    const limit = Math.min(body.limit || 20, 100);
    const offset = body.offset || 0;
    
    // Get user's accessible workspaces
    const workspaces = await env.DB.prepare(`
      SELECT workspace_id FROM workspace_members WHERE user_id = ?
    `).bind(userId).all<{ workspace_id: string }>();
    
    const workspaceIds = workspaces.results?.map(w => w.workspace_id) || [];
    
    if (workspaceIds.length === 0) {
      return jsonResponse({ documents: [], total: 0, has_more: false }, 200, env.CORS_ORIGIN);
    }
    
    // Build query
    let query = `
      SELECT DISTINCT d.id, d.title, d.created_at, d.status, d.mime_type
      FROM documents d
      LEFT JOIN document_tags dt ON d.id = dt.document_id
      LEFT JOIN tags t ON dt.tag_id = t.id
      WHERE d.workspace_id IN (${workspaceIds.map(() => '?').join(',')})
        AND d.status = 'ready'
    `;
    
    const params: (string | number)[] = [...workspaceIds];
    
    // Text search (simple LIKE for now, could use FTS5)
    if (body.query) {
      query += ` AND (d.title LIKE ? OR EXISTS (
        SELECT 1 FROM document_chunks dc WHERE dc.document_id = d.id AND dc.text_content LIKE ?
      ))`;
      const searchTerm = `%${body.query}%`;
      params.push(searchTerm, searchTerm);
    }
    
    // Tag filter
    if (body.tags && body.tags.length > 0) {
      query += ` AND t.name IN (${body.tags.map(() => '?').join(',')})`;
      params.push(...body.tags);
    }
    
    // Document type filter
    if (body.document_types && body.document_types.length > 0) {
      const typeConditions = body.document_types.map(() => 'd.mime_type LIKE ?').join(' OR ');
      query += ` AND (${typeConditions})`;
      params.push(...body.document_types.map(t => `%${t}%`));
    }
    
    // Date range filter
    if (body.date_from) {
      query += ' AND d.created_at >= ?';
      params.push(body.date_from);
    }
    
    if (body.date_to) {
      query += ' AND d.created_at <= ?';
      params.push(body.date_to);
    }
    
    query += ' ORDER BY d.created_at DESC LIMIT ? OFFSET ?';
    params.push(limit + 1, offset);
    
    const result = await env.DB.prepare(query).bind(...params).all<{
      id: string;
      title: string;
      created_at: string;
      status: string;
      mime_type: string;
    }>();
    
    const documents = await enrichDocuments(result.results?.slice(0, limit) || [], env);
    const hasMore = (result.results?.length || 0) > limit;
    
    // Get total count
    let countQuery = `
      SELECT COUNT(DISTINCT d.id) as count
      FROM documents d
      LEFT JOIN document_tags dt ON d.id = dt.document_id
      LEFT JOIN tags t ON dt.tag_id = t.id
      WHERE d.workspace_id IN (${workspaceIds.map(() => '?').join(',')})
        AND d.status = 'ready'
    `;
    
    const countParams: (string | number)[] = [...workspaceIds];
    
    if (body.query) {
      countQuery += ` AND (d.title LIKE ? OR EXISTS (
        SELECT 1 FROM document_chunks dc WHERE dc.document_id = d.id AND dc.text_content LIKE ?
      ))`;
      const searchTerm = `%${body.query}%`;
      countParams.push(searchTerm, searchTerm);
    }
    
    if (body.tags && body.tags.length > 0) {
      countQuery += ` AND t.name IN (${body.tags.map(() => '?').join(',')})`;
      countParams.push(...body.tags);
    }
    
    const countResult = await env.DB.prepare(countQuery).bind(...countParams).first<{ count: number }>();
    
    return jsonResponse({
      documents,
      total: countResult?.count || 0,
      has_more: hasMore,
    }, 200, env.CORS_ORIGIN);
    
  } catch (error) {
    console.error('Faceted search error:', error);
    return errorResponse('Search failed', 500, env.CORS_ORIGIN);
  }
}

async function handleSemanticSearch(request: Request, env: Env, userId: string): Promise<Response> {
  try {
    const body = await request.json() as { query: string; limit?: number };
    
    if (!body.query) {
      return errorResponse('Query is required', 400, env.CORS_ORIGIN);
    }
    
    const limit = Math.min(body.limit || 10, 50);
    
    // Get user's accessible workspaces
    const workspaces = await env.DB.prepare(`
      SELECT workspace_id FROM workspace_members WHERE user_id = ?
    `).bind(userId).all<{ workspace_id: string }>();
    
    const workspaceIds = workspaces.results?.map(w => w.workspace_id) || [];
    
    if (workspaceIds.length === 0) {
      return jsonResponse({ documents: [], total: 0, has_more: false }, 200, env.CORS_ORIGIN);
    }
    
    // Generate query embedding
    const queryEmbedding = await generateEmbedding(body.query, env);
    
    // Search Vectorize
    const vectorResults = await env.VECTORS.query(queryEmbedding, {
      topK: limit * 2, // Get more to dedupe by document
      filter: {
        workspace_id: { $in: workspaceIds },
      },
      returnMetadata: 'all',
    });
    
    // Deduplicate by document_id and get top matches
    const documentScores = new Map<string, { score: number; snippet: string }>();
    
    for (const match of vectorResults.matches) {
      const docId = match.metadata?.document_id as string;
      if (!docId) continue;
      
      if (!documentScores.has(docId) || (match.score && match.score > (documentScores.get(docId)?.score || 0))) {
        documentScores.set(docId, {
          score: match.score || 0,
          snippet: (match.metadata?.text as string) || '',
        });
      }
    }
    
    // Get document details
    const docIds = Array.from(documentScores.keys()).slice(0, limit);
    
    if (docIds.length === 0) {
      return jsonResponse({ documents: [], total: 0, has_more: false }, 200, env.CORS_ORIGIN);
    }
    
    const docs = await env.DB.prepare(`
      SELECT id, title, created_at, status, mime_type
      FROM documents
      WHERE id IN (${docIds.map(() => '?').join(',')})
    `).bind(...docIds).all<{
      id: string;
      title: string;
      created_at: string;
      status: string;
      mime_type: string;
    }>();
    
    const documents: DocumentSearchResult[] = [];
    
    for (const doc of docs.results || []) {
      const scoreData = documentScores.get(doc.id);
      
      // Get tags
      const tags = await env.DB.prepare(`
        SELECT t.id, t.name, t.category
        FROM tags t
        JOIN document_tags dt ON t.id = dt.tag_id
        WHERE dt.document_id = ?
      `).bind(doc.id).all();
      
      documents.push({
        id: doc.id,
        title: doc.title,
        snippet: scoreData?.snippet || '',
        tags: tags.results || [],
        relevance_score: scoreData?.score,
        created_at: doc.created_at,
      });
    }
    
    // Sort by relevance score
    documents.sort((a, b) => (b.relevance_score || 0) - (a.relevance_score || 0));
    
    return jsonResponse({
      documents,
      total: documents.length,
      has_more: false,
    }, 200, env.CORS_ORIGIN);
    
  } catch (error) {
    console.error('Semantic search error:', error);
    return errorResponse('Search failed', 500, env.CORS_ORIGIN);
  }
}

async function handleCombinedSearch(request: Request, env: Env, userId: string): Promise<Response> {
  try {
    const body = await request.json() as SearchRequest;
    const limit = Math.min(body.limit || 20, 100);
    
    // Get user's accessible workspaces
    const workspaces = await env.DB.prepare(`
      SELECT workspace_id FROM workspace_members WHERE user_id = ?
    `).bind(userId).all<{ workspace_id: string }>();
    
    const workspaceIds = workspaces.results?.map(w => w.workspace_id) || [];
    
    if (workspaceIds.length === 0) {
      return jsonResponse({ documents: [], total: 0, has_more: false }, 200, env.CORS_ORIGIN);
    }
    
    // If there's a text query, start with semantic search
    let semanticDocIds: string[] = [];
    const semanticScores = new Map<string, number>();
    
    if (body.query) {
      const queryEmbedding = await generateEmbedding(body.query, env);
      
      const vectorResults = await env.VECTORS.query(queryEmbedding, {
        topK: limit * 3,
        filter: {
          workspace_id: { $in: workspaceIds },
        },
        returnMetadata: 'all',
      });
      
      for (const match of vectorResults.matches) {
        const docId = match.metadata?.document_id as string;
        if (!docId) continue;
        
        if (!semanticScores.has(docId)) {
          semanticScores.set(docId, match.score || 0);
          semanticDocIds.push(docId);
        }
      }
    }
    
    // Apply faceted filters
    let filterQuery = `
      SELECT d.id, d.title, d.created_at, d.status, d.mime_type
      FROM documents d
      LEFT JOIN document_tags dt ON d.id = dt.document_id
      LEFT JOIN tags t ON dt.tag_id = t.id
      WHERE d.workspace_id IN (${workspaceIds.map(() => '?').join(',')})
        AND d.status = 'ready'
    `;
    
    const params: (string | number)[] = [...workspaceIds];
    
    // If we have semantic results, filter to those
    if (semanticDocIds.length > 0) {
      filterQuery += ` AND d.id IN (${semanticDocIds.map(() => '?').join(',')})`;
      params.push(...semanticDocIds);
    }
    
    // Tag filter
    if (body.tags && body.tags.length > 0) {
      filterQuery += ` AND t.name IN (${body.tags.map(() => '?').join(',')})`;
      params.push(...body.tags);
    }
    
    // Document type filter
    if (body.document_types && body.document_types.length > 0) {
      const typeConditions = body.document_types.map(() => 'd.mime_type LIKE ?').join(' OR ');
      filterQuery += ` AND (${typeConditions})`;
      params.push(...body.document_types.map(t => `%${t}%`));
    }
    
    // Date range filter
    if (body.date_from) {
      filterQuery += ' AND d.created_at >= ?';
      params.push(body.date_from);
    }
    
    if (body.date_to) {
      filterQuery += ' AND d.created_at <= ?';
      params.push(body.date_to);
    }
    
    filterQuery += ' GROUP BY d.id';
    
    const result = await env.DB.prepare(filterQuery).bind(...params).all<{
      id: string;
      title: string;
      created_at: string;
      status: string;
      mime_type: string;
    }>();
    
    const documents = await enrichDocuments(result.results || [], env);
    
    // Add relevance scores from semantic search
    for (const doc of documents) {
      doc.relevance_score = semanticScores.get(doc.id);
    }
    
    // Sort by relevance score if available, otherwise by date
    documents.sort((a, b) => {
      if (a.relevance_score !== undefined && b.relevance_score !== undefined) {
        return b.relevance_score - a.relevance_score;
      }
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
    
    return jsonResponse({
      documents: documents.slice(0, limit),
      total: documents.length,
      has_more: documents.length > limit,
    }, 200, env.CORS_ORIGIN);
    
  } catch (error) {
    console.error('Combined search error:', error);
    return errorResponse('Search failed', 500, env.CORS_ORIGIN);
  }
}

// Helper: Generate embedding for text
async function generateEmbedding(text: string, env: Env): Promise<number[]> {
  const result = await env.AI.run('@cf/baai/bge-base-en-v1.5', {
    text: [text],
  });
  
  return result.data[0];
}

// Helper: Enrich documents with tags and snippets
async function enrichDocuments(
  docs: Array<{ id: string; title: string; created_at: string; status: string; mime_type: string }>,
  env: Env
): Promise<DocumentSearchResult[]> {
  const results: DocumentSearchResult[] = [];
  
  for (const doc of docs) {
    // Get tags
    const tags = await env.DB.prepare(`
      SELECT t.id, t.name, t.category
      FROM tags t
      JOIN document_tags dt ON t.id = dt.tag_id
      WHERE dt.document_id = ?
    `).bind(doc.id).all();
    
    // Get first chunk for snippet
    const chunk = await env.DB.prepare(`
      SELECT text_content FROM document_chunks
      WHERE document_id = ?
      ORDER BY chunk_index ASC
      LIMIT 1
    `).bind(doc.id).first<{ text_content: string }>();
    
    results.push({
      id: doc.id,
      title: doc.title,
      snippet: chunk?.text_content?.substring(0, 200) || '',
      tags: tags.results || [],
      created_at: doc.created_at,
    });
  }
  
  return results;
}
