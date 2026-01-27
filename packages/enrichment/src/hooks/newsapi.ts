/**
 * NewsAPI Hook
 * 
 * Uses NewsAPI for article/news data.
 */

import type {
    EnrichmentHook,
    RawCAOCandidate,
    EnrichmentContext,
    EnrichmentData,
    EnrichmentDomain
} from '@kalidasa/types';

export class NewsAPIHook implements EnrichmentHook {
    name = 'newsapi';
    domains: EnrichmentDomain[] = ['articles'];
    priority = 90;

    private apiKey: string;
    private baseUrl = 'https://newsapi.org/v2';

    constructor(apiKey?: string) {
        this.apiKey = apiKey || process.env.NEWSAPI_KEY || '';
    }

    async enrich(
        candidate: RawCAOCandidate,
        context: EnrichmentContext
    ): Promise<EnrichmentData | null> {
        if (!this.apiKey) {
            console.warn('[NewsAPIHook] No API key configured');
            return null;
        }

        const query = candidate.search_hint || candidate.name;

        try {
            const url = `${this.baseUrl}/everything?q=${encodeURIComponent(query)}&apiKey=${this.apiKey}&pageSize=1&sortBy=relevancy`;
            const response = await fetch(url);

            if (!response.ok) {
                console.warn(`[NewsAPIHook] API error: ${response.status}`);
                return null;
            }

            const data = await response.json();
            const article = data.articles?.[0];

            if (!article) {
                return null;
            }

            return {
                verified: true,
                source: 'newsapi',
                articles: {
                    author: article.author,
                    publishedAt: article.publishedAt,
                    source: article.source?.name,
                    imageUrl: article.urlToImage,
                    url: article.url,
                    summary: article.description,
                },
            };
        } catch (error) {
            console.error('[NewsAPIHook] Error:', error);
            return null;
        }
    }

    async healthCheck(): Promise<boolean> {
        try {
            const response = await fetch(`${this.baseUrl}/top-headlines?country=us&pageSize=1&apiKey=${this.apiKey}`);
            return response.ok;
        } catch {
            return false;
        }
    }
}
