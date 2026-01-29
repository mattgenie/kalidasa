/**
 * YouTube Hook - videos.list ONLY (1 quota unit per call)
 * 
 * Does NOT use search.list (100 units). 
 * Relies on Stage 1a grounded Gemini to provide real youtube_id values.
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
        this.apiKey = apiKey || process.env.YOUTUBE_API_KEY || '';
    }

    async enrich(
        candidate: RawCAOCandidate,
        context: EnrichmentContext
    ): Promise<EnrichmentData | null> {
        if (!this.apiKey) {
            console.warn('[YouTubeHook] No API key configured');
            return null;
        }

        // Get YouTube video ID from identifiers (provided by grounded Stage 1a)
        const videoId = candidate.identifiers?.youtube_id as string;

        if (!videoId) {
            console.warn(`[YouTubeHook] No youtube_id for "${candidate.name}"`);
            return null;
        }

        // Validate video ID format (should be 11 characters)
        if (videoId.length !== 11) {
            console.warn(`[YouTubeHook] Invalid video ID format: "${videoId}"`);
            return null;
        }

        try {
            // Use videos.list (1 quota unit) - NOT search.list (100 units)
            const url = `${this.baseUrl}/videos?part=snippet,contentDetails,statistics&id=${videoId}&key=${this.apiKey}`;
            console.log(`[YouTubeHook] Verifying video: ${videoId}`);

            const response = await fetch(url);

            if (!response.ok) {
                console.warn(`[YouTubeHook] API error for ${videoId}: ${response.status}`);
                return null;
            }

            const data = await response.json();
            const item = data.items?.[0];

            if (!item) {
                console.warn(`[YouTubeHook] Video not found: ${videoId}`);
                return null;
            }

            return {
                verified: true,
                source: 'youtube',
                canonical: {
                    type: 'youtube_id',
                    value: videoId,
                },
                videos: {
                    title: item.snippet.title,
                    description: item.snippet.description?.substring(0, 200),
                    thumbnailUrl: item.snippet.thumbnails?.high?.url || item.snippet.thumbnails?.default?.url,
                    publishedAt: item.snippet.publishedAt,
                    channelName: item.snippet.channelTitle,
                    channelId: item.snippet.channelId,
                    videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
                    duration: item.contentDetails?.duration,
                    viewCount: parseInt(item.statistics?.viewCount || '0'),
                    likeCount: parseInt(item.statistics?.likeCount || '0'),
                },
            };
        } catch (error) {
            console.error('[YouTubeHook] Error:', error);
            return null;
        }
    }

    async healthCheck(): Promise<boolean> {
        if (!this.apiKey) return false;

        try {
            // Use videos.list with a known video ID for health check (1 unit)
            const url = `${this.baseUrl}/videos?part=snippet&id=dQw4w9WgXcQ&key=${this.apiKey}`;
            const response = await fetch(url);
            return response.ok;
        } catch {
            return false;
        }
    }
}
