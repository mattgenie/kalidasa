/**
 * Diffbot Hook
 * 
 * Uses Diffbot API for article extraction.
 * Note: Diffbot requires a URL to analyze, so this hook works best
 * when candidates have URLs to process.
 */

import type {
    EnrichmentHook,
    RawCAOCandidate,
    EnrichmentContext,
    EnrichmentData,
    EnrichmentDomain
} from '@kalidasa/types';

export class DiffbotHook implements EnrichmentHook {
    name = 'diffbot';
    domains: EnrichmentDomain[] = ['articles'];
    priority = 85;

    private token: string;
    private baseUrl = 'https://api.diffbot.com/v3';

    constructor(token?: string) {
        this.token = token || process.env.DIFFBOT_TOKEN || '';
    }

    async enrich(
        candidate: RawCAOCandidate,
        context: EnrichmentContext
    ): Promise<EnrichmentData | null> {
        if (!this.token) {
            console.warn('[DiffbotHook] No token configured');
            return null;
        }

        // Diffbot needs a URL - check if candidate has one in search_hint
        const url = this.extractUrl(candidate);
        if (!url) {
            // Can't enrich without a URL
            return null;
        }

        try {
            const apiUrl = `${this.baseUrl}/article?token=${this.token}&url=${encodeURIComponent(url)}`;
            const response = await fetch(apiUrl);

            if (!response.ok) {
                console.warn(`[DiffbotHook] API error: ${response.status}`);
                return null;
            }

            const data = await response.json();
            const object = data.objects?.[0];

            if (!object) {
                return null;
            }

            return {
                verified: true,
                source: 'diffbot',
                articles: {
                    author: object.author,
                    publishedAt: object.date,
                    source: object.siteName,
                    imageUrl: object.images?.[0]?.url,
                    url: object.pageUrl || url,
                    summary: object.text?.substring(0, 500),
                },
            };
        } catch (error) {
            console.error('[DiffbotHook] Error:', error);
            return null;
        }
    }

    private extractUrl(candidate: RawCAOCandidate): string | null {
        // Check search_hint for URL
        const hint = candidate.search_hint || '';
        const urlMatch = hint.match(/https?:\/\/[^\s]+/);
        return urlMatch ? urlMatch[0] : null;
    }

    async healthCheck(): Promise<boolean> {
        // Can't easily health check without a URL to analyze
        return !!this.token;
    }
}
