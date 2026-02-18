/**
 * Stage 1a Prompt: Fast Candidate Names
 * 
 * Generates minimal candidate list with identifiers only.
 * No personalization, no reasoning - just names + unique IDs.
 */

import type { KalidasaSearchRequest } from '@kalidasa/types';

/**
 * Get domain-specific identifier requirements
 */
function getIdentifierSpec(domain: string): string {
    const specs: Record<string, string> = {
        places: '{"address": "street address if known", "neighborhood": "district or area", "city": "city name"}',
        movies: '{"year": 2024, "director": "director name"}',
        music: '{"artist": "artist name", "album": "album name"}',
        books: '{"author": "author name", "publisher": "publisher", "year": 2024}',
        articles: '{"author": "author name", "source": "publication", "topic": "subject area"}',
        news: '{"source": "outlet name", "date": "YYYY-MM-DD", "author": "author name"}',
        events: '{"venue": "venue name", "date": "YYYY-MM-DD"}',
    };
    return specs[domain] || specs.places;
}

/**
 * Get enrichment hooks for domain
 */
function getDefaultHooks(domain: string): string[] {
    const hooks: Record<string, string[]> = {
        places: ['google_places'],
        movies: ['tmdb'],
        music: ['apple_music', 'musicbrainz'],
        books: ['books_composite'],
        articles: ['exa', 'serpapi_articles', 'articles_composite'],
        news: ['newsapi'],
        events: ['events_composite'],
    };
    return hooks[domain] || hooks.places;
}

/**
 * Build Stage 1a prompt - fast, minimal output
 */
export function buildStage1aPrompt(
    request: KalidasaSearchRequest,
    maxCandidates: number
): string {
    const identifierSpec = getIdentifierSpec(request.query.domain);
    // Note: enrichment_hooks are assigned mechanistically in parseStage1aResponse, not by the LLM
    const excludesText = request.query.excludes?.length
        ? `\nEXCLUDE: ${request.query.excludes.join(', ')}`
        : '';

    // Domain-specific search hint guidance
    // For movies: don't include year in search_hint - it's passed separately via identifiers.year
    // Domain-specific search hint guidance
    let searchHintGuidance = '"search_hint": "search query for external API"';
    if (request.query.domain === 'places') {
        searchHintGuidance = '"search_hint": "venue name + neighborhood or street" (e.g., "Zillers Roof Garden Mitropoleos Syntagma") - MUST disambiguate from other nearby places. Only recommend places you are confident exist — each is verified via Google Places API.';
    } else if (request.query.domain === 'movies') {
        searchHintGuidance = '"search_hint": "exact movie title only" (e.g., "Amélie", "The 400 Blows") - no year, no extra words';
    }

    return `Find ${maxCandidates} recommendations for: "${request.query.text}"
Domain: ${request.query.domain}${excludesText}
Location: ${request.logistics.searchLocation?.city || 'any'}

IMPORTANT: Diversify across facets - vary by style, price, vibe, era, subgenre, etc. Avoid clustering similar options.

Return ONLY JSON array - no explanation:
[
  {
    "name": "exact name",
    "identifiers": ${identifierSpec},
    ${searchHintGuidance}
  }
]`;
}

/**
 * Parse Stage 1a response
 */
export interface Stage1aCandidate {
    name: string;
    identifiers: Record<string, string | number>;
    search_hint?: string;
    enrichment_hooks: string[];
}

export function parseStage1aResponse(text: string, domain?: string): Stage1aCandidate[] {
    // Assign enrichment hooks mechanistically based on domain
    const hooks = domain ? getDefaultHooks(domain) : ['wikipedia'];

    function assignHooks(candidates: any[]): Stage1aCandidate[] {
        return candidates
            .filter(c => c.name)
            .map(c => ({
                ...c,
                enrichment_hooks: hooks,
            }));
    }

    try {
        // Try direct parse
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) {
            return assignHooks(parsed);
        }
        if (parsed.candidates && Array.isArray(parsed.candidates)) {
            return assignHooks(parsed.candidates);
        }
    } catch {
        // Try to extract from markdown
        const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (match) {
            try {
                const parsed = JSON.parse(match[1].trim());
                if (Array.isArray(parsed)) {
                    return assignHooks(parsed);
                }
            } catch {
                // Fall through
            }
        }

        // Try to find array in text
        const arrayMatch = text.match(/\[[\s\S]*\]/);
        if (arrayMatch) {
            try {
                return assignHooks(JSON.parse(arrayMatch[0]));
            } catch {
                // Fall through
            }
        }
    }

    console.error('[Stage1a] Failed to parse response:', text.substring(0, 200));
    return [];
}
