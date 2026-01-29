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
POST /api/search/stream  # SSE streaming endpoint
```

See `packages/types/src/api.ts` for full request/response schemas.

## Deployment

### Local Docker

```bash
# Build the image
docker build -t kalidasa .

# Run locally (requires .env file with API keys)
docker run -p 3200:3200 --env-file .env kalidasa

# Test
curl http://localhost:3200/health
```

### AWS App Runner

Prerequisites:
- AWS CLI configured (`aws configure`)
- IAM role `AppRunnerECRAccessRole` with ECR access

```bash
# First-time setup (creates ECR repo + App Runner service)
./deploy.sh --create

# Subsequent deployments
./deploy.sh

# Build and push only (no deploy)
./deploy.sh --build-only
```

Autoscaling configuration (defaults):
- `min_size`: 1 (always-warm instance)
- `max_size`: 10 (cost ceiling)
- `max_concurrency`: 80 requests per instance

Environment variables are read from `.env` and passed to App Runner.

