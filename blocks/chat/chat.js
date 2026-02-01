/**
 * Chat Block
 * RAG-powered chat with document sources
 */

import {
  isAuthenticated,
  createChatSession,
  sendChatMessage,
} from '../../scripts/api.js';

export default async function decorate(block) {
  if (!isAuthenticated()) {
    block.innerHTML = `
      <div class="chat-auth-required">
        <p>Please <a href="/login">sign in</a> to chat with your documents.</p>
      </div>
    `;
    return;
  }

  // State
  let currentSessionId = null;
  let isStreaming = false;

  block.innerHTML = `
    <div class="chat-container">
      <aside class="chat-sidebar">
        <div class="sidebar-header">
          <h3>Chat History</h3>
          <button class="new-chat-btn" type="button">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            New Chat
          </button>
        </div>
        <div class="session-list">
          <p class="no-sessions">No chat history yet</p>
        </div>
      </aside>
      
      <main class="chat-main">
        <div class="chat-messages">
          <div class="chat-welcome">
            <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            <h2>Ask about your documents</h2>
            <p>I can search through your documents and answer questions with citations.</p>
            <div class="example-prompts">
              <button class="example-prompt" type="button">How much did I spend last year?</button>
              <button class="example-prompt" type="button">What contracts expire this month?</button>
              <button class="example-prompt" type="button">Summarize my invoices from Acme Corp</button>
            </div>
          </div>
        </div>
        
        <form class="chat-input-form">
          <div class="chat-input-wrapper">
            <textarea 
              class="chat-input" 
              placeholder="Ask a question about your documents..." 
              rows="1"
            ></textarea>
            <button class="chat-send-btn" type="submit" disabled>
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
            </button>
          </div>
          <p class="chat-disclaimer">Answers are based on your documents. Always verify important information.</p>
        </form>
      </main>
      
      <aside class="sources-panel" hidden>
        <div class="sources-header">
          <h4>Sources</h4>
          <button class="close-sources-btn" type="button">&times;</button>
        </div>
        <div class="sources-list"></div>
      </aside>
    </div>
  `;

  const messagesContainer = block.querySelector('.chat-messages');
  const inputForm = block.querySelector('.chat-input-form');
  const inputTextarea = block.querySelector('.chat-input');
  const sendBtn = block.querySelector('.chat-send-btn');
  const newChatBtn = block.querySelector('.new-chat-btn');
  const sourcesPanel = block.querySelector('.sources-panel');
  const sourcesList = block.querySelector('.sources-list');
  const closeSourcesBtn = block.querySelector('.close-sources-btn');

  // Auto-resize textarea
  inputTextarea.addEventListener('input', () => {
    inputTextarea.style.height = 'auto';
    inputTextarea.style.height = `${Math.min(inputTextarea.scrollHeight, 200)}px`;
    sendBtn.disabled = !inputTextarea.value.trim() || isStreaming;
  });

  // Handle form submit
  inputForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const message = inputTextarea.value.trim();
    if (!message || isStreaming) return;

    await sendMessage(message);
  });

  // Handle enter key (shift+enter for newline)
  inputTextarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      inputForm.dispatchEvent(new Event('submit'));
    }
  });

  // New chat button
  newChatBtn.addEventListener('click', () => {
    currentSessionId = null;
    messagesContainer.innerHTML = `
      <div class="chat-welcome">
        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        <h2>Ask about your documents</h2>
        <p>I can search through your documents and answer questions with citations.</p>
      </div>
    `;
    sourcesPanel.hidden = true;
  });

  // Example prompts
  block.querySelectorAll('.example-prompt').forEach((btn) => {
    btn.addEventListener('click', () => {
      inputTextarea.value = btn.textContent;
      inputTextarea.dispatchEvent(new Event('input'));
      inputForm.dispatchEvent(new Event('submit'));
    });
  });

  // Close sources panel
  closeSourcesBtn.addEventListener('click', () => {
    sourcesPanel.hidden = true;
  });

  async function sendMessage(message) {
    isStreaming = true;
    sendBtn.disabled = true;

    // Clear welcome message
    const welcome = messagesContainer.querySelector('.chat-welcome');
    if (welcome) welcome.remove();

    // Add user message
    addMessage('user', message);
    inputTextarea.value = '';
    inputTextarea.style.height = 'auto';

    // Create session if needed
    if (!currentSessionId) {
      try {
        const session = await createChatSession();
        currentSessionId = session.id;
      } catch (error) {
        addMessage('error', `Failed to create chat session: ${error.message}`);
        isStreaming = false;
        sendBtn.disabled = false;
        return;
      }
    }

    // Add assistant message placeholder
    const assistantMessage = addMessage('assistant', '', true);
    const contentEl = assistantMessage.querySelector('.message-content');

    try {
      const response = await sendChatMessage(currentSessionId, message);

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Request failed');
      }

      // Check if streaming
      const contentType = response.headers.get('Content-Type') || '';

      if (contentType.includes('text/event-stream')) {
        // Handle SSE streaming
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let sources = [];

        let done = false;
        while (!done) {
          // eslint-disable-next-line no-await-in-loop
          const result = await reader.read();
          done = result.done;
          if (done) break;
          const { value } = result;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));

                if (data.type === 'content') {
                  contentEl.textContent += data.text;
                  scrollToBottom();
                } else if (data.type === 'sources') {
                  sources = data.sources || [];
                } else if (data.type === 'done') {
                  assistantMessage.classList.remove('streaming');
                  if (sources.length > 0) {
                    addSourcesButton(assistantMessage, sources);
                  }
                } else if (data.type === 'error') {
                  throw new Error(data.message);
                }
              } catch (parseError) {
                // Ignore parse errors for malformed events
              }
            }
          }
        }
      } else {
        // Handle non-streaming response
        const data = await response.json();
        contentEl.textContent = data.message.content;
        assistantMessage.classList.remove('streaming');

        if (data.sources && data.sources.length > 0) {
          addSourcesButton(assistantMessage, data.sources);
        }
      }
    } catch (error) {
      contentEl.textContent = `Error: ${error.message}`;
      assistantMessage.classList.add('error');
      assistantMessage.classList.remove('streaming');
    } finally {
      isStreaming = false;
      sendBtn.disabled = !inputTextarea.value.trim();
      scrollToBottom();
    }
  }

  function addMessage(role, content, streaming = false) {
    const messageEl = document.createElement('div');
    messageEl.className = `chat-message ${role}${streaming ? ' streaming' : ''}`;
    messageEl.innerHTML = `
      <div class="message-avatar">
        ${role === 'user' ? getUserAvatar() : getAssistantAvatar()}
      </div>
      <div class="message-body">
        <div class="message-content">${escapeHtml(content)}</div>
      </div>
    `;

    messagesContainer.appendChild(messageEl);
    scrollToBottom();

    return messageEl;
  }

  function addSourcesButton(messageEl, sources) {
    const sourcesBtn = document.createElement('button');
    sourcesBtn.className = 'view-sources-btn';
    sourcesBtn.type = 'button';
    sourcesBtn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
      ${sources.length} source${sources.length !== 1 ? 's' : ''}
    `;

    sourcesBtn.addEventListener('click', () => {
      showSources(sources);
    });

    messageEl.querySelector('.message-body').appendChild(sourcesBtn);
  }

  function showSources(sources) {
    sourcesList.innerHTML = sources.map((source) => `
      <a class="source-item" href="/document?id=${source.document_id}">
        <div class="source-title">${escapeHtml(source.document_title)}</div>
        <div class="source-snippet">${escapeHtml(source.text_snippet.substring(0, 150))}...</div>
        ${source.relevance_score ? `<div class="source-score">${Math.round(source.relevance_score * 100)}% match</div>` : ''}
      </a>
    `).join('');

    sourcesPanel.hidden = false;
  }

  function scrollToBottom() {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  function getUserAvatar() {
    return '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
  }

  function getAssistantAvatar() {
    return '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a10 10 0 1 0 10 10H12V2z"/><circle cx="12" cy="12" r="4"/></svg>';
  }

  function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
