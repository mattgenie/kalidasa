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
        articles: '{"source": "publication", "date": "YYYY-MM-DD"}',
        videos: '{"youtube_id": "VIDEO_ID", "channel": "channel name"}',
        events: '{"venue": "venue name", "date": "YYYY-MM-DD"}',
        general: '{"category": "category"}',
    };
    return specs[domain] || specs.general;
}

/**
 * Get enrichment hooks for domain
 */
function getDefaultHooks(domain: string): string[] {
    const hooks: Record<string, string[]> = {
        places: ['google_places'],
        movies: ['tmdb'],
        music: ['apple_music', 'musicbrainz'],
        articles: ['newsapi', 'wikipedia'],
        videos: ['youtube'],
        events: ['events_composite'],
        general: ['wikipedia'],
    };
    return hooks[domain] || hooks.general;
}

/**
 * Build Stage 1a prompt - fast, minimal output
 */
export function buildStage1aPrompt(
    request: KalidasaSearchRequest,
    maxCandidates: number
): string {
    const identifierSpec = getIdentifierSpec(request.query.domain);
    const defaultHooks = getDefaultHooks(request.query.domain);
    const excludesText = request.query.excludes?.length
        ? `\nEXCLUDE: ${request.query.excludes.join(', ')}`
        : '';

    // Domain-specific search hint guidance
    // For movies: don't include year in search_hint - it's passed separately via identifiers.year
    // For videos: search_hint not needed since we get youtube_id via grounded search
    let searchHintGuidance = '"search_hint": "search query for external API"';
    if (request.query.domain === 'places') {
        searchHintGuidance = '"search_hint": "venue name + neighborhood or street" (e.g., "Zillers Roof Garden Mitropoleos Syntagma") - MUST disambiguate from other nearby places. Only recommend places you are confident exist — each is verified via Google Places API.';
    } else if (request.query.domain === 'movies') {
        searchHintGuidance = '"search_hint": "exact movie title only" (e.g., "Amélie", "The 400 Blows") - no year, no extra words';
    } else if (request.query.domain === 'videos') {
        searchHintGuidance = '"search_hint": "video title" - the youtube_id in identifiers is required for verification';
    }

    // Videos domain needs special handling - grounded search for real YouTube video IDs
    if (request.query.domain === 'videos') {
        return `Find ${maxCandidates} YouTube videos for: "${request.query.text}"

CRITICAL: You MUST use web search to find REAL YouTube videos. Extract the video ID from the YouTube URL.
The video ID is the 11-character code after "v=" in youtube.com/watch?v=XXXXXXXXXXX

IMPORTANT: Diversify across facets - vary by creator, style, length, popularity, recency.

Return ONLY JSON array with REAL video IDs from your search results:
[
  {
    "name": "exact video title",
    "identifiers": {"youtube_id": "11-char video ID from URL", "channel": "channel name"},
    "search_hint": "video title",
    "enrichment_hooks": ["youtube"]
  }
]`;
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
    ${searchHintGuidance},
    "enrichment_hooks": ${JSON.stringify(defaultHooks)}
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

export function parseStage1aResponse(text: string): Stage1aCandidate[] {
    try {
        // Try direct parse
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) {
            return parsed.filter(c => c.name);
        }
        if (parsed.candidates && Array.isArray(parsed.candidates)) {
            return parsed.candidates.filter((c: any) => c.name);
        }
    } catch {
        // Try to extract from markdown
        const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (match) {
            try {
                const parsed = JSON.parse(match[1].trim());
                if (Array.isArray(parsed)) {
                    return parsed.filter(c => c.name);
                }
            } catch {
                // Fall through
            }
        }

        // Try to find array in text
        const arrayMatch = text.match(/\[[\s\S]*\]/);
        if (arrayMatch) {
            try {
                return JSON.parse(arrayMatch[0]).filter((c: any) => c.name);
            } catch {
                // Fall through
            }
        }
    }

    console.error('[Stage1a] Failed to parse response:', text.substring(0, 200));
    return [];
}
