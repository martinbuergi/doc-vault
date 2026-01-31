// Authentication Routes

import type { Env, User, ApiKey, AuthRequest, AuthResponse, ApiKeyCreateRequest, ApiKeyCreateResponse } from '../../shared/types';
import {
  generateId,
  hashPassword,
  verifyPassword,
  generateJwt,
  verifyJwt,
  generateApiKey,
  hashApiKey,
  jsonResponse,
  errorResponse,
  parseAuthHeader,
  isoNow,
  isValidEmail,
  isValidPassword,
} from '../../shared/utils';

export async function handleAuth(request: Request, env: Env, path: string): Promise<Response> {
  const method = request.method;
  
  // POST /register
  if (path === '/register' && method === 'POST') {
    return handleRegister(request, env);
  }
  
  // POST /login
  if (path === '/login' && method === 'POST') {
    return handleLogin(request, env);
  }
  
  // POST /refresh
  if (path === '/refresh' && method === 'POST') {
    return handleRefresh(request, env);
  }
  
  // POST /logout
  if (path === '/logout' && method === 'POST') {
    return handleLogout(request, env);
  }
  
  // GET /keys - List API keys
  if (path === '/keys' && method === 'GET') {
    return handleListKeys(request, env);
  }
  
  // POST /keys - Create API key
  if (path === '/keys' && method === 'POST') {
    return handleCreateKey(request, env);
  }
  
  // DELETE /keys/:id - Revoke API key
  if (path.startsWith('/keys/') && method === 'DELETE') {
    const keyId = path.replace('/keys/', '');
    return handleRevokeKey(request, env, keyId);
  }
  
  // DELETE /account - Delete account
  if (path === '/account' && method === 'DELETE') {
    return handleDeleteAccount(request, env);
  }
  
  return errorResponse('Not Found', 404, env.CORS_ORIGIN);
}

async function handleRegister(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json() as AuthRequest & { display_name?: string };
    
    // Validate email
    if (!body.email || !isValidEmail(body.email)) {
      return errorResponse('Invalid email address', 400, env.CORS_ORIGIN);
    }
    
    // Validate password
    const passwordCheck = isValidPassword(body.password);
    if (!passwordCheck.valid) {
      return errorResponse(passwordCheck.message!, 400, env.CORS_ORIGIN);
    }
    
    // Check if user exists
    const existing = await env.DB.prepare(
      'SELECT id FROM users WHERE email = ?'
    ).bind(body.email.toLowerCase()).first();
    
    if (existing) {
      return errorResponse('Email already registered', 409, env.CORS_ORIGIN);
    }
    
    // Create user
    const userId = generateId();
    const passwordHash = await hashPassword(body.password);
    const now = isoNow();
    
    await env.DB.prepare(`
      INSERT INTO users (id, email, password_hash, display_name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(userId, body.email.toLowerCase(), passwordHash, body.display_name || null, now, now).run();
    
    // Create default workspace for user
    const workspaceId = generateId();
    await env.DB.prepare(`
      INSERT INTO workspaces (id, name, owner_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).bind(workspaceId, 'My Documents', userId, now, now).run();
    
    // Add user as workspace owner
    await env.DB.prepare(`
      INSERT INTO workspace_members (workspace_id, user_id, role, joined_at)
      VALUES (?, ?, 'owner', ?)
    `).bind(workspaceId, userId, now).run();
    
    // Generate JWT
    const token = await generateJwt(
      { sub: userId, email: body.email.toLowerCase(), workspace_id: workspaceId },
      env.JWT_SECRET
    );
    
    // Log the registration
    await logAuditEvent(env, userId, 'register', { email: body.email }, request);
    
    return jsonResponse({
      token,
      user: {
        id: userId,
        email: body.email.toLowerCase(),
        display_name: body.display_name || null,
        created_at: now,
      },
      workspace: {
        id: workspaceId,
        name: 'My Documents',
      },
    }, 201, env.CORS_ORIGIN);
    
  } catch (error) {
    console.error('Registration error:', error);
    return errorResponse('Registration failed', 500, env.CORS_ORIGIN);
  }
}

async function handleLogin(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json() as AuthRequest;
    
    // Find user
    const user = await env.DB.prepare(
      'SELECT id, email, password_hash, display_name, created_at FROM users WHERE email = ?'
    ).bind(body.email.toLowerCase()).first<User>();
    
    if (!user || !user.password_hash) {
      return errorResponse('Invalid email or password', 401, env.CORS_ORIGIN);
    }
    
    // Verify password
    const valid = await verifyPassword(body.password, user.password_hash);
    if (!valid) {
      return errorResponse('Invalid email or password', 401, env.CORS_ORIGIN);
    }
    
    // Get user's default workspace
    const workspace = await env.DB.prepare(`
      SELECT w.id, w.name FROM workspaces w
      JOIN workspace_members wm ON w.id = wm.workspace_id
      WHERE wm.user_id = ? AND wm.role = 'owner'
      LIMIT 1
    `).bind(user.id).first<{ id: string; name: string }>();
    
    // Generate JWT
    const token = await generateJwt(
      { sub: user.id, email: user.email, workspace_id: workspace?.id },
      env.JWT_SECRET
    );
    
    // Log the login
    await logAuditEvent(env, user.id, 'login', { email: user.email }, request);
    
    return jsonResponse({
      token,
      user: {
        id: user.id,
        email: user.email,
        display_name: user.display_name,
        created_at: user.created_at,
      },
      workspace: workspace,
    }, 200, env.CORS_ORIGIN);
    
  } catch (error) {
    console.error('Login error:', error);
    return errorResponse('Login failed', 500, env.CORS_ORIGIN);
  }
}

async function handleRefresh(request: Request, env: Env): Promise<Response> {
  const { type, value } = parseAuthHeader(request);
  
  if (type !== 'bearer' || !value) {
    return errorResponse('Unauthorized', 401, env.CORS_ORIGIN);
  }
  
  const payload = await verifyJwt(value, env.JWT_SECRET);
  if (!payload || !payload.sub) {
    return errorResponse('Invalid token', 401, env.CORS_ORIGIN);
  }
  
  // Generate new token
  const token = await generateJwt(
    { sub: payload.sub, email: payload.email, workspace_id: payload.workspace_id },
    env.JWT_SECRET
  );
  
  return jsonResponse({ token }, 200, env.CORS_ORIGIN);
}

async function handleLogout(request: Request, env: Env): Promise<Response> {
  const user = await authenticateRequest(request, env);
  if (!user) {
    return errorResponse('Unauthorized', 401, env.CORS_ORIGIN);
  }
  
  await logAuditEvent(env, user.id, 'logout', {}, request);
  
  // JWT is stateless, so we just return success
  // In production, you might want to add the token to a blacklist
  return jsonResponse({ message: 'Logged out successfully' }, 200, env.CORS_ORIGIN);
}

async function handleListKeys(request: Request, env: Env): Promise<Response> {
  const user = await authenticateRequest(request, env);
  if (!user) {
    return errorResponse('Unauthorized', 401, env.CORS_ORIGIN);
  }
  
  const keys = await env.DB.prepare(`
    SELECT id, name, key_prefix, role, workspace_id, last_used_at, expires_at, created_at
    FROM api_keys
    WHERE user_id = ?
    ORDER BY created_at DESC
  `).bind(user.id).all<Omit<ApiKey, 'key_hash' | 'user_id'>>();
  
  return jsonResponse({ keys: keys.results || [] }, 200, env.CORS_ORIGIN);
}

async function handleCreateKey(request: Request, env: Env): Promise<Response> {
  const user = await authenticateRequest(request, env);
  if (!user) {
    return errorResponse('Unauthorized', 401, env.CORS_ORIGIN);
  }
  
  try {
    const body = await request.json() as ApiKeyCreateRequest;
    
    if (!body.name || body.name.length < 1) {
      return errorResponse('Name is required', 400, env.CORS_ORIGIN);
    }
    
    if (!body.workspace_id) {
      return errorResponse('Workspace ID is required', 400, env.CORS_ORIGIN);
    }
    
    // Verify user has access to workspace
    const membership = await env.DB.prepare(
      'SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?'
    ).bind(body.workspace_id, user.id).first<{ role: string }>();
    
    if (!membership) {
      return errorResponse('Workspace not found', 404, env.CORS_ORIGIN);
    }
    
    // Only owners can create API keys with elevated roles
    if (body.role === 'editor' && membership.role !== 'owner') {
      return errorResponse('Only workspace owners can create editor keys', 403, env.CORS_ORIGIN);
    }
    
    // Generate key
    const { key, prefix } = generateApiKey();
    const keyHash = await hashApiKey(key);
    const keyId = generateId();
    const now = isoNow();
    
    let expiresAt: string | null = null;
    if (body.expires_in_days) {
      const expiry = new Date();
      expiry.setDate(expiry.getDate() + body.expires_in_days);
      expiresAt = expiry.toISOString();
    }
    
    await env.DB.prepare(`
      INSERT INTO api_keys (id, user_id, workspace_id, key_hash, key_prefix, name, role, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(keyId, user.id, body.workspace_id, keyHash, prefix, body.name, body.role || 'viewer', expiresAt, now).run();
    
    await logAuditEvent(env, user.id, 'key_create', { key_id: keyId, name: body.name }, request);
    
    const response: ApiKeyCreateResponse = {
      id: keyId,
      key, // Full key, shown only once
      name: body.name,
      prefix,
      role: body.role || 'viewer',
      expires_at: expiresAt || undefined,
      created_at: now,
    };
    
    return jsonResponse(response, 201, env.CORS_ORIGIN);
    
  } catch (error) {
    console.error('Create key error:', error);
    return errorResponse('Failed to create API key', 500, env.CORS_ORIGIN);
  }
}

async function handleRevokeKey(request: Request, env: Env, keyId: string): Promise<Response> {
  const user = await authenticateRequest(request, env);
  if (!user) {
    return errorResponse('Unauthorized', 401, env.CORS_ORIGIN);
  }
  
  // Verify key belongs to user
  const key = await env.DB.prepare(
    'SELECT id FROM api_keys WHERE id = ? AND user_id = ?'
  ).bind(keyId, user.id).first();
  
  if (!key) {
    return errorResponse('API key not found', 404, env.CORS_ORIGIN);
  }
  
  await env.DB.prepare('DELETE FROM api_keys WHERE id = ?').bind(keyId).run();
  
  await logAuditEvent(env, user.id, 'key_revoke', { key_id: keyId }, request);
  
  return jsonResponse({ message: 'API key revoked' }, 200, env.CORS_ORIGIN);
}

async function handleDeleteAccount(request: Request, env: Env): Promise<Response> {
  const user = await authenticateRequest(request, env);
  if (!user) {
    return errorResponse('Unauthorized', 401, env.CORS_ORIGIN);
  }
  
  // Delete all user data
  // This should be done in a transaction in production
  
  // Delete API keys
  await env.DB.prepare('DELETE FROM api_keys WHERE user_id = ?').bind(user.id).run();
  
  // Delete workspace memberships
  await env.DB.prepare('DELETE FROM workspace_members WHERE user_id = ?').bind(user.id).run();
  
  // Get workspaces owned by user
  const workspaces = await env.DB.prepare(
    'SELECT id FROM workspaces WHERE owner_id = ?'
  ).bind(user.id).all<{ id: string }>();
  
  for (const ws of workspaces.results || []) {
    // Delete documents and related data
    const docs = await env.DB.prepare(
      'SELECT id, file_key, text_key FROM documents WHERE workspace_id = ?'
    ).bind(ws.id).all<{ id: string; file_key: string; text_key: string }>();
    
    for (const doc of docs.results || []) {
      // Delete from R2
      await env.FILES.delete(doc.file_key);
      if (doc.text_key) {
        await env.FILES.delete(doc.text_key);
      }
      
      // Delete vectors
      // Note: Vectorize delete would be done here
      
      // Delete chunks
      await env.DB.prepare('DELETE FROM document_chunks WHERE document_id = ?').bind(doc.id).run();
      
      // Delete tags
      await env.DB.prepare('DELETE FROM document_tags WHERE document_id = ?').bind(doc.id).run();
    }
    
    // Delete documents
    await env.DB.prepare('DELETE FROM documents WHERE workspace_id = ?').bind(ws.id).run();
    
    // Delete workspace tags
    await env.DB.prepare('DELETE FROM tags WHERE workspace_id = ?').bind(ws.id).run();
    
    // Delete workspace members
    await env.DB.prepare('DELETE FROM workspace_members WHERE workspace_id = ?').bind(ws.id).run();
    
    // Delete workspace
    await env.DB.prepare('DELETE FROM workspaces WHERE id = ?').bind(ws.id).run();
  }
  
  // Delete user
  await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(user.id).run();
  
  await logAuditEvent(env, user.id, 'account_delete', {}, request);
  
  return jsonResponse({ message: 'Account deleted' }, 200, env.CORS_ORIGIN);
}

// Helper: Authenticate request and return user
export async function authenticateRequest(request: Request, env: Env): Promise<User | null> {
  const { type, value } = parseAuthHeader(request);
  
  if (!type || !value) {
    return null;
  }
  
  if (type === 'bearer') {
    // Try JWT first
    const payload = await verifyJwt(value, env.JWT_SECRET);
    if (payload && payload.sub) {
      const user = await env.DB.prepare(
        'SELECT id, email, display_name, created_at, updated_at FROM users WHERE id = ?'
      ).bind(payload.sub).first<User>();
      return user || null;
    }
    
    // Try API key
    const keyHash = await hashApiKey(value);
    const apiKey = await env.DB.prepare(`
      SELECT ak.user_id, ak.workspace_id, ak.role, u.id, u.email, u.display_name, u.created_at, u.updated_at
      FROM api_keys ak
      JOIN users u ON ak.user_id = u.id
      WHERE ak.key_hash = ? AND (ak.expires_at IS NULL OR ak.expires_at > ?)
    `).bind(keyHash, isoNow()).first<{ user_id: string } & User>();
    
    if (apiKey) {
      // Update last used
      await env.DB.prepare(
        'UPDATE api_keys SET last_used_at = ? WHERE key_hash = ?'
      ).bind(isoNow(), keyHash).run();
      
      return {
        id: apiKey.id,
        email: apiKey.email,
        display_name: apiKey.display_name,
        created_at: apiKey.created_at,
        updated_at: apiKey.updated_at,
      };
    }
  }
  
  return null;
}

// Helper: Log audit event
async function logAuditEvent(
  env: Env,
  userId: string,
  eventType: string,
  detail: Record<string, unknown>,
  request: Request
): Promise<void> {
  try {
    await env.DB.prepare(`
      INSERT INTO audit_log (id, user_id, event_type, detail, ip_address, user_agent, auth_method, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      generateId(),
      userId,
      eventType,
      JSON.stringify(detail),
      request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For'),
      request.headers.get('User-Agent'),
      'jwt',
      isoNow()
    ).run();
  } catch (error) {
    console.error('Audit log error:', error);
  }
}
