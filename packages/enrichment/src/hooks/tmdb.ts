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

    constructor(lbBaseUrl?: string) {
        this.lbBaseUrl = lbBaseUrl || process.env.TMDB_LB_BASE_URL || 'http://54.147.132.243:8080';
    }

    async enrich(
        candidate: RawCAOCandidate,
        context: EnrichmentContext
    ): Promise<EnrichmentData | null> {
        const query = candidate.search_hint || candidate.name;
        const year = candidate.identifiers?.year;

        try {
            // Build TMDB search URL - DON'T encode the query here
            // URL.searchParams.set will encode the entire service_url once
            let tmdbUrl = `https://api.themoviedb.org/3/search/movie?query=${query.replace(/ /g, '+')}`;
            if (year) {
                tmdbUrl += `&year=${year}`;
            }

            // Use URL object - it will encode service_url properly
            const url = new URL(`${this.lbBaseUrl}/api/v1/load-balancer/proxy`);
            url.searchParams.set('service_url', tmdbUrl);
            url.searchParams.set('provider', 'tmdb');

            console.log(`[TMDBHook] URL: ${url.toString()}`);

            const response = await fetch(url);

            if (!response.ok) {
                console.warn(`[TMDBHook] API error for ${candidate.name}: ${response.status}`);
                return null;
            }

            const data = await response.json();
            // LB wraps: {success: true, data: {page, results: [...]}}
            const results = data.data?.results || data.results || [];
            console.log(`[TMDBHook] Response for ${candidate.name}: success=${data.success}, resultsCount=${results.length}`);

            const result = results[0];

            if (!result) {
                // Try multi-search as fallback
                const multiTmdbUrl = `https://api.themoviedb.org/3/search/multi?query=${query.replace(/ /g, '+')}`;
                const multiUrl = new URL(`${this.lbBaseUrl}/api/v1/load-balancer/proxy`);
                multiUrl.searchParams.set('service_url', multiTmdbUrl);
                multiUrl.searchParams.set('provider', 'tmdb');

                const multiResponse = await fetch(multiUrl);

                if (multiResponse.ok) {
                    const multiData = await multiResponse.json();
                    const multiResults = multiData.data?.results || multiData.results || [];
                    if (multiResults[0]) {
                        return this.formatResult(multiResults[0]);
                    }
                }
                return null;
            }

            return this.formatResult(result);
        } catch (error) {
            console.error('[TMDBHook] Error:', error);
            return null;
        }
    }

    private formatResult(result: any): EnrichmentData {
        return {
            verified: true,
            source: 'tmdb',
            canonical: {
                type: 'tmdb_id',
                value: String(result.id),
            },
            movies: {
                rating: result.vote_average,
                year: (result.release_date || result.first_air_date)?.substring(0, 4),
                genres: result.genre_ids?.map((id: number) => String(id)),
                posterUrl: result.poster_path
                    ? `https://image.tmdb.org/t/p/w500${result.poster_path}`
                    : undefined,
                backdropUrl: result.backdrop_path
                    ? `https://image.tmdb.org/t/p/w1280${result.backdrop_path}`
                    : undefined,
                overview: result.overview,
            },
        };
    }

    async healthCheck(): Promise<boolean> {
        try {
            const testTmdbUrl = 'https://api.themoviedb.org/3/search/movie?query=test';
            const url = new URL(`${this.lbBaseUrl}/api/v1/load-balancer/proxy`);
            url.searchParams.set('service_url', testTmdbUrl);
            url.searchParams.set('provider', 'tmdb');
            const response = await fetch(url);
            return response.ok;
        } catch {
            return false;
        }
    }
}
