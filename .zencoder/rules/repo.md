---
description: Repository Information Overview
alwaysApply: true
---

# Life Desk Bot Information

## Summary
Life Desk is an ultra-essential productivity Telegram bot with four core commands: `/note` for universal capture, `/todo` for task management, `/expense` for money tracking, and `/summary` for weekly overviews. It also features AI-powered smart reminders and natural language processing capabilities.

## Structure
- **src/**: Core application code including main entry point, webhook handler, and command implementations
- **public/**: Static assets and HTML files for the web interface
- **test/**: Test files for the application
- **.wrangler/**: Cloudflare Workers configuration and state
- **.zencoder/**: Project rules and configuration

## Language & Runtime
**Language**: TypeScript
**Version**: ES2021 target
**Build System**: Cloudflare Wrangler
**Package Manager**: npm

## Dependencies
**Main Dependencies**:
- hono: ^4.8.6 - Lightweight web framework for building web applications

**Development Dependencies**:
- typescript: ^5.5.2
- wrangler: ^4.26.0 - Cloudflare Workers CLI
- vitest: ~3.2.0 - Testing framework
- @cloudflare/vitest-pool-workers: ^0.8.19
- @cloudflare/workers-types: ^4.20250725.0

## Build & Installation
```bash
# Install dependencies
npm install

# Development mode
npm run dev

# Deploy to Cloudflare Workers
npm run deploy

# Run tests
npm test

# Generate TypeScript types for Cloudflare Workers
npm run cf-typegen
```

## Database
**Type**: Cloudflare D1 (SQLite)
**Schema**: Defined in schema.sql
**Tables**: users, notes, todos, expenses, user_input_states, reminders
**Management**:
```bash
# Query data
npx wrangler d1 execute life-desk-db --command="SELECT * FROM users LIMIT 10"

# Execute SQL file
npx wrangler d1 execute life-desk-db --file=your-file.sql
```

## Cloudflare Integration
**Workers**: Main application deployed as Cloudflare Worker
**D1 Database**: Persistent storage with `life-desk-db`
**AI Integration**: Uses Cloudflare AI for text and image processing
**Cron Triggers**: Scheduled tasks run every 5 minutes

## Testing
**Framework**: Vitest with Cloudflare Workers pool
**Test Location**: /test directory
**Configuration**: vitest.config.mts
**Run Command**:
```bash
npm test
```

## Features
**Core Commands**:
- `/note`: Universal capture for thoughts, ideas, reminders
- `/todo`: Task management with natural language date parsing
- `/expense`: Simple money tracking with amount and description
- `/summary`: Weekly overview of productivity and spending

**AI Capabilities**:
- Text AI: Natural language processing using Llama 3.1
- Image AI: Image analysis and description
- Smart Reminders: AI-powered reminders extracted from notes and todos