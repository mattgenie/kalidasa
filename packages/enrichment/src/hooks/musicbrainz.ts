/**
 * MusicBrainz Hook
 * 
 * Uses MusicBrainz API for music data (free, no API key required).
 */

import type {
    EnrichmentHook,
    RawCAOCandidate,
    EnrichmentContext,
    EnrichmentData,
    EnrichmentDomain
} from '@kalidasa/types';

export class MusicBrainzHook implements EnrichmentHook {
    name = 'musicbrainz';
    domains: EnrichmentDomain[] = ['music'];
    priority = 90; // Lower priority than Apple Music

    private baseUrl = 'https://musicbrainz.org/ws/2';
    private userAgent = 'Kalidasa/1.0 (https://github.com/kalidasa)';

    async enrich(
        candidate: RawCAOCandidate,
        context: EnrichmentContext
    ): Promise<EnrichmentData | null> {
        const query = candidate.search_hint || candidate.name;
        const artist = candidate.identifiers?.artist as string | undefined;

        try {
            // Search for recordings (songs)
            let searchQuery = query;
            if (artist) {
                searchQuery = `"${query}" AND artist:"${artist}"`;
            }

            const url = `${this.baseUrl}/recording/?query=${encodeURIComponent(searchQuery)}&limit=5&fmt=json`;
            const response = await fetch(url, {
                headers: {
                    'User-Agent': this.userAgent,
                    'Accept': 'application/json',
                },
            });

            if (!response.ok) {
                console.warn(`[MusicBrainzHook] API error: ${response.status}`);
                return null;
            }

            const data = await response.json();
            const recording = data.recordings?.[0];

            if (!recording) {
                // Try artist search as fallback
                const artistUrl = `${this.baseUrl}/artist/?query=${encodeURIComponent(query)}&limit=5&fmt=json`;
                const artistResponse = await fetch(artistUrl, {
                    headers: { 'User-Agent': this.userAgent, 'Accept': 'application/json' },
                });

                if (artistResponse.ok) {
                    const artistData = await artistResponse.json();
                    const artistResult = artistData.artists?.[0];
                    if (artistResult) {
                        return {
                            verified: true,
                            source: 'musicbrainz',
                            canonical: {
                                type: 'musicbrainz_id',
                                value: artistResult.id,
                            },
                            music: {
                                artist: artistResult.name,
                                genres: artistResult.tags?.map((t: any) => t.name) || [],
                            },
                        };
                    }
                }
                return null;
            }

            const artistName = recording['artist-credit']?.[0]?.name || recording['artist-credit']?.[0]?.artist?.name;
            const releaseGroup = recording.releases?.[0];

            return {
                verified: true,
                source: 'musicbrainz',
                canonical: {
                    type: 'musicbrainz_id',
                    value: recording.id,
                },
                music: {
                    artist: artistName,
                    album: releaseGroup?.title,
                    durationMs: recording.length,
                    releaseDate: releaseGroup?.date,
                    genres: recording.tags?.map((t: any) => t.name) || [],
                },
            };
        } catch (error) {
            console.error('[MusicBrainzHook] Error:', error);
            return null;
        }
    }

    async healthCheck(): Promise<boolean> {
        try {
            const response = await fetch(
                `${this.baseUrl}/artist/?query=radiohead&limit=1&fmt=json`,
                { headers: { 'User-Agent': this.userAgent, 'Accept': 'application/json' } }
            );
            return response.ok;
        } catch {
            return false;
        }
    }
}
