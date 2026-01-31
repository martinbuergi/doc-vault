// Tag Routes

import type { Env, Tag } from '../../shared/types';
import { generateId, jsonResponse, errorResponse, isoNow } from '../../shared/utils';
import { authenticateRequest } from './auth';

export async function handleTags(request: Request, env: Env, path: string): Promise<Response> {
  const user = await authenticateRequest(request, env);
  if (!user) {
    return errorResponse('Unauthorized', 401, env.CORS_ORIGIN);
  }
  
  const method = request.method;
  
  // GET / - List tags
  if ((path === '' || path === '/') && method === 'GET') {
    return handleList(request, env, user.id);
  }
  
  // POST / - Create tag
  if ((path === '' || path === '/') && method === 'POST') {
    return handleCreate(request, env, user.id);
  }
  
  // PATCH /:id - Update tag
  if (path.match(/^\/[^\/]+$/) && method === 'PATCH') {
    const tagId = path.substring(1);
    return handleUpdate(request, env, user.id, tagId);
  }
  
  // DELETE /:id - Delete tag
  if (path.match(/^\/[^\/]+$/) && method === 'DELETE') {
    const tagId = path.substring(1);
    return handleDelete(request, env, user.id, tagId);
  }
  
  // POST /merge - Merge tags
  if (path === '/merge' && method === 'POST') {
    return handleMerge(request, env, user.id);
  }
  
  return errorResponse('Not Found', 404, env.CORS_ORIGIN);
}

async function handleList(request: Request, env: Env, userId: string): Promise<Response> {
  const url = new URL(request.url);
  const workspaceId = url.searchParams.get('workspace_id');
  const category = url.searchParams.get('category');
  
  // Get user's accessible workspaces
  const workspaces = await env.DB.prepare(`
    SELECT workspace_id FROM workspace_members WHERE user_id = ?
  `).bind(userId).all<{ workspace_id: string }>();
  
  const workspaceIds = workspaces.results?.map(w => w.workspace_id) || [];
  
  if (workspaceIds.length === 0) {
    return jsonResponse({ tags: [] }, 200, env.CORS_ORIGIN);
  }
  
  let query = `SELECT * FROM tags WHERE workspace_id IN (${workspaceIds.map(() => '?').join(',')})`;
  const params: string[] = [...workspaceIds];
  
  if (workspaceId && workspaceIds.includes(workspaceId)) {
    query = 'SELECT * FROM tags WHERE workspace_id = ?';
    params.length = 0;
    params.push(workspaceId);
  }
  
  if (category) {
    query += ' AND category = ?';
    params.push(category);
  }
  
  query += ' ORDER BY usage_count DESC, name ASC';
  
  const result = await env.DB.prepare(query).bind(...params).all<Tag>();
  
  return jsonResponse({ tags: result.results || [] }, 200, env.CORS_ORIGIN);
}

async function handleCreate(request: Request, env: Env, userId: string): Promise<Response> {
  try {
    const body = await request.json() as { name: string; workspace_id: string; category?: string };
    
    if (!body.name || body.name.trim().length === 0) {
      return errorResponse('Tag name is required', 400, env.CORS_ORIGIN);
    }
    
    if (!body.workspace_id) {
      return errorResponse('Workspace ID is required', 400, env.CORS_ORIGIN);
    }
    
    // Verify access
    const access = await env.DB.prepare(`
      SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?
    `).bind(body.workspace_id, userId).first<{ role: string }>();
    
    if (!access || access.role === 'viewer') {
      return errorResponse('Insufficient permissions', 403, env.CORS_ORIGIN);
    }
    
    // Check if tag exists
    const existing = await env.DB.prepare(
      'SELECT id FROM tags WHERE workspace_id = ? AND name = ?'
    ).bind(body.workspace_id, body.name.trim()).first();
    
    if (existing) {
      return errorResponse('Tag already exists', 409, env.CORS_ORIGIN);
    }
    
    const tagId = generateId();
    const now = isoNow();
    
    await env.DB.prepare(`
      INSERT INTO tags (id, workspace_id, name, category, usage_count, created_at)
      VALUES (?, ?, ?, ?, 0, ?)
    `).bind(tagId, body.workspace_id, body.name.trim(), body.category || null, now).run();
    
    return jsonResponse({
      id: tagId,
      workspace_id: body.workspace_id,
      name: body.name.trim(),
      category: body.category || null,
      usage_count: 0,
      created_at: now,
    }, 201, env.CORS_ORIGIN);
    
  } catch (error) {
    console.error('Create tag error:', error);
    return errorResponse('Failed to create tag', 500, env.CORS_ORIGIN);
  }
}

async function handleUpdate(request: Request, env: Env, userId: string, tagId: string): Promise<Response> {
  try {
    // Verify access
    const tag = await env.DB.prepare(`
      SELECT t.*, wm.role FROM tags t
      JOIN workspace_members wm ON t.workspace_id = wm.workspace_id
      WHERE t.id = ? AND wm.user_id = ?
    `).bind(tagId, userId).first<Tag & { role: string }>();
    
    if (!tag) {
      return errorResponse('Tag not found', 404, env.CORS_ORIGIN);
    }
    
    if (tag.role === 'viewer') {
      return errorResponse('Insufficient permissions', 403, env.CORS_ORIGIN);
    }
    
    const body = await request.json() as { name?: string; category?: string };
    
    const updates: string[] = [];
    const params: (string | null)[] = [];
    
    if (body.name) {
      updates.push('name = ?');
      params.push(body.name.trim());
    }
    
    if (body.category !== undefined) {
      updates.push('category = ?');
      params.push(body.category || null);
    }
    
    if (updates.length === 0) {
      return errorResponse('No updates provided', 400, env.CORS_ORIGIN);
    }
    
    params.push(tagId);
    
    await env.DB.prepare(
      `UPDATE tags SET ${updates.join(', ')} WHERE id = ?`
    ).bind(...params).run();
    
    return jsonResponse({ message: 'Tag updated' }, 200, env.CORS_ORIGIN);
    
  } catch (error) {
    console.error('Update tag error:', error);
    return errorResponse('Failed to update tag', 500, env.CORS_ORIGIN);
  }
}

async function handleDelete(request: Request, env: Env, userId: string, tagId: string): Promise<Response> {
  // Verify access
  const tag = await env.DB.prepare(`
    SELECT t.id, wm.role FROM tags t
    JOIN workspace_members wm ON t.workspace_id = wm.workspace_id
    WHERE t.id = ? AND wm.user_id = ?
  `).bind(tagId, userId).first<{ id: string; role: string }>();
  
  if (!tag) {
    return errorResponse('Tag not found', 404, env.CORS_ORIGIN);
  }
  
  if (tag.role === 'viewer') {
    return errorResponse('Insufficient permissions', 403, env.CORS_ORIGIN);
  }
  
  // Remove tag from documents
  await env.DB.prepare('DELETE FROM document_tags WHERE tag_id = ?').bind(tagId).run();
  
  // Delete tag
  await env.DB.prepare('DELETE FROM tags WHERE id = ?').bind(tagId).run();
  
  return jsonResponse({ message: 'Tag deleted' }, 200, env.CORS_ORIGIN);
}

async function handleMerge(request: Request, env: Env, userId: string): Promise<Response> {
  try {
    const body = await request.json() as { source_tag_ids: string[]; target_tag_id: string };
    
    if (!body.source_tag_ids || body.source_tag_ids.length === 0) {
      return errorResponse('Source tag IDs are required', 400, env.CORS_ORIGIN);
    }
    
    if (!body.target_tag_id) {
      return errorResponse('Target tag ID is required', 400, env.CORS_ORIGIN);
    }
    
    // Verify access to target tag
    const targetTag = await env.DB.prepare(`
      SELECT t.id, t.workspace_id, wm.role FROM tags t
      JOIN workspace_members wm ON t.workspace_id = wm.workspace_id
      WHERE t.id = ? AND wm.user_id = ?
    `).bind(body.target_tag_id, userId).first<{ id: string; workspace_id: string; role: string }>();
    
    if (!targetTag || targetTag.role !== 'owner') {
      return errorResponse('Insufficient permissions to merge tags', 403, env.CORS_ORIGIN);
    }
    
    // Merge each source tag
    for (const sourceId of body.source_tag_ids) {
      if (sourceId === body.target_tag_id) continue;
      
      // Verify source tag is in same workspace
      const sourceTag = await env.DB.prepare(
        'SELECT id FROM tags WHERE id = ? AND workspace_id = ?'
      ).bind(sourceId, targetTag.workspace_id).first();
      
      if (!sourceTag) continue;
      
      // Move document associations
      await env.DB.prepare(`
        UPDATE OR IGNORE document_tags SET tag_id = ? WHERE tag_id = ?
      `).bind(body.target_tag_id, sourceId).run();
      
      // Delete remaining duplicates
      await env.DB.prepare('DELETE FROM document_tags WHERE tag_id = ?').bind(sourceId).run();
      
      // Delete source tag
      await env.DB.prepare('DELETE FROM tags WHERE id = ?').bind(sourceId).run();
    }
    
    // Update usage count
    const count = await env.DB.prepare(
      'SELECT COUNT(*) as count FROM document_tags WHERE tag_id = ?'
    ).bind(body.target_tag_id).first<{ count: number }>();
    
    await env.DB.prepare(
      'UPDATE tags SET usage_count = ? WHERE id = ?'
    ).bind(count?.count || 0, body.target_tag_id).run();
    
    return jsonResponse({ message: 'Tags merged' }, 200, env.CORS_ORIGIN);
    
  } catch (error) {
    console.error('Merge tags error:', error);
    return errorResponse('Failed to merge tags', 500, env.CORS_ORIGIN);
  }
}

// Helper: Add tags to document
export async function addTagsToDocument(
  documentId: string,
  tagIds: string[],
  source: 'ai_suggested' | 'user_added' | 'user_modified',
  env: Env
): Promise<void> {
  const now = isoNow();
  
  for (const tagId of tagIds) {
    // Check if already exists
    const existing = await env.DB.prepare(
      'SELECT 1 FROM document_tags WHERE document_id = ? AND tag_id = ?'
    ).bind(documentId, tagId).first();
    
    if (!existing) {
      await env.DB.prepare(`
        INSERT INTO document_tags (document_id, tag_id, source, created_at)
        VALUES (?, ?, ?, ?)
      `).bind(documentId, tagId, source, now).run();
      
      // Increment usage count
      await env.DB.prepare(
        'UPDATE tags SET usage_count = usage_count + 1 WHERE id = ?'
      ).bind(tagId).run();
    }
  }
}

// Helper: Remove tags from document
export async function removeTagsFromDocument(
  documentId: string,
  tagIds: string[],
  env: Env
): Promise<void> {
  for (const tagId of tagIds) {
    await env.DB.prepare(
      'DELETE FROM document_tags WHERE document_id = ? AND tag_id = ?'
    ).bind(documentId, tagId).run();
    
    // Decrement usage count
    await env.DB.prepare(
      'UPDATE tags SET usage_count = MAX(0, usage_count - 1) WHERE id = ?'
    ).bind(tagId).run();
  }
}
