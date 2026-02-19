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
        // Prefer candidate.name (just the title) when we have an artist identifier,
        // since search_hint includes "title artist" which causes redundant artist matching
        const artist = candidate.identifiers?.artist as string | undefined;
        const query = artist ? candidate.name : (candidate.search_hint || candidate.name);
        const musicType = (candidate.identifiers?.type as string | undefined)?.toLowerCase();


        try {
            // Route to correct endpoint based on type identifier
            if (musicType === 'album') {
                return await this.searchReleaseGroup(query, artist);
            } else if (musicType === 'song') {
                return await this.searchRecording(query, artist);
            }

            // No type specified — try release-group first (more common), then recording
            const albumResult = await this.searchReleaseGroup(query, artist);
            if (albumResult) return albumResult;

            return await this.searchRecording(query, artist);
        } catch (error) {
            console.error('[MusicBrainzHook] Error:', error);
            return null;
        }
    }

    /**
     * Fetch with retry on 503 (MusicBrainz rate-limit response).
     * CONCURRENCY=2 in the handler naturally limits concurrent requests.
     */
    private async fetchMB(url: string): Promise<Response> {
        const headers = { 'User-Agent': this.userAgent, 'Accept': 'application/json' };
        let resp = await fetch(url, { headers });
        if (resp.status === 503) {
            // Wait 500ms and retry once
            await new Promise(r => setTimeout(r, 500));
            resp = await fetch(url, { headers });
        }
        return resp;
    }

    /**
     * Search for albums (release-groups)
     */
    private async searchReleaseGroup(query: string, artist?: string): Promise<EnrichmentData | null> {
        let searchQuery = `"${query}"`;
        if (artist) {
            searchQuery += ` AND artist:"${artist}"`;
        }

        const url = `${this.baseUrl}/release-group/?query=${encodeURIComponent(searchQuery)}&limit=5&fmt=json`;
        const response = await this.fetchMB(url);

        if (!response.ok) {
            console.warn(`[MusicBrainzHook] Release-group API error: ${response.status}`);
            return null;
        }

        const data = await response.json();
        const rg = data['release-groups']?.[0];

        if (!rg || rg.score < 80) return null;

        const artistName = rg['artist-credit']?.[0]?.name || rg['artist-credit']?.[0]?.artist?.name;
        const firstRelease = rg['first-release-date'];

        return {
            verified: true,
            source: 'musicbrainz',
            canonical: {
                type: 'musicbrainz_id',
                value: rg.id,
            },
            music: {
                artist: artistName,
                album: rg.title,
                releaseDate: firstRelease,
                genres: rg.tags?.map((t: any) => t.name) || [],
                musicType: rg['primary-type'] || 'Album',
            },
        };
    }

    /**
     * Search for songs (recordings)
     */
    private async searchRecording(query: string, artist?: string): Promise<EnrichmentData | null> {
        let searchQuery = query;
        if (artist) {
            searchQuery = `"${query}" AND artist:"${artist}"`;
        }

        const url = `${this.baseUrl}/recording/?query=${encodeURIComponent(searchQuery)}&limit=5&fmt=json`;
        const response = await this.fetchMB(url);

        if (!response.ok) {
            console.warn(`[MusicBrainzHook] Recording API error: ${response.status}`);
            return null;
        }

        const data = await response.json();
        const recording = data.recordings?.[0];

        if (!recording) {
            // Try artist search as fallback
            return await this.searchArtist(query);
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
                musicType: 'Song',
            },
        };
    }

    /**
     * Fallback: search for an artist
     */
    private async searchArtist(query: string): Promise<EnrichmentData | null> {
        const artistUrl = `${this.baseUrl}/artist/?query=${encodeURIComponent(query)}&limit=5&fmt=json`;
        const artistResponse = await this.fetchMB(artistUrl);

        if (!artistResponse.ok) return null;

        const artistData = await artistResponse.json();
        const artistResult = artistData.artists?.[0];
        if (!artistResult) return null;

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
