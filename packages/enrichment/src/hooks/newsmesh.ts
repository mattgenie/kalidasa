/**
 * NewsMesh Hook
 * 
 * Uses NewsMesh API for article/news data.
 */

import type {
    EnrichmentHook,
    RawCAOCandidate,
    EnrichmentContext,
    EnrichmentData,
    EnrichmentDomain
} from '@kalidasa/types';

export class NewsMeshHook implements EnrichmentHook {
    name = 'newsmesh';
    domains: EnrichmentDomain[] = ['articles'];
    priority = 80;

    private apiKey: string;

    constructor(apiKey?: string) {
        this.apiKey = apiKey || process.env.NEWSMESH_KEY || '';
    }

    async enrich(
        candidate: RawCAOCandidate,
        context: EnrichmentContext
    ): Promise<EnrichmentData | null> {
        if (!this.apiKey) {
            console.warn('[NewsMeshHook] No API key configured');
            return null;
        }

        const query = candidate.search_hint || candidate.name;

        try {
            // NewsMesh API - adjust endpoint as needed based on actual API docs
            const url = `https://api.newsmesh.io/v1/search?q=${encodeURIComponent(query)}&limit=1`;
            const response = await fetch(url, {
                headers: {
                    'X-API-Key': this.apiKey,
                    Accept: 'application/json',
                },
            });

            if (!response.ok) {
                console.warn(`[NewsMeshHook] API error: ${response.status}`);
                return null;
            }

            const data = await response.json();
            const article = data.results?.[0] || data.articles?.[0];

            if (!article) {
                return null;
            }

            return {
                verified: true,
                source: 'newsmesh',
                articles: {
                    author: article.author,
                    publishedAt: article.published_at || article.publishedAt,
                    source: article.source?.name || article.source,
                    imageUrl: article.image_url || article.imageUrl,
                    url: article.url,
                    summary: article.summary || article.description,
                },
            };
        } catch (error) {
            console.error('[NewsMeshHook] Error:', error);
            return null;
        }
    }

    async healthCheck(): Promise<boolean> {
        // Basic check - just verify we have a key
        return !!this.apiKey;
    }
}
