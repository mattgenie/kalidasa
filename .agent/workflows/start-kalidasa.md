---
description: How to start the Kalidasa search API locally (MANDATORY reading before starting/restarting the server)
---

# Starting the Kalidasa Search API

// turbo-all

## Prerequisites

1. Ensure you are in the kalidasa root directory:
```
cd /Users/matt/Downloads/kalidasa
```

2. Verify `.env` exists and has real API keys (not placeholders):
```bash
grep -c '=' /Users/matt/Downloads/kalidasa/.env
# Should show ~20+ lines
grep 'your-' /Users/matt/Downloads/kalidasa/.env
# Should show NOTHING — any "your-*" placeholder means a key is missing
```

3. Also verify `apps/search-api/.env` exists — this is the primary `.env` used by dotenv:
```bash
grep -c '=' /Users/matt/Downloads/kalidasa/apps/search-api/.env
```

## Starting the Server

4. Build the project:
```bash
cd /Users/matt/Downloads/kalidasa && npx turbo build
```

5. Start the server (MUST run from the search-api directory so dotenv finds `.env`):
```bash
cd /Users/matt/Downloads/kalidasa/apps/search-api && node dist/index.js
```

6. The server will print an ENV VALIDATION banner on startup. If any keys are missing, it will refuse to start and print exactly which keys are missing. **Do not skip or ignore this banner.**

## Verifying the Server

7. Check health:
```bash
curl -s http://localhost:3200/health
```

8. Run a quick smoke test across domains:
```bash
# Places
curl -s http://localhost:3200/api/search -H 'Content-Type: application/json' \
  -d '{"query":{"text":"best pizza","domain":"places"},"capsule":{"mode":"solo","members":[{"id":"u1","name":"Test","preferences":{}}]},"logistics":{"searchLocation":{"city":"New York"}},"maxResults":2}' | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'Places: {len(d.get(\"results\",[]))} results')"

# Events
curl -s http://localhost:3200/api/search -H 'Content-Type: application/json' \
  -d '{"query":{"text":"concerts this week","domain":"events"},"capsule":{"mode":"solo","members":[{"id":"u1","name":"Test","preferences":{}}]},"logistics":{"searchLocation":{"city":"Austin"}},"maxResults":2}' | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'Events: {len(d.get(\"results\",[]))} results')"
```

If any domain returns 0 results, check the server logs for enrichment warnings.

## CRITICAL RULES

- **NEVER** create a new `.env` file or overwrite the existing one. The keys are already there.
- **NEVER** start the server without checking the ENV VALIDATION banner output.
- **NEVER** hardcode or hallucinate API keys. If a key needs to be added, ask the user.
- If the server exits on startup with "ENV VALIDATION FAILED", read the error and fix the `.env` — do not bypass the check.
