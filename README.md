# DocVault

**Intelligent Document Management Platform**

Upload, vectorize, auto-tag, search, and converse with your documents. Access via web portal, Claude Desktop, IDE, or any MCP-compatible client.

## Architecture

- **Frontend**: Adobe Edge Delivery Services (EDS)
- **Backend**: Cloudflare Workers
- **Storage**: Cloudflare R2 (files), D1 (metadata), Vectorize (embeddings)
- **AI**: Cloudflare AI Gateway for embeddings and LLM
- **Integration**: MCP Server for Claude Desktop, Cursor, and custom agents

## Features

- Drag-and-drop document upload (PDF, DOCX, XLSX, images, text)
- AI-powered auto-tagging with LLM
- Semantic search using vector embeddings
- RAG-powered chat with source citations
- MCP tools for programmatic access
- Role-based access control (Owner, Editor, Viewer)
- API keys for external integrations

## Prerequisites

1. Node.js 18+
2. [Cloudflare account](https://dash.cloudflare.com/sign-up) (free tier works)
3. [GitHub account](https://github.com)

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Set Up Cloudflare

Login to Cloudflare and run the setup script:

```bash
wrangler login
./scripts/setup-cloudflare.sh
```

This creates:
- D1 Database: `docvault-db`
- R2 Bucket: `docvault-files`
- Vectorize Index: `docvault-embeddings`
- Queue: `docvault-processing`

### 3. Configure Secrets

```bash
wrangler secret put JWT_SECRET
# Paste a random 32-character string when prompted
```

### 4. Start Development

**Frontend (EDS):**
```bash
npm run dev
# Opens http://localhost:3000
```

**Backend (Workers):**
```bash
npm run dev:workers
# API available at http://localhost:8787
```

### 5. Deploy

```bash
npm run deploy:workers
```

## Project Structure

```
doc-vault/
├── blocks/                     # EDS UI blocks
│   ├── cards/
│   ├── columns/
│   ├── footer/
│   ├── header/
│   └── hero/
├── scripts/                    # Frontend scripts
│   ├── aem.js                  # AEM core library (don't modify)
│   ├── scripts.js              # Main entry point
│   └── delayed.js              # Delayed loading
├── styles/                     # Global styles
├── workers/                    # Cloudflare Workers
│   ├── api/                    # REST API routes
│   │   └── routes/
│   │       ├── auth.ts         # Authentication
│   │       ├── documents.ts    # Document CRUD
│   │       ├── tags.ts         # Tag management
│   │       ├── search.ts       # Search endpoints
│   │       └── chat.ts         # RAG chat
│   ├── mcp/                    # MCP Server
│   │   └── index.ts            # SSE endpoint
│   ├── shared/                 # Shared utilities
│   │   ├── types.ts            # TypeScript types
│   │   └── utils.ts            # Helper functions
│   └── migrations/             # D1 schema
│       └── 0001_initial_schema.sql
├── .skills/                    # EDS AI skills
├── wrangler.toml               # Cloudflare config
└── AGENTS.md                   # AI agent instructions
```

## API Endpoints

### Authentication
- `POST /api/v1/auth/register` - Create account
- `POST /api/v1/auth/login` - Get JWT token
- `POST /api/v1/auth/keys` - Create API key
- `DELETE /api/v1/auth/keys/:id` - Revoke API key

### Documents
- `POST /api/v1/documents/upload` - Upload files
- `GET /api/v1/documents` - List documents
- `GET /api/v1/documents/:id` - Get document
- `DELETE /api/v1/documents/:id` - Delete document

### Search
- `POST /api/v1/search` - Faceted search
- `POST /api/v1/search/semantic` - Vector search
- `POST /api/v1/search/combined` - Combined search

### Chat
- `POST /api/v1/chat/sessions` - Create session
- `POST /api/v1/chat/sessions/:id/messages` - Send message (SSE)

## MCP Integration

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "docvault": {
      "type": "url",
      "url": "https://your-worker.workers.dev/mcp/sse",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}
```

### Available MCP Tools

- `docvault_upload` - Upload documents
- `docvault_list_documents` - List documents
- `docvault_get_document` - Get document details
- `docvault_search` - Semantic search
- `docvault_ask` - RAG query with citations
- `docvault_add_tags` / `docvault_remove_tags` - Tag management
- `docvault_delete_document` - Delete document

## Development Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start EDS dev server |
| `npm run dev:workers` | Start Workers dev server |
| `npm run lint` | Run linters |
| `npm run lint:fix` | Fix lint issues |
| `npm run db:migrate` | Run D1 migrations (remote) |
| `npm run db:migrate:local` | Run D1 migrations (local) |
| `npm run deploy:workers` | Deploy Workers to Cloudflare |

## EDS Block Development

See `.skills/` directory for EDS development skills:
- `content-driven-development` - Main development workflow
- `building-blocks` - Block creation guide
- `testing-blocks` - Testing procedures

## License

MIT
