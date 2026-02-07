---
description: Critical rules for working on Kalidasa search engine codebase
---

# Kalidasa Development Rules

## Streaming Path is Critical

> ⚠️ **MANDATORY**: All changes to the Kalidasa search pipeline MUST work correctly for BOTH the batch path AND the streaming path. The streaming path is the most important one and cannot be ignored.

### Two Search Paths

Kalidasa has two search endpoints that share underlying logic but have separate handlers:

1. **Batch** (`POST /api/search`) → `search-handler.ts` → `TwoStageGenerator`
2. **Streaming** (`POST /api/search/stream`) → `streaming-handler.ts` → `StreamingCAOGenerator`

### Rules

- **Every feature** that touches search quality (enrichment, personalization, summaries, etc.) must be implemented in BOTH handlers
- **Always check** `streaming-handler.ts` when modifying `search-handler.ts` or vice versa
- **Test both paths** when verifying changes — a feature that only works on batch is incomplete
- **Prompt changes** should use shared prompt-building functions (e.g., from `stage-1c-prompt.ts`) rather than inline prompts, so both paths benefit from improvements
- When in doubt about which path the current consumer uses, check the client code — but assume BOTH paths must work
