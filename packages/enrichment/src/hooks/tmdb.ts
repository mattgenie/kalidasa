/**
 * TMDB Hook (via Load Balancer)
 * 
 * Uses TMDB API through the load balancer for movie/TV data.
 */

import type {
    EnrichmentHook,
    RawCAOCandidate,
    EnrichmentContext,
    EnrichmentData,
    EnrichmentDomain
} from '@kalidasa/types';

export class TMDBHook implements EnrichmentHook {
    name = 'tmdb';
    domains: EnrichmentDomain[] = ['movies'];
    priority = 100;

    private lbBaseUrl: string;
    private tmdbUrl = 'https://api.themoviedb.org/3/search/multi';

    constructor(lbBaseUrl?: string) {
        this.lbBaseUrl = lbBaseUrl || process.env.TMDB_LB_BASE_URL || 'http://54.147.132.243:8080';
    }

    async enrich(
        candidate: RawCAOCandidate,
        context: EnrichmentContext
    ): Promise<EnrichmentData | null> {
        const query = candidate.search_hint || candidate.name;

        try {
            const serviceUrl = encodeURIComponent(`${this.tmdbUrl}?query=${encodeURIComponent(query)}`);
            const url = `${this.lbBaseUrl}/api/v1/load-balancer/proxy?service_url=${serviceUrl}&provider=tmdb`;

            const response = await fetch(url);

            if (!response.ok) {
                console.warn(`[TMDBHook] API error: ${response.status}`);
                return null;
            }

            const data = await response.json();
            const result = data.results?.[0];

            if (!result) {
                return null;
            }

            return {
                verified: true,
                source: 'tmdb',
                canonical: {
                    type: 'tmdb_id',
                    value: String(result.id),
                },
                movies: {
                    rating: result.vote_average,
                    year: result.release_date?.substring(0, 4) || result.first_air_date?.substring(0, 4),
                    genres: result.genre_ids,
                    posterUrl: result.poster_path
                        ? `https://image.tmdb.org/t/p/w500${result.poster_path}`
                        : undefined,
                    backdropUrl: result.backdrop_path
                        ? `https://image.tmdb.org/t/p/w1280${result.backdrop_path}`
                        : undefined,
                    overview: result.overview,
                },
            };
        } catch (error) {
            console.error('[TMDBHook] Error:', error);
            return null;
        }
    }

    async healthCheck(): Promise<boolean> {
        try {
            const serviceUrl = encodeURIComponent(`${this.tmdbUrl}?query=test`);
            const url = `${this.lbBaseUrl}/api/v1/load-balancer/proxy?service_url=${serviceUrl}&provider=tmdb`;
            const response = await fetch(url);
            return response.ok;
        } catch {
            return false;
        }
    }
}
