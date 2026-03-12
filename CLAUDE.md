# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

PanHub is a Nuxt.js 4 web application that aggregates search results from Telegram channels and various plugins to find cloud storage resources (Aliyun, Quark, Baidu, 115, Xunlei, etc.). The application supports priority-based batch processing, LRU caching, JSON file hot search persistence (with memory fallback), and can be deployed to Vercel, Cloudflare Workers, or Docker.

## Package Manager

This project uses `pnpm` (lockfile: `pnpm-lock.yaml`). Always use `pnpm install` for dependency management.

## Development Commands

```bash
pnpm dev                # Start development server
pnpm build              # Build for production
pnpm preview            # Preview production build locally
pnpm generate           # Generate static output
pnpm test               # Run all unit tests (Vitest)
pnpm test:watch         # Run tests in watch mode
pnpm test:coverage      # Generate coverage reports
pnpm test:api           # Run API integration tests
pnpm deploy:cf          # Deploy to Cloudflare Workers
```

## High-Level Architecture

### Search Flow

The search system uses a two-tier architecture:

1. **Client-side (`composables/useSearch.ts`)**: Manages search state, batching, pause/continue functionality, and fast/deep search phases
2. **Server-side (`server/core/services/searchService.ts`)**: Coordinates concurrent searches across Telegram channels and plugins with priority-based batching

**Fast Search**: First batch of priority TG channels and plugins return immediately (~50ms)
**Deep Search**: Remaining channels/plugins continue loading in batches

### Server-Side Core (`server/core/`)

- **`services/searchService.ts`**: Main search orchestrator with priority batching, caching, timeout control
- **`services/tg.ts`**: Telegram channel post fetching with Cheerio parsing
- **`services/jsonFileHotSearchStore.ts`**: Hot search persistence (JSON file with memory fallback)
- **`cache/memoryCache.ts`**: LRU cache with memory monitoring, TTL-based expiration, smart cleanup
- **`plugins/manager.ts`**: Plugin registry and lifecycle management
- **`plugins/*.ts`**: Individual search plugins (pansearch, qupansou, panta, etc.)
- **`utils/fetch.ts`**: Network request wrapper with retry and timeout
- **`types/models.ts`**: Core TypeScript interfaces (SearchResult, MergedLinks, etc.)

### Configuration (`config/`)

- **`channels.json`**: TG channel lists (priorityChannels, defaultChannels), concurrency settings, timeouts
- **`plugins.ts`**: Plugin names, platform info (aliyun, quark, baidu, 115, xunlei), default user settings

### Deployment-Specific Behavior

- **Vercel/Cloudflare Workers**: Memory-only mode for hot searches (no persistent filesystem)
- **Docker/Local**: JSON file persistence at `./data/hot-searches.json`
- **Nitro preset**: Auto-detected via `NITRO_PRESET` env var or platform detection

## TypeScript & Vue Conventions

- **Vue composables**: Prefixed with `use` (e.g., `useSearch.ts`, `useSettings.ts`)
- **Server routes**: Named `name.get.ts` or `name.post.ts` under `server/api/`
- **Unit tests**: Located in `test/unit/` with `*.test.ts` suffix
- **Indentation**: 2 spaces, semicolons, double quotes

## Testing

- Framework: Vitest with Node environment, globals enabled
- Coverage provider: V8 (`text`, `json`, `html` reporters)
- Test files: `test/unit/*.test.ts` for core services, `test/*.mjs` for API/integration tests
- Run `pnpm test` before committing changes to `server/core/`

## Important Constraints

- **Hot search storage**: JSON file (Docker/local) or memory (Vercel/CF Workers)
- **Cloudflare Workers**: No persistent filesystem, hot searches fall back to memory mode
- **Cache keys**: Format `tg:${keyword}:${channels}` or `plugin:${keyword}:${plugins}`
- **Concurrency**: Priority channels use 2x concurrency vs normal channels

## Environment Variables

- `LOG_LEVEL`: Logging level (default: `info`)
- `NITRO_PRESET`: Deployment preset (auto-detect if unset)
- `PORT`: Server port (default: `3000`)
- `VERCEL`: Auto-detected for Vercel deployment
