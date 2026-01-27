/**
 * Apple Music Hook
 * 
 * Uses Apple Music API for song/artist data.
 */

import type {
    EnrichmentHook,
    RawCAOCandidate,
    EnrichmentContext,
    EnrichmentData,
    EnrichmentDomain
} from '@kalidasa/types';

export class AppleMusicHook implements EnrichmentHook {
    name = 'apple_music';
    domains: EnrichmentDomain[] = ['music'];
    priority = 100;

    private token: string;
    private baseUrl = 'https://api.music.apple.com/v1';

    constructor(token?: string) {
        this.token = token || process.env.APPLE_MUSIC_TOKEN || '';
    }

    async enrich(
        candidate: RawCAOCandidate,
        context: EnrichmentContext
    ): Promise<EnrichmentData | null> {
        if (!this.token) {
            console.warn('[AppleMusicHook] No token configured');
            return null;
        }

        const query = candidate.search_hint || candidate.name;

        try {
            const url = `${this.baseUrl}/catalog/us/search?term=${encodeURIComponent(query)}&types=songs&limit=5`;
            const response = await fetch(url, {
                headers: {
                    Host: 'api.music.apple.com',
                    Authorization: `Bearer ${this.token}`,
                    Accept: 'application/json',
                },
            });

            if (!response.ok) {
                console.warn(`[AppleMusicHook] API error: ${response.status}`);
                return null;
            }

            const data = await response.json();
            const song = data.results?.songs?.data?.[0];

            if (!song) {
                return null;
            }

            const attrs = song.attributes;

            return {
                verified: true,
                source: 'apple_music',
                canonical: {
                    type: 'apple_music_id',
                    value: song.id,
                },
                music: {
                    artist: attrs?.artistName,
                    album: attrs?.albumName,
                    durationMs: attrs?.durationInMillis,
                    albumArt: attrs?.artwork?.url?.replace('{w}x{h}', '300x300'),
                    previewUrl: attrs?.previews?.[0]?.url,
                    explicit: attrs?.contentRating === 'explicit',
                    genres: attrs?.genreNames,
                    releaseDate: attrs?.releaseDate,
                },
            };
        } catch (error) {
            console.error('[AppleMusicHook] Error:', error);
            return null;
        }
    }

    async healthCheck(): Promise<boolean> {
        try {
            const response = await fetch(`${this.baseUrl}/catalog/us/search?term=test&types=songs&limit=1`, {
                headers: {
                    Host: 'api.music.apple.com',
                    Authorization: `Bearer ${this.token}`,
                    Accept: 'application/json',
                },
            });
            return response.ok;
        } catch {
            return false;
        }
    }
}
