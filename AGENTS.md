# AGENTS.md

## DocVault - Intelligent Document Management Platform

DocVault is an AI-powered document management platform that allows users to upload, store, auto-tag, search, and converse with their documents. It runs on:

- **Frontend**: Adobe Edge Delivery Services (this project)
- **Backend**: Cloudflare Workers with R2 (storage), D1 (metadata), Vectorize (embeddings)
- **AI**: Cloudflare AI Gateway for LLM-powered auto-tagging and RAG chat
- **MCP Server**: Full API exposed via SSE for Claude Desktop, IDEs, and agents

### Project Structure

```
doc-vault/
├── .skills/                    # EDS AI skills (from adobe/helix-website)
├── blocks/                     # EDS blocks (UI components)
│   ├── upload/                 # Drag-and-drop file upload
│   ├── tag-editor/             # AI-suggested tag editing
│   ├── document-list/          # Grid/list view of documents
│   ├── search/                 # Faceted + semantic search
│   ├── chat/                   # RAG chat interface
│   └── document-viewer/        # PDF/image/text viewer
├── styles/
├── scripts/
├── workers/                    # Cloudflare Workers (backend)
│   ├── api/                    # REST API routes
│   ├── mcp/                    # MCP SSE server
│   ├── processing/             # Document processing pipeline
│   └── shared/                 # Shared utilities
├── wrangler.toml               # Cloudflare configuration
└── AGENTS.md                   # This file
```

### Backend API Endpoints

The frontend communicates with Cloudflare Workers at the configured API base URL:

```
/api/v1/auth/*           - Authentication (register, login, API keys)
/api/v1/documents/*      - Document CRUD and upload
/api/v1/tags/*           - Tag management
/api/v1/search/*         - Faceted and semantic search
/api/v1/chat/*           - RAG chat sessions
/mcp/sse                 - MCP Server (SSE endpoint)
```

### Key Blocks to Build

1. **upload-block**: Drag-and-drop with progress, multi-file support
2. **auth-block**: Login/register forms, OAuth buttons
3. **api-keys-block**: Create/revoke API keys for MCP access
4. **tag-review-block**: AI-suggested tags with accept/edit/add
5. **document-list-block**: Grid/list toggle, status indicators
6. **search-block**: Faceted filters sidebar + semantic search
7. **document-viewer-block**: PDF.js renderer, image viewer, text display
8. **chat-block**: Streaming responses, sources panel, session history

### Development Commands

- Start local dev: `aem up` or `npx @adobe/aem-cli up`
- Run linting: `npm run lint`
- Fix lint issues: `npm run lint:fix`

<!-- upskill:skills:start -->
## Skills

You have access to a set of skills in `.skills/`. Each skill consists of a SKILL.md file, and other files such as scripts and resources, which are referenced from there.

**YOU ARE REQUIRED TO USE THESE SKILLS TO ACCOMPLISH DEVELOPMENT TASKS. FAILING TO DO SO WILL RESULT IN WASTED TIME AND CYCLES.**

### How Skills Work

Each skill is a directory in `.skills/` with the following structure:

```
.skills/
  └── {skill-name}/
      ├── SKILL.md        # Main instructions (required)
      ├── scripts/        # Optional supporting scripts
      └── resources/      # Optional resources (examples, templates, etc.)
```

The SKILL.md file contains detailed instructions that you must follow exactly as written. Skills are designed to:
- Provide specialized workflows for common tasks
- Ensure consistency with project standards and best practices
- Reduce errors by codifying expert knowledge
- Chain together when tasks require multiple skill applications

### Skill Discovery and Execution Process

Always use the following process:

1. **Discovery**: When a new conversation starts, discover available skills by running `./.agents/discover-skills`. This script will show you all available skills with their names, paths, and descriptions without loading everything into context.

2. **Selection**: Use each skill based on its name and description when it feels appropriate to do so. Think carefully about all the skills available to you and choose the best ones to use. Note that some skills may reference other skills, so you may need to apply more than one skill to get things done.

3. **Execution**: When you need to use a skill:
   - Read the full SKILL.md file
   - Announce you are doing so by saying "Using Skill: {Skill Name}"
   - Follow the skill's instructions exactly as written
   - Read any referenced resources or scripts as needed
   - Complete all steps in the skill before moving to the next task

### Available Skills

Skills are located in `.skills/` directory. Run `./.agents/discover-skills` for the current list of available skills.

**For ALL development work involving blocks, core scripts, or functionality, you MUST start with the content-driven-development skill.** It will orchestrate other skills as needed throughout the development workflow.
<!-- upskill:skills:end -->
