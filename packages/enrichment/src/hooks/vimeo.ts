/**
 * Vimeo Hook
 * 
 * Uses Vimeo API for video data.
 */

import type {
    EnrichmentHook,
    RawCAOCandidate,
    EnrichmentContext,
    EnrichmentData,
    EnrichmentDomain
} from '@kalidasa/types';

export class VimeoHook implements EnrichmentHook {
    name = 'vimeo';
    domains: EnrichmentDomain[] = ['videos'];
    priority = 80;

    private accessToken: string;
    private baseUrl = 'https://api.vimeo.com';

    constructor(accessToken?: string) {
        this.accessToken = accessToken || process.env.VIMEO_ACCESS_TOKEN || '';
    }

    async enrich(
        candidate: RawCAOCandidate,
        context: EnrichmentContext
    ): Promise<EnrichmentData | null> {
        if (!this.accessToken) {
            console.warn('[VimeoHook] No access token configured');
            return null;
        }

        const query = candidate.search_hint || candidate.name;

        try {
            const url = `${this.baseUrl}/videos?query=${encodeURIComponent(query)}&per_page=1`;
            const response = await fetch(url, {
                headers: {
                    Authorization: `Bearer ${this.accessToken}`,
                    Accept: 'application/vnd.vimeo.*+json;version=3.4',
                },
            });

            if (!response.ok) {
                console.warn(`[VimeoHook] API error: ${response.status}`);
                return null;
            }

            const data = await response.json();
            const video = data.data?.[0];

            if (!video) {
                return null;
            }

            // Extract video ID from URI
            const videoId = video.uri?.split('/').pop() || '';

            return {
                verified: true,
                source: 'vimeo',
                canonical: {
                    type: 'youtube_id', // Using same type for videos
                    value: `vimeo:${videoId}`,
                },
                videos: {
                    thumbnailUrl: video.pictures?.sizes?.[3]?.link || video.pictures?.sizes?.[0]?.link,
                    duration: this.formatDuration(video.duration),
                    viewCount: video.stats?.plays,
                    publishedAt: video.created_time,
                    channelName: video.user?.name,
                    videoUrl: video.link,
                },
            };
        } catch (error) {
            console.error('[VimeoHook] Error:', error);
            return null;
        }
    }

    private formatDuration(seconds?: number): string | undefined {
        if (!seconds) return undefined;
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    async healthCheck(): Promise<boolean> {
        try {
            const response = await fetch(`${this.baseUrl}/me`, {
                headers: {
                    Authorization: `Bearer ${this.accessToken}`,
                },
            });
            return response.ok;
        } catch {
            return false;
        }
    }
}
