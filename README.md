# Kalidasa

LLM-first search service using Gemini with native grounding and parallel enrichment hooks.

## Architecture

```
Query → Gemini Grounded Search (15-20 candidates) → Parallel Enrichment → Verified CAO
```

## Quick Start

```bash
# Install dependencies
pnpm install

# Development
pnpm dev

# Build
pnpm build

# Test
pnpm test
```

## Structure

```
kalidasa/
├── apps/
│   └── search-api/          # REST API service
├── packages/
│   ├── types/               # Shared TypeScript types
│   ├── cao-generator/       # Gemini CAO generation
│   ├── facet-libraries/     # Domain-specific facets
│   ├── enrichment/          # Enrichment hook execution
│   └── merger/              # Result merging & synthesis
```

## API

```bash
POST /api/search
```

See `packages/types/src/api.ts` for full request/response schemas.
