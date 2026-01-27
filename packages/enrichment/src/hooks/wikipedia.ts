/**
 * Wikipedia Hook
 * 
 * Uses Wikipedia REST API for general knowledge/authority data.
 * Implements aggressive caching as recommended.
 */

import type {
    EnrichmentHook,
    RawCAOCandidate,
    EnrichmentContext,
    EnrichmentData,
    EnrichmentDomain
} from '@kalidasa/types';

export class WikipediaHook implements EnrichmentHook {
    name = 'wikipedia';
    domains: EnrichmentDomain[] = ['general', 'articles'];
    priority = 100;

    private baseUrl = 'https://en.wikipedia.org/api/rest_v1';
    private userAgent = 'Kalidasa/1.0 (kalidasa@example.com)';

    // In-memory cache
    private cache = new Map<string, { data: EnrichmentData; timestamp: number }>();
    private cacheTTL = 24 * 60 * 60 * 1000; // 24 hours

    async enrich(
        candidate: RawCAOCandidate,
        context: EnrichmentContext
    ): Promise<EnrichmentData | null> {
        const title = candidate.search_hint || candidate.name;
        const cacheKey = title.toLowerCase().trim();

        // Check cache first
        const cached = this.cache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
            return cached.data;
        }

        try {
            // First try exact title match
            let url = `${this.baseUrl}/page/summary/${encodeURIComponent(title)}`;
            let response = await fetch(url, {
                headers: {
                    'User-Agent': this.userAgent,
                },
            });

            // If not found, try search API
            if (!response.ok && response.status === 404) {
                const searchUrl = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(title)}&limit=1&format=json`;
                const searchResponse = await fetch(searchUrl, {
                    headers: { 'User-Agent': this.userAgent },
                });

                if (searchResponse.ok) {
                    const searchData = await searchResponse.json();
                    const firstResult = searchData[1]?.[0];

                    if (firstResult) {
                        url = `${this.baseUrl}/page/summary/${encodeURIComponent(firstResult)}`;
                        response = await fetch(url, {
                            headers: { 'User-Agent': this.userAgent },
                        });
                    }
                }
            }

            if (!response.ok) {
                return null;
            }

            const data = await response.json();

            const result: EnrichmentData = {
                verified: true,
                source: 'wikipedia',
                canonical: {
                    type: 'wikipedia_title',
                    value: data.title,
                },
                general: {
                    summary: data.extract,
                    thumbnail: data.thumbnail?.source,
                    wikipediaUrl: data.content_urls?.desktop?.page,
                },
            };

            // Cache the result
            this.cache.set(cacheKey, { data: result, timestamp: Date.now() });

            return result;
        } catch (error) {
            console.error('[WikipediaHook] Error:', error);
            return null;
        }
    }

    async healthCheck(): Promise<boolean> {
        try {
            const response = await fetch(`${this.baseUrl}/page/summary/Main_Page`, {
                headers: { 'User-Agent': this.userAgent },
            });
            return response.ok;
        } catch {
            return false;
        }
    }

    /**
     * Clear the cache (for testing or memory management)
     */
    clearCache(): void {
        this.cache.clear();
    }
}
