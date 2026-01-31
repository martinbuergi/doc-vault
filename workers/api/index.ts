// DocVault API Worker - Main Entry Point

import type { Env, ProcessingQueueMessage } from '../shared/types';
import { handleCors, errorResponse } from '../shared/utils';
import { processDocument } from '../shared/processing';
import { handleAuth } from './routes/auth';
import { handleDocuments } from './routes/documents';
import { handleTags } from './routes/tags';
import { handleSearch } from './routes/search';
import { handleChat } from './routes/chat';
import { handleWorkspaces } from './routes/workspaces';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return handleCors(env.CORS_ORIGIN);
    }
    
    try {
      // Route to appropriate handler
      if (path.startsWith('/api/v1/auth')) {
        return await handleAuth(request, env, path.replace('/api/v1/auth', ''));
      }
      
      if (path.startsWith('/api/v1/documents')) {
        return await handleDocuments(request, env, path.replace('/api/v1/documents', ''));
      }
      
      if (path.startsWith('/api/v1/tags')) {
        return await handleTags(request, env, path.replace('/api/v1/tags', ''));
      }
      
      if (path.startsWith('/api/v1/search')) {
        return await handleSearch(request, env, path.replace('/api/v1/search', ''));
      }
      
      if (path.startsWith('/api/v1/chat')) {
        return await handleChat(request, env, path.replace('/api/v1/chat', ''));
      }
      
      if (path.startsWith('/api/v1/workspaces')) {
        return await handleWorkspaces(request, env, path.replace('/api/v1/workspaces', ''));
      }
      
      // Health check
      if (path === '/health' || path === '/') {
        return new Response(JSON.stringify({
          status: 'ok',
          version: env.API_VERSION,
          environment: env.ENVIRONMENT,
        }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }
      
      return errorResponse('Not Found', 404, env.CORS_ORIGIN);
    } catch (error) {
      console.error('API Error:', error);
      return errorResponse(
        error instanceof Error ? error.message : 'Internal Server Error',
        500,
        env.CORS_ORIGIN
      );
    }
  },
  
  // Queue consumer for async document processing
  async queue(batch: MessageBatch<ProcessingQueueMessage>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      try {
        const data = message.body;
        
        if (data.type === 'document_uploaded') {
          await processDocument(data, env);
        }
        
        message.ack();
      } catch (error) {
        console.error('Queue processing error:', error);
        message.retry();
      }
    }
  },
};

// Note: processDocument is imported from '../shared/processing'
