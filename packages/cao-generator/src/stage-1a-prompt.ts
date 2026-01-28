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
        places: '{"address": "street address", "city": "city name"}',
        movies: '{"year": 2024, "director": "director name"}',
        music: '{"artist": "artist name", "album": "album name"}',
        articles: '{"source": "publication", "date": "YYYY-MM-DD"}',
        videos: '{"channel": "channel name", "platform": "youtube/vimeo"}',
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
        events: ['ticketmaster', 'eventbrite'],
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

    return `Find ${maxCandidates} recommendations for: "${request.query.text}"
Domain: ${request.query.domain}${excludesText}
Location: ${request.logistics.searchLocation?.city || 'any'}

Return ONLY JSON array - no explanation:
[
  {
    "name": "exact name",
    "identifiers": ${identifierSpec},
    "search_hint": "search query for external API",
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
