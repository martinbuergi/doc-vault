// Workspace Management Routes

import type { Env, Workspace, WorkspaceMember } from '../../shared/types';
import { generateId, jsonResponse, errorResponse, isoNow, isValidEmail } from '../../shared/utils';
import { authenticateRequest } from './auth';

export async function handleWorkspaces(request: Request, env: Env, path: string): Promise<Response> {
  const user = await authenticateRequest(request, env);
  if (!user) {
    return errorResponse('Unauthorized', 401, env.CORS_ORIGIN);
  }
  
  const method = request.method;
  
  // GET / - List workspaces
  if ((path === '' || path === '/') && method === 'GET') {
    return handleList(request, env, user.id);
  }
  
  // POST / - Create workspace
  if ((path === '' || path === '/') && method === 'POST') {
    return handleCreate(request, env, user.id);
  }
  
  // GET /:id - Get workspace
  if (path.match(/^\/[^\/]+$/) && method === 'GET') {
    const workspaceId = path.substring(1);
    return handleGet(request, env, user.id, workspaceId);
  }
  
  // PATCH /:id - Update workspace
  if (path.match(/^\/[^\/]+$/) && method === 'PATCH') {
    const workspaceId = path.substring(1);
    return handleUpdate(request, env, user.id, workspaceId);
  }
  
  // DELETE /:id - Delete workspace
  if (path.match(/^\/[^\/]+$/) && method === 'DELETE') {
    const workspaceId = path.substring(1);
    return handleDelete(request, env, user.id, workspaceId);
  }
  
  // GET /:id/members - List members
  if (path.match(/^\/[^\/]+\/members$/) && method === 'GET') {
    const workspaceId = path.replace('/members', '').substring(1);
    return handleListMembers(request, env, user.id, workspaceId);
  }
  
  // POST /:id/members - Invite member
  if (path.match(/^\/[^\/]+\/members$/) && method === 'POST') {
    const workspaceId = path.replace('/members', '').substring(1);
    return handleInviteMember(request, env, user.id, workspaceId);
  }
  
  // PATCH /:id/members/:userId - Update member role
  if (path.match(/^\/[^\/]+\/members\/[^\/]+$/) && method === 'PATCH') {
    const parts = path.split('/');
    const workspaceId = parts[1];
    const memberId = parts[3];
    return handleUpdateMember(request, env, user.id, workspaceId, memberId);
  }
  
  // DELETE /:id/members/:userId - Remove member
  if (path.match(/^\/[^\/]+\/members\/[^\/]+$/) && method === 'DELETE') {
    const parts = path.split('/');
    const workspaceId = parts[1];
    const memberId = parts[3];
    return handleRemoveMember(request, env, user.id, workspaceId, memberId);
  }
  
  // POST /:id/transfer - Transfer ownership
  if (path.match(/^\/[^\/]+\/transfer$/) && method === 'POST') {
    const workspaceId = path.replace('/transfer', '').substring(1);
    return handleTransferOwnership(request, env, user.id, workspaceId);
  }
  
  return errorResponse('Not Found', 404, env.CORS_ORIGIN);
}

async function handleList(request: Request, env: Env, userId: string): Promise<Response> {
  const workspaces = await env.DB.prepare(`
    SELECT w.*, wm.role as my_role,
      (SELECT COUNT(*) FROM workspace_members WHERE workspace_id = w.id) as member_count,
      (SELECT COUNT(*) FROM documents WHERE workspace_id = w.id) as document_count
    FROM workspaces w
    JOIN workspace_members wm ON w.id = wm.workspace_id
    WHERE wm.user_id = ?
    ORDER BY w.updated_at DESC
  `).bind(userId).all<Workspace & { my_role: string; member_count: number; document_count: number }>();
  
  return jsonResponse({ workspaces: workspaces.results || [] }, 200, env.CORS_ORIGIN);
}

async function handleCreate(request: Request, env: Env, userId: string): Promise<Response> {
  try {
    const body = await request.json() as { name: string };
    
    if (!body.name || body.name.trim().length === 0) {
      return errorResponse('Workspace name is required', 400, env.CORS_ORIGIN);
    }
    
    const workspaceId = generateId();
    const now = isoNow();
    
    // Create workspace
    await env.DB.prepare(`
      INSERT INTO workspaces (id, name, owner_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).bind(workspaceId, body.name.trim(), userId, now, now).run();
    
    // Add creator as owner
    await env.DB.prepare(`
      INSERT INTO workspace_members (workspace_id, user_id, role, joined_at)
      VALUES (?, ?, 'owner', ?)
    `).bind(workspaceId, userId, now).run();
    
    return jsonResponse({
      id: workspaceId,
      name: body.name.trim(),
      owner_id: userId,
      created_at: now,
      updated_at: now,
      my_role: 'owner',
    }, 201, env.CORS_ORIGIN);
    
  } catch (error) {
    console.error('Create workspace error:', error);
    return errorResponse('Failed to create workspace', 500, env.CORS_ORIGIN);
  }
}

async function handleGet(request: Request, env: Env, userId: string, workspaceId: string): Promise<Response> {
  const workspace = await env.DB.prepare(`
    SELECT w.*, wm.role as my_role
    FROM workspaces w
    JOIN workspace_members wm ON w.id = wm.workspace_id
    WHERE w.id = ? AND wm.user_id = ?
  `).bind(workspaceId, userId).first<Workspace & { my_role: string }>();
  
  if (!workspace) {
    return errorResponse('Workspace not found', 404, env.CORS_ORIGIN);
  }
  
  return jsonResponse(workspace, 200, env.CORS_ORIGIN);
}

async function handleUpdate(request: Request, env: Env, userId: string, workspaceId: string): Promise<Response> {
  // Verify ownership
  const workspace = await env.DB.prepare(`
    SELECT w.id FROM workspaces w
    JOIN workspace_members wm ON w.id = wm.workspace_id
    WHERE w.id = ? AND wm.user_id = ? AND wm.role = 'owner'
  `).bind(workspaceId, userId).first();
  
  if (!workspace) {
    return errorResponse('Workspace not found or insufficient permissions', 404, env.CORS_ORIGIN);
  }
  
  try {
    const body = await request.json() as { name?: string };
    
    if (body.name) {
      await env.DB.prepare(
        'UPDATE workspaces SET name = ?, updated_at = ? WHERE id = ?'
      ).bind(body.name.trim(), isoNow(), workspaceId).run();
    }
    
    return jsonResponse({ message: 'Workspace updated' }, 200, env.CORS_ORIGIN);
    
  } catch (error) {
    console.error('Update workspace error:', error);
    return errorResponse('Failed to update workspace', 500, env.CORS_ORIGIN);
  }
}

async function handleDelete(request: Request, env: Env, userId: string, workspaceId: string): Promise<Response> {
  // Verify ownership
  const workspace = await env.DB.prepare(`
    SELECT w.id FROM workspaces w
    WHERE w.id = ? AND w.owner_id = ?
  `).bind(workspaceId, userId).first();
  
  if (!workspace) {
    return errorResponse('Workspace not found or insufficient permissions', 404, env.CORS_ORIGIN);
  }
  
  // Check if this is user's only workspace
  const workspaceCount = await env.DB.prepare(`
    SELECT COUNT(*) as count FROM workspace_members WHERE user_id = ?
  `).bind(userId).first<{ count: number }>();
  
  if (workspaceCount && workspaceCount.count <= 1) {
    return errorResponse('Cannot delete your only workspace', 400, env.CORS_ORIGIN);
  }
  
  // Delete all workspace data
  // Get documents
  const docs = await env.DB.prepare(
    'SELECT id, file_key, text_key FROM documents WHERE workspace_id = ?'
  ).bind(workspaceId).all<{ id: string; file_key: string; text_key: string }>();
  
  // Delete files from R2
  for (const doc of docs.results || []) {
    await env.FILES.delete(doc.file_key);
    if (doc.text_key) {
      await env.FILES.delete(doc.text_key);
    }
    
    // Delete chunks
    await env.DB.prepare('DELETE FROM document_chunks WHERE document_id = ?').bind(doc.id).run();
    await env.DB.prepare('DELETE FROM document_tags WHERE document_id = ?').bind(doc.id).run();
  }
  
  // Delete documents
  await env.DB.prepare('DELETE FROM documents WHERE workspace_id = ?').bind(workspaceId).run();
  
  // Delete tags
  await env.DB.prepare('DELETE FROM tags WHERE workspace_id = ?').bind(workspaceId).run();
  
  // Delete chat sessions and messages
  const sessions = await env.DB.prepare(
    'SELECT id FROM chat_sessions WHERE workspace_id = ?'
  ).bind(workspaceId).all<{ id: string }>();
  
  for (const session of sessions.results || []) {
    await env.DB.prepare('DELETE FROM chat_messages WHERE session_id = ?').bind(session.id).run();
  }
  await env.DB.prepare('DELETE FROM chat_sessions WHERE workspace_id = ?').bind(workspaceId).run();
  
  // Delete API keys
  await env.DB.prepare('DELETE FROM api_keys WHERE workspace_id = ?').bind(workspaceId).run();
  
  // Delete members
  await env.DB.prepare('DELETE FROM workspace_members WHERE workspace_id = ?').bind(workspaceId).run();
  
  // Delete workspace
  await env.DB.prepare('DELETE FROM workspaces WHERE id = ?').bind(workspaceId).run();
  
  return jsonResponse({ message: 'Workspace deleted' }, 200, env.CORS_ORIGIN);
}

async function handleListMembers(request: Request, env: Env, userId: string, workspaceId: string): Promise<Response> {
  // Verify access
  const access = await env.DB.prepare(`
    SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?
  `).bind(workspaceId, userId).first();
  
  if (!access) {
    return errorResponse('Workspace not found', 404, env.CORS_ORIGIN);
  }
  
  const members = await env.DB.prepare(`
    SELECT wm.*, u.email, u.display_name
    FROM workspace_members wm
    JOIN users u ON wm.user_id = u.id
    WHERE wm.workspace_id = ?
    ORDER BY wm.joined_at ASC
  `).bind(workspaceId).all<WorkspaceMember & { email: string; display_name: string }>();
  
  return jsonResponse({ members: members.results || [] }, 200, env.CORS_ORIGIN);
}

async function handleInviteMember(request: Request, env: Env, userId: string, workspaceId: string): Promise<Response> {
  // Verify ownership
  const access = await env.DB.prepare(`
    SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?
  `).bind(workspaceId, userId).first<{ role: string }>();
  
  if (!access || access.role !== 'owner') {
    return errorResponse('Only workspace owners can invite members', 403, env.CORS_ORIGIN);
  }
  
  try {
    const body = await request.json() as { email: string; role: string };
    
    if (!body.email || !isValidEmail(body.email)) {
      return errorResponse('Valid email is required', 400, env.CORS_ORIGIN);
    }
    
    const role = body.role || 'viewer';
    if (!['editor', 'viewer'].includes(role)) {
      return errorResponse('Invalid role', 400, env.CORS_ORIGIN);
    }
    
    // Find user by email
    const invitee = await env.DB.prepare(
      'SELECT id FROM users WHERE email = ?'
    ).bind(body.email.toLowerCase()).first<{ id: string }>();
    
    if (!invitee) {
      // In a real app, you'd send an invitation email
      return errorResponse('User not found. They need to create an account first.', 404, env.CORS_ORIGIN);
    }
    
    // Check if already a member
    const existingMember = await env.DB.prepare(
      'SELECT user_id FROM workspace_members WHERE workspace_id = ? AND user_id = ?'
    ).bind(workspaceId, invitee.id).first();
    
    if (existingMember) {
      return errorResponse('User is already a member of this workspace', 409, env.CORS_ORIGIN);
    }
    
    // Add member
    const now = isoNow();
    await env.DB.prepare(`
      INSERT INTO workspace_members (workspace_id, user_id, role, invited_by, joined_at)
      VALUES (?, ?, ?, ?, ?)
    `).bind(workspaceId, invitee.id, role, userId, now).run();
    
    return jsonResponse({
      message: 'Member added',
      user_id: invitee.id,
      role,
      joined_at: now,
    }, 201, env.CORS_ORIGIN);
    
  } catch (error) {
    console.error('Invite member error:', error);
    return errorResponse('Failed to invite member', 500, env.CORS_ORIGIN);
  }
}

async function handleUpdateMember(request: Request, env: Env, userId: string, workspaceId: string, memberId: string): Promise<Response> {
  // Verify ownership
  const access = await env.DB.prepare(`
    SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?
  `).bind(workspaceId, userId).first<{ role: string }>();
  
  if (!access || access.role !== 'owner') {
    return errorResponse('Only workspace owners can update member roles', 403, env.CORS_ORIGIN);
  }
  
  // Cannot change owner's role
  if (memberId === userId) {
    return errorResponse('Cannot change your own role', 400, env.CORS_ORIGIN);
  }
  
  try {
    const body = await request.json() as { role: string };
    
    if (!['editor', 'viewer'].includes(body.role)) {
      return errorResponse('Invalid role', 400, env.CORS_ORIGIN);
    }
    
    await env.DB.prepare(
      'UPDATE workspace_members SET role = ? WHERE workspace_id = ? AND user_id = ?'
    ).bind(body.role, workspaceId, memberId).run();
    
    return jsonResponse({ message: 'Member role updated' }, 200, env.CORS_ORIGIN);
    
  } catch (error) {
    console.error('Update member error:', error);
    return errorResponse('Failed to update member', 500, env.CORS_ORIGIN);
  }
}

async function handleRemoveMember(request: Request, env: Env, userId: string, workspaceId: string, memberId: string): Promise<Response> {
  // Verify ownership or self-removal
  const access = await env.DB.prepare(`
    SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?
  `).bind(workspaceId, userId).first<{ role: string }>();
  
  if (!access) {
    return errorResponse('Workspace not found', 404, env.CORS_ORIGIN);
  }
  
  if (access.role !== 'owner' && memberId !== userId) {
    return errorResponse('Only workspace owners can remove members', 403, env.CORS_ORIGIN);
  }
  
  // Owner cannot remove themselves
  if (memberId === userId && access.role === 'owner') {
    return errorResponse('Workspace owner cannot leave. Transfer ownership first.', 400, env.CORS_ORIGIN);
  }
  
  await env.DB.prepare(
    'DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ?'
  ).bind(workspaceId, memberId).run();
  
  // Also revoke their API keys for this workspace
  await env.DB.prepare(
    'DELETE FROM api_keys WHERE workspace_id = ? AND user_id = ?'
  ).bind(workspaceId, memberId).run();
  
  return jsonResponse({ message: 'Member removed' }, 200, env.CORS_ORIGIN);
}

async function handleTransferOwnership(request: Request, env: Env, userId: string, workspaceId: string): Promise<Response> {
  // Verify ownership
  const workspace = await env.DB.prepare(`
    SELECT id FROM workspaces WHERE id = ? AND owner_id = ?
  `).bind(workspaceId, userId).first();
  
  if (!workspace) {
    return errorResponse('Workspace not found or you are not the owner', 404, env.CORS_ORIGIN);
  }
  
  try {
    const body = await request.json() as { new_owner_id: string };
    
    if (!body.new_owner_id) {
      return errorResponse('New owner ID is required', 400, env.CORS_ORIGIN);
    }
    
    // Verify new owner is a member
    const newOwner = await env.DB.prepare(`
      SELECT user_id FROM workspace_members WHERE workspace_id = ? AND user_id = ?
    `).bind(workspaceId, body.new_owner_id).first();
    
    if (!newOwner) {
      return errorResponse('New owner must be a member of the workspace', 400, env.CORS_ORIGIN);
    }
    
    // Update workspace owner
    await env.DB.prepare(
      'UPDATE workspaces SET owner_id = ?, updated_at = ? WHERE id = ?'
    ).bind(body.new_owner_id, isoNow(), workspaceId).run();
    
    // Update member roles
    await env.DB.prepare(
      'UPDATE workspace_members SET role = ? WHERE workspace_id = ? AND user_id = ?'
    ).bind('owner', workspaceId, body.new_owner_id).run();
    
    await env.DB.prepare(
      'UPDATE workspace_members SET role = ? WHERE workspace_id = ? AND user_id = ?'
    ).bind('editor', workspaceId, userId).run();
    
    return jsonResponse({ message: 'Ownership transferred' }, 200, env.CORS_ORIGIN);
    
  } catch (error) {
    console.error('Transfer ownership error:', error);
    return errorResponse('Failed to transfer ownership', 500, env.CORS_ORIGIN);
  }
}
