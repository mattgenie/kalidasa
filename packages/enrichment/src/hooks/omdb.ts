/**
 * OMDb Hook
 * 
 * Uses OMDb API for movie/TV data (alternative to TMDB).
 */

import type {
    EnrichmentHook,
    RawCAOCandidate,
    EnrichmentContext,
    EnrichmentData,
    EnrichmentDomain
} from '@kalidasa/types';

export class OMDbHook implements EnrichmentHook {
    name = 'omdb';
    domains: EnrichmentDomain[] = ['movies'];
    priority = 80;

    private apiKey: string;
    private baseUrl = 'https://www.omdbapi.com/';

    constructor(apiKey?: string) {
        this.apiKey = apiKey || process.env.OMDB_API_KEY || '';
    }

    async enrich(
        candidate: RawCAOCandidate,
        context: EnrichmentContext
    ): Promise<EnrichmentData | null> {
        if (!this.apiKey) {
            console.warn('[OMDbHook] No API key configured');
            return null;
        }

        const title = candidate.search_hint || candidate.name;

        try {
            const url = `${this.baseUrl}?t=${encodeURIComponent(title)}&apikey=${this.apiKey}`;
            const response = await fetch(url);

            if (!response.ok) {
                console.warn(`[OMDbHook] API error: ${response.status}`);
                return null;
            }

            const data = await response.json();

            if (data.Response === 'False') {
                return null;
            }

            return {
                verified: true,
                source: 'omdb',
                canonical: {
                    type: 'imdb_id',
                    value: data.imdbID,
                },
                movies: {
                    rating: parseFloat(data.imdbRating) || undefined,
                    year: data.Year,
                    runtime: parseInt(data.Runtime) || undefined,
                    genres: data.Genre?.split(', '),
                    posterUrl: data.Poster !== 'N/A' ? data.Poster : undefined,
                    overview: data.Plot,
                    director: data.Director,
                    cast: data.Actors?.split(', ').map((name: string) => ({
                        name,
                        character: '',
                    })),
                },
            };
        } catch (error) {
            console.error('[OMDbHook] Error:', error);
            return null;
        }
    }

    async healthCheck(): Promise<boolean> {
        try {
            const response = await fetch(`${this.baseUrl}?t=test&apikey=${this.apiKey}`);
            return response.ok;
        } catch {
            return false;
        }
    }
}
