// Chat Routes - RAG Pipeline

import type { Env, ChatSession, ChatMessage, ChatSource, ChatRequest } from '../../shared/types';
import { generateId, jsonResponse, errorResponse, isoNow } from '../../shared/utils';
import { authenticateRequest } from './auth';

export async function handleChat(request: Request, env: Env, path: string): Promise<Response> {
  const user = await authenticateRequest(request, env);
  if (!user) {
    return errorResponse('Unauthorized', 401, env.CORS_ORIGIN);
  }
  
  const method = request.method;
  
  // GET /sessions - List chat sessions
  if (path === '/sessions' && method === 'GET') {
    return handleListSessions(request, env, user.id);
  }
  
  // POST /sessions - Create chat session
  if (path === '/sessions' && method === 'POST') {
    return handleCreateSession(request, env, user.id);
  }
  
  // GET /sessions/:id - Get session with messages
  if (path.match(/^\/sessions\/[^\/]+$/) && method === 'GET') {
    const sessionId = path.replace('/sessions/', '');
    return handleGetSession(request, env, user.id, sessionId);
  }
  
  // POST /sessions/:id/messages - Send message (with streaming)
  if (path.match(/^\/sessions\/[^\/]+\/messages$/) && method === 'POST') {
    const sessionId = path.replace('/sessions/', '').replace('/messages', '');
    return handleSendMessage(request, env, user.id, sessionId);
  }
  
  // POST /feedback - Submit feedback on a message
  if (path === '/feedback' && method === 'POST') {
    return handleFeedback(request, env, user.id);
  }
  
  // DELETE /sessions/:id - Delete session
  if (path.match(/^\/sessions\/[^\/]+$/) && method === 'DELETE') {
    const sessionId = path.replace('/sessions/', '');
    return handleDeleteSession(request, env, user.id, sessionId);
  }
  
  return errorResponse('Not Found', 404, env.CORS_ORIGIN);
}

async function handleListSessions(request: Request, env: Env, userId: string): Promise<Response> {
  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 100);
  const offset = parseInt(url.searchParams.get('offset') || '0');
  
  // Get user's accessible workspaces
  const workspaces = await env.DB.prepare(`
    SELECT workspace_id FROM workspace_members WHERE user_id = ?
  `).bind(userId).all<{ workspace_id: string }>();
  
  const workspaceIds = workspaces.results?.map(w => w.workspace_id) || [];
  
  if (workspaceIds.length === 0) {
    return jsonResponse({ sessions: [], total: 0 }, 200, env.CORS_ORIGIN);
  }
  
  const sessions = await env.DB.prepare(`
    SELECT cs.*, 
      (SELECT content FROM chat_messages WHERE session_id = cs.id ORDER BY created_at DESC LIMIT 1) as last_message
    FROM chat_sessions cs
    WHERE cs.workspace_id IN (${workspaceIds.map(() => '?').join(',')})
    ORDER BY cs.updated_at DESC
    LIMIT ? OFFSET ?
  `).bind(...workspaceIds, limit, offset).all<ChatSession & { last_message: string }>();
  
  const count = await env.DB.prepare(`
    SELECT COUNT(*) as count FROM chat_sessions
    WHERE workspace_id IN (${workspaceIds.map(() => '?').join(',')})
  `).bind(...workspaceIds).first<{ count: number }>();
  
  return jsonResponse({
    sessions: sessions.results || [],
    total: count?.count || 0,
  }, 200, env.CORS_ORIGIN);
}

async function handleCreateSession(request: Request, env: Env, userId: string): Promise<Response> {
  try {
    const body = await request.json() as { workspace_id?: string; title?: string };
    
    // Get user's default workspace if not specified
    let workspaceId = body.workspace_id;
    
    if (!workspaceId) {
      const workspace = await env.DB.prepare(`
        SELECT workspace_id FROM workspace_members WHERE user_id = ? LIMIT 1
      `).bind(userId).first<{ workspace_id: string }>();
      
      if (!workspace) {
        return errorResponse('No workspace available', 400, env.CORS_ORIGIN);
      }
      
      workspaceId = workspace.workspace_id;
    }
    
    // Verify access
    const access = await env.DB.prepare(`
      SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?
    `).bind(workspaceId, userId).first();
    
    if (!access) {
      return errorResponse('Workspace not found', 404, env.CORS_ORIGIN);
    }
    
    const sessionId = generateId();
    const now = isoNow();
    
    await env.DB.prepare(`
      INSERT INTO chat_sessions (id, workspace_id, user_id, title, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(sessionId, workspaceId, userId, body.title || 'New Chat', now, now).run();
    
    return jsonResponse({
      id: sessionId,
      workspace_id: workspaceId,
      user_id: userId,
      title: body.title || 'New Chat',
      created_at: now,
      updated_at: now,
    }, 201, env.CORS_ORIGIN);
    
  } catch (error) {
    console.error('Create session error:', error);
    return errorResponse('Failed to create session', 500, env.CORS_ORIGIN);
  }
}

async function handleGetSession(request: Request, env: Env, userId: string, sessionId: string): Promise<Response> {
  // Verify access
  const session = await env.DB.prepare(`
    SELECT cs.* FROM chat_sessions cs
    JOIN workspace_members wm ON cs.workspace_id = wm.workspace_id
    WHERE cs.id = ? AND wm.user_id = ?
  `).bind(sessionId, userId).first<ChatSession>();
  
  if (!session) {
    return errorResponse('Session not found', 404, env.CORS_ORIGIN);
  }
  
  // Get messages
  const messages = await env.DB.prepare(`
    SELECT * FROM chat_messages
    WHERE session_id = ?
    ORDER BY created_at ASC
  `).bind(sessionId).all<ChatMessage>();
  
  return jsonResponse({
    ...session,
    messages: messages.results || [],
  }, 200, env.CORS_ORIGIN);
}

async function handleSendMessage(request: Request, env: Env, userId: string, sessionId: string): Promise<Response> {
  // Verify access
  const session = await env.DB.prepare(`
    SELECT cs.id, cs.workspace_id FROM chat_sessions cs
    JOIN workspace_members wm ON cs.workspace_id = wm.workspace_id
    WHERE cs.id = ? AND wm.user_id = ?
  `).bind(sessionId, userId).first<{ id: string; workspace_id: string }>();
  
  if (!session) {
    return errorResponse('Session not found', 404, env.CORS_ORIGIN);
  }
  
  try {
    const body = await request.json() as ChatRequest;
    
    if (!body.message || body.message.trim().length === 0) {
      return errorResponse('Message is required', 400, env.CORS_ORIGIN);
    }
    
    const now = isoNow();
    const userMessageId = generateId();
    
    // Save user message
    await env.DB.prepare(`
      INSERT INTO chat_messages (id, session_id, role, content, created_at)
      VALUES (?, ?, 'user', ?, ?)
    `).bind(userMessageId, sessionId, body.message, now).run();
    
    // RAG: Retrieve relevant context
    const context = await retrieveContext(body.message, session.workspace_id, env);
    
    // Build prompt with context
    const systemPrompt = `You are a helpful document assistant. Answer questions based ONLY on the provided document context. 
If you cannot find the answer in the context, say so clearly.
Always cite your sources by mentioning the document title.
For aggregate questions (totals, sums, counts), show your work with itemized breakdowns.`;

    const contextText = context.map((c, i) => 
      `[Source ${i + 1}: ${c.document_title}]\n${c.text_snippet}`
    ).join('\n\n');
    
    const userPrompt = `Context from user's documents:
${contextText}

User question: ${body.message}

Provide a helpful answer based on the context above. Cite which documents you used.`;

    // Get conversation history for context
    const history = await env.DB.prepare(`
      SELECT role, content FROM chat_messages
      WHERE session_id = ?
      ORDER BY created_at DESC
      LIMIT 10
    `).bind(sessionId).all<{ role: string; content: string }>();
    
    const messages = [
      { role: 'system', content: systemPrompt },
      ...((history.results || []).reverse().slice(0, -1).map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }))),
      { role: 'user', content: userPrompt },
    ];
    
    // Check if client accepts SSE
    const acceptsSSE = request.headers.get('Accept')?.includes('text/event-stream');
    
    if (acceptsSSE) {
      // Stream response
      return streamResponse(messages, context, sessionId, env);
    } else {
      // Non-streaming response
      const response = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
        messages,
      });
      
      const assistantContent = response.response;
      const assistantMessageId = generateId();
      
      // Save assistant message
      await env.DB.prepare(`
        INSERT INTO chat_messages (id, session_id, role, content, sources, created_at)
        VALUES (?, ?, 'assistant', ?, ?, ?)
      `).bind(
        assistantMessageId,
        sessionId,
        assistantContent,
        JSON.stringify(context),
        isoNow()
      ).run();
      
      // Update session
      await env.DB.prepare(`
        UPDATE chat_sessions SET updated_at = ? WHERE id = ?
      `).bind(isoNow(), sessionId).run();
      
      return jsonResponse({
        message: {
          id: assistantMessageId,
          session_id: sessionId,
          role: 'assistant',
          content: assistantContent,
          sources: context,
          created_at: isoNow(),
        },
        sources: context,
      }, 200, env.CORS_ORIGIN);
    }
    
  } catch (error) {
    console.error('Send message error:', error);
    return errorResponse('Failed to process message', 500, env.CORS_ORIGIN);
  }
}

async function streamResponse(
  messages: Array<{ role: string; content: string }>,
  sources: ChatSource[],
  sessionId: string,
  env: Env
): Promise<Response> {
  const encoder = new TextEncoder();
  
  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Use streaming AI
        const response = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
          messages,
          stream: true,
        });
        
        let fullContent = '';
        
        // @ts-ignore - streaming response
        for await (const chunk of response) {
          if (chunk.response) {
            fullContent += chunk.response;
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'content', text: chunk.response })}\n\n`));
          }
        }
        
        // Send sources
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'sources', sources })}\n\n`));
        
        // Save message
        const messageId = generateId();
        await env.DB.prepare(`
          INSERT INTO chat_messages (id, session_id, role, content, sources, created_at)
          VALUES (?, ?, 'assistant', ?, ?, ?)
        `).bind(messageId, sessionId, fullContent, JSON.stringify(sources), isoNow()).run();
        
        // Update session
        await env.DB.prepare(`
          UPDATE chat_sessions SET updated_at = ? WHERE id = ?
        `).bind(isoNow(), sessionId).run();
        
        // Send done
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done', message_id: messageId })}\n\n`));
        
        controller.close();
      } catch (error) {
        console.error('Stream error:', error);
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', message: 'Stream failed' })}\n\n`));
        controller.close();
      }
    },
  });
  
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': env.CORS_ORIGIN,
    },
  });
}

async function retrieveContext(query: string, workspaceId: string, env: Env): Promise<ChatSource[]> {
  // Generate query embedding
  const queryEmbedding = await generateEmbedding(query, env);
  
  // Search Vectorize
  const vectorResults = await env.VECTORS.query(queryEmbedding, {
    topK: 10,
    filter: {
      workspace_id: workspaceId,
    },
    returnMetadata: 'all',
  });
  
  const sources: ChatSource[] = [];
  const seenDocs = new Set<string>();
  
  for (const match of vectorResults.matches) {
    const docId = match.metadata?.document_id as string;
    if (!docId) continue;
    
    // Limit to 5 documents
    if (seenDocs.size >= 5 && !seenDocs.has(docId)) continue;
    
    // Get document title
    let docTitle = 'Unknown Document';
    if (!seenDocs.has(docId)) {
      const doc = await env.DB.prepare(
        'SELECT title FROM documents WHERE id = ?'
      ).bind(docId).first<{ title: string }>();
      docTitle = doc?.title || 'Unknown Document';
      seenDocs.add(docId);
    } else {
      // Get cached title from existing source
      const existing = sources.find(s => s.document_id === docId);
      docTitle = existing?.document_title || 'Unknown Document';
    }
    
    sources.push({
      document_id: docId,
      document_title: docTitle,
      chunk_id: match.id,
      text_snippet: (match.metadata?.text as string) || '',
      relevance_score: match.score || 0,
    });
  }
  
  return sources;
}

async function generateEmbedding(text: string, env: Env): Promise<number[]> {
  const result = await env.AI.run('@cf/baai/bge-base-en-v1.5', {
    text: [text],
  });
  
  return result.data[0];
}

async function handleFeedback(request: Request, env: Env, userId: string): Promise<Response> {
  try {
    const body = await request.json() as { message_id: string; feedback: 'up' | 'down' };
    
    if (!body.message_id || !body.feedback) {
      return errorResponse('Message ID and feedback are required', 400, env.CORS_ORIGIN);
    }
    
    // Verify access
    const message = await env.DB.prepare(`
      SELECT cm.id FROM chat_messages cm
      JOIN chat_sessions cs ON cm.session_id = cs.id
      JOIN workspace_members wm ON cs.workspace_id = wm.workspace_id
      WHERE cm.id = ? AND wm.user_id = ?
    `).bind(body.message_id, userId).first();
    
    if (!message) {
      return errorResponse('Message not found', 404, env.CORS_ORIGIN);
    }
    
    await env.DB.prepare(`
      UPDATE chat_messages SET feedback = ? WHERE id = ?
    `).bind(body.feedback, body.message_id).run();
    
    return jsonResponse({ message: 'Feedback recorded' }, 200, env.CORS_ORIGIN);
    
  } catch (error) {
    console.error('Feedback error:', error);
    return errorResponse('Failed to record feedback', 500, env.CORS_ORIGIN);
  }
}

async function handleDeleteSession(request: Request, env: Env, userId: string, sessionId: string): Promise<Response> {
  // Verify access (must be session owner or workspace owner)
  const session = await env.DB.prepare(`
    SELECT cs.id, cs.user_id, wm.role FROM chat_sessions cs
    JOIN workspace_members wm ON cs.workspace_id = wm.workspace_id
    WHERE cs.id = ? AND wm.user_id = ?
  `).bind(sessionId, userId).first<{ id: string; user_id: string; role: string }>();
  
  if (!session) {
    return errorResponse('Session not found', 404, env.CORS_ORIGIN);
  }
  
  if (session.user_id !== userId && session.role !== 'owner') {
    return errorResponse('Insufficient permissions', 403, env.CORS_ORIGIN);
  }
  
  // Delete messages
  await env.DB.prepare('DELETE FROM chat_messages WHERE session_id = ?').bind(sessionId).run();
  
  // Delete session
  await env.DB.prepare('DELETE FROM chat_sessions WHERE id = ?').bind(sessionId).run();
  
  return jsonResponse({ message: 'Session deleted' }, 200, env.CORS_ORIGIN);
}
