/**
 * YouTube Hook
 * 
 * Uses YouTube Data API v3 for video data.
 */

import type {
    EnrichmentHook,
    RawCAOCandidate,
    EnrichmentContext,
    EnrichmentData,
    EnrichmentDomain
} from '@kalidasa/types';

export class YouTubeHook implements EnrichmentHook {
    name = 'youtube';
    domains: EnrichmentDomain[] = ['videos'];
    priority = 100;

    private apiKey: string;
    private baseUrl = 'https://www.googleapis.com/youtube/v3';

    constructor(apiKey?: string) {
        // Uses same Google API key as Places
        this.apiKey = apiKey || process.env.GOOGLE_PLACES_API_KEY || '';
    }

    async enrich(
        candidate: RawCAOCandidate,
        context: EnrichmentContext
    ): Promise<EnrichmentData | null> {
        if (!this.apiKey) {
            console.warn('[YouTubeHook] No API key configured');
            return null;
        }

        const query = candidate.search_hint || candidate.name;

        try {
            const url = `${this.baseUrl}/search?part=snippet&q=${encodeURIComponent(query)}&type=video&maxResults=1&key=${this.apiKey}`;
            const response = await fetch(url);

            if (!response.ok) {
                console.warn(`[YouTubeHook] API error: ${response.status}`);
                return null;
            }

            const data = await response.json();
            const item = data.items?.[0];

            if (!item) {
                return null;
            }

            return {
                verified: true,
                source: 'youtube',
                canonical: {
                    type: 'youtube_id',
                    value: item.id.videoId,
                },
                videos: {
                    thumbnailUrl: item.snippet.thumbnails?.high?.url || item.snippet.thumbnails?.default?.url,
                    publishedAt: item.snippet.publishedAt,
                    channelName: item.snippet.channelTitle,
                    channelId: item.snippet.channelId,
                    videoUrl: `https://www.youtube.com/watch?v=${item.id.videoId}`,
                },
            };
        } catch (error) {
            console.error('[YouTubeHook] Error:', error);
            return null;
        }
    }

    async healthCheck(): Promise<boolean> {
        try {
            const url = `${this.baseUrl}/search?part=snippet&q=test&type=video&maxResults=1&key=${this.apiKey}`;
            const response = await fetch(url);
            return response.ok;
        } catch {
            return false;
        }
    }
}
