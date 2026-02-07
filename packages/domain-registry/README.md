# @kalidasa/domain-registry

Centralized domain definitions for Kalidasa search.

## Usage

```typescript
import { 
    detectDomainFromQuery,
    getDomain,
    getEnrichmentHooks,
    isKnownDomain
} from '@kalidasa/domain-registry';

// Detect domain from user query
const domain = detectDomainFromQuery('find me a good restaurant');
// → 'places'

// Get domain configuration
const def = getDomain('places');
// → { name: 'places', enrichmentHooks: ['google_places', 'yelp'], ... }

// Get specific configuration
const hooks = getEnrichmentHooks('movies');
// → ['tmdb', 'omdb']

// Validate domain
if (!isKnownDomain(userDomain)) {
    console.warn(`Unknown domain: ${userDomain}`);
}
```

## Adding a New Domain

1. Edit `src/registry.ts`
2. Add new domain definition:

```typescript
podcasts: {
    name: 'podcasts',
    displayName: 'Podcasts & Shows',
    enrichmentHooks: ['spotify_podcasts', 'apple_podcasts'],
    identifierSpec: { host: '...', show: '...' },
    temporalityDefault: 'evergreen',
    itemRenderer: 'podcast_card',
    exclusionCategories: ['topics', 'hosts', 'length'],
    detectionKeywords: ['podcast', 'episode', 'listen', 'host'],
},
```

3. Bump version in `package.json`
4. Publish

Chat Agent will automatically support the new domain on next deploy.
