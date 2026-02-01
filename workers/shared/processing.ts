// Document Processing Module
// Handles text extraction, chunking, embedding, and auto-tagging

import type { Env, ProcessingQueueMessage } from './types';
import { extractText as extractPdfText, getDocumentProxy } from 'unpdf';

/**
 * Process an uploaded document
 * - Extract text
 * - Chunk and embed
 * - Auto-tag with LLM
 */
export async function processDocument(data: ProcessingQueueMessage, env: Env): Promise<void> {
  const { document_id, file_key, mime_type } = data;
  
  try {
    // Update status to processing
    await env.DB.prepare(
      'UPDATE documents SET status = ?, updated_at = ? WHERE id = ?'
    ).bind('processing', new Date().toISOString(), document_id).run();
    
    // Get file from R2
    const file = await env.FILES.get(file_key);
    if (!file) {
      throw new Error('File not found in storage');
    }
    
    // Extract text based on mime type
    const text = await extractText(file, mime_type, env);
    
    // Store extracted text in R2
    const textKey = `text/${document_id}.txt`;
    await env.FILES.put(textKey, text);
    
    // Chunk the text
    const chunks = chunkText(text, 512, 64);
    
    // Generate embeddings and store in Vectorize
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const chunkId = `${document_id}_${i}`;
      
      // Generate embedding via AI Gateway
      const embedding = await generateEmbedding(chunk.text, env);
      
      // Store in Vectorize
      await env.VECTORS.upsert([{
        id: chunkId,
        values: embedding,
        metadata: {
          document_id,
          workspace_id: data.workspace_id,
          chunk_index: i,
          text: chunk.text.substring(0, 500), // Store truncated text for retrieval
        },
      }]);
      
      // Store chunk in D1
      await env.DB.prepare(`
        INSERT INTO document_chunks (id, document_id, chunk_index, text_content, token_count)
        VALUES (?, ?, ?, ?, ?)
      `).bind(chunkId, document_id, i, chunk.text, chunk.tokenCount).run();
    }
    
    // Auto-tag with LLM
    const tags = await autoTag(text, data.workspace_id, env);
    
    // Store suggested tags
    for (const tag of tags) {
      // Find or create tag
      let tagRecord = await env.DB.prepare(
        'SELECT id FROM tags WHERE workspace_id = ? AND name = ?'
      ).bind(data.workspace_id, tag.name).first<{ id: string }>();
      
      if (!tagRecord) {
        const tagId = crypto.randomUUID();
        await env.DB.prepare(`
          INSERT INTO tags (id, workspace_id, name, category, usage_count, created_at)
          VALUES (?, ?, ?, ?, 0, ?)
        `).bind(tagId, data.workspace_id, tag.name, tag.category || null, new Date().toISOString()).run();
        tagRecord = { id: tagId };
      }
      
      // Create document-tag relationship
      await env.DB.prepare(`
        INSERT INTO document_tags (document_id, tag_id, source, confidence, created_at)
        VALUES (?, ?, 'ai_suggested', ?, ?)
      `).bind(document_id, tagRecord.id, tag.confidence, new Date().toISOString()).run();
    }
    
    // Update document status to ready
    await env.DB.prepare(
      'UPDATE documents SET status = ?, text_key = ?, updated_at = ? WHERE id = ?'
    ).bind('ready', textKey, new Date().toISOString(), document_id).run();
    
  } catch (error) {
    console.error('Document processing failed:', error);
    
    // Update status to error
    await env.DB.prepare(
      'UPDATE documents SET status = ?, error_message = ?, updated_at = ? WHERE id = ?'
    ).bind('error', error instanceof Error ? error.message : 'Unknown error', new Date().toISOString(), document_id).run();
  }
}

/**
 * Extract text from a file based on its mime type
 */
async function extractText(file: R2ObjectBody, mimeType: string, env: Env): Promise<string> {
  const content = await file.arrayBuffer();
  
  // Plain text
  if (mimeType === 'text/plain') {
    return new TextDecoder().decode(content);
  }
  
  // PDF extraction using unpdf
  if (mimeType === 'application/pdf') {
    try {
      const pdf = await getDocumentProxy(new Uint8Array(content));
      const { text } = await extractPdfText(pdf, { mergePages: true });
      return text || '[PDF content could not be extracted]';
    } catch (error) {
      console.error('PDF extraction error:', error);
      // Fallback: try using AI to describe the document
      return await extractWithAI(content, mimeType, env);
    }
  }
  
  // Images - use AI vision to extract text (OCR)
  if (mimeType.startsWith('image/')) {
    return await extractWithAI(content, mimeType, env);
  }
  
  // DOCX - extract XML content
  if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    try {
      // DOCX files are ZIP archives containing XML
      // For now, use AI extraction as a fallback
      return await extractWithAI(content, mimeType, env);
    } catch (error) {
      console.error('DOCX extraction error:', error);
      return '[DOCX content could not be extracted]';
    }
  }
  
  // Excel - use AI extraction
  if (mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
    return await extractWithAI(content, mimeType, env);
  }
  
  // Fallback for unknown types
  return `[Unsupported document type: ${mimeType}]`;
}

/**
 * Extract text using Cloudflare AI (for images and complex documents)
 */
async function extractWithAI(content: ArrayBuffer, mimeType: string, env: Env): Promise<string> {
  try {
    // For images, use vision model
    if (mimeType.startsWith('image/')) {
      const base64 = btoa(String.fromCharCode(...new Uint8Array(content)));
      
      const response = await env.AI.run('@cf/llava-hf/llava-1.5-7b-hf', {
        image: [...new Uint8Array(content)],
        prompt: 'Extract and transcribe all text visible in this image. Include any numbers, dates, names, and other details. If this is a receipt or invoice, list all line items with their amounts.',
        max_tokens: 2000,
      });
      
      return response.description || '[No text found in image]';
    }
    
    // For other documents, return a placeholder
    return `[Document type ${mimeType} - text extraction pending]`;
  } catch (error) {
    console.error('AI extraction error:', error);
    return `[Could not extract text from ${mimeType}]`;
  }
}

/**
 * Chunk text into overlapping segments
 */
function chunkText(
  text: string,
  targetTokens: number = 512,
  overlapTokens: number = 64
): Array<{ text: string; tokenCount: number }> {
  // Simple word-based chunking (approximate tokens)
  const words = text.split(/\s+/);
  const chunks: Array<{ text: string; tokenCount: number }> = [];
  
  // Approximate: 1 token ≈ 0.75 words
  const wordsPerChunk = Math.floor(targetTokens * 0.75);
  const overlapWords = Math.floor(overlapTokens * 0.75);
  
  let start = 0;
  while (start < words.length) {
    const end = Math.min(start + wordsPerChunk, words.length);
    const chunkWords = words.slice(start, end);
    const chunkText = chunkWords.join(' ');
    
    chunks.push({
      text: chunkText,
      tokenCount: Math.ceil(chunkWords.length / 0.75),
    });
    
    start = end - overlapWords;
    if (start >= words.length - overlapWords) {
      break;
    }
  }
  
  return chunks;
}

/**
 * Generate embedding for text via AI Gateway
 */
async function generateEmbedding(text: string, env: Env): Promise<number[]> {
  // Use Cloudflare AI for embeddings
  const result = await env.AI.run('@cf/baai/bge-base-en-v1.5', {
    text: [text],
  });
  
  return result.data[0];
}

/**
 * Auto-tag document using LLM
 */
async function autoTag(
  text: string,
  workspaceId: string,
  env: Env
): Promise<Array<{ name: string; category?: string; confidence: number }>> {
  // Get existing tags for this workspace
  const existingTags = await env.DB.prepare(
    'SELECT name, category FROM tags WHERE workspace_id = ? ORDER BY usage_count DESC LIMIT 50'
  ).bind(workspaceId).all<{ name: string; category: string }>();
  
  const existingTagNames = existingTags.results?.map(t => t.name) || [];
  
  // Use LLM to suggest tags
  const prompt = `Analyze this document and suggest appropriate tags.

Existing tags in this workspace: ${existingTagNames.join(', ') || 'none'}

Document text (first 2000 chars):
${text.substring(0, 2000)}

Return a JSON array of suggested tags. Each tag should have:
- name: the tag name (use existing tags when appropriate)
- category: one of "document_type", "vendor", "date", "amount", "person", "topic"
- confidence: a number from 0 to 1

Example response:
[
  {"name": "invoice", "category": "document_type", "confidence": 0.95},
  {"name": "Acme Corp", "category": "vendor", "confidence": 0.85}
]

Return ONLY the JSON array, no other text.`;

  const response = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
    messages: [
      { role: 'system', content: 'You are a document analysis assistant. Return only valid JSON.' },
      { role: 'user', content: prompt },
    ],
  });
  
  try {
    const tags = JSON.parse(response.response);
    return Array.isArray(tags) ? tags : [];
  } catch {
    console.error('Failed to parse LLM tag response');
    return [];
  }
}
