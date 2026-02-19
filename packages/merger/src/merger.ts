/**
 * Merger
 * 
 * Combines enriched candidates into final CAO results.
 */

import type {
    EnrichedCandidate,
    CAOResult,
    RawCAO,
    AnswerBundle,
    RenderHints,
    Domain,
} from '@kalidasa/types';
import { generateRenderHints } from './render-hints.js';
import { generateSubheader } from './subheader.js';

export interface MergeOptions {
    domain: Domain;
    maxResults?: number;
}

export class Merger {
    /**
     * Merge enriched candidates into final CAO results
     */
    merge(
        rawCAO: RawCAO,
        enrichedCandidates: EnrichedCandidate[],
        options: MergeOptions
    ): {
        results: CAOResult[];
        answerBundle: AnswerBundle;
        renderHints: RenderHints;
    } {
        const maxResults = options.maxResults || 12;

        // Filter to verified candidates and limit
        const verified = enrichedCandidates
            .filter(c => c.verified)
            .slice(0, maxResults);

        // Convert to CAO results
        const results: CAOResult[] = verified.map((candidate, index) =>
            this.toCAOResult(candidate, index, options.domain)
        );

        // P3 + P5: Deduplicate photos within this stack (and across stacks if global set provided)
        this.deduplicatePhotos(results);

        // P7: Upgrade Wikipedia thumbnails from 100px/220px to 400px
        this.upgradeWikiThumbnails(results);

        // Generate answer bundle
        const answerBundle = this.buildAnswerBundle(rawCAO, results, options.domain);

        // Generate render hints
        const renderHints = generateRenderHints(options.domain, results.length);

        return {
            results,
            answerBundle,
            renderHints,
        };
    }

    /**
     * Convert an enriched candidate to a CAO result
     */
    private toCAOResult(candidate: EnrichedCandidate, index: number, domain: Domain): CAOResult {
        const id = candidate.enrichment?.canonical?.value || `result-${index}-${Date.now()}`;

        const enrichment = {
            verified: true,
            source: candidate.enrichment?.source,
            places: candidate.enrichment?.places,
            movies: candidate.enrichment?.movies,
            music: candidate.enrichment?.music,
            events: candidate.enrichment?.events,
            videos: candidate.enrichment?.videos,
            books: candidate.enrichment?.books,
            articles: candidate.enrichment?.articles,
            news: candidate.enrichment?.news,
            general: candidate.enrichment?.general,
        };

        return {
            id,
            type: candidate.type,
            name: candidate.name,
            subheader: generateSubheader(domain, enrichment),
            summary: candidate.summary,
            canonical: candidate.enrichment?.canonical
                ? {
                    type: candidate.enrichment.canonical.type as any,
                    value: candidate.enrichment.canonical.value,
                }
                : undefined,
            reasoning: {
                whyRecommended: candidate.reasoning?.whyRecommended || '',
                pros: candidate.reasoning?.pros || [],
                cons: candidate.reasoning?.cons || [],
            },
            personalization: {
                forUser: candidate.personalization?.forUser as any,
                forGroup: candidate.personalization?.forGroup as any,
                groupNotes: candidate.personalization?.groupNotes,
            },
            enrichment,
            facetScores: candidate.facetScores,
        };
    }

    /**
     * Build answer bundle from raw CAO and results
     */
    private buildAnswerBundle(
        rawCAO: RawCAO,
        results: CAOResult[],
        domain: Domain
    ): AnswerBundle {
        // Use raw CAO's answer bundle if available
        if (rawCAO.answerBundle) {
            return {
                headline: rawCAO.answerBundle.headline,
                summary: rawCAO.answerBundle.summary,
                facetsApplied: rawCAO.answerBundle.facetsApplied,
            };
        }

        // Generate default answer bundle
        const domainLabels: Record<string, string> = {
            places: 'places',
            movies: 'movies',
            music: 'songs',
            events: 'events',
            videos: 'videos',
            books: 'books',
            articles: 'articles',
            news: 'articles',
            general: 'results',
        };

        const label = domainLabels[domain] || 'results';

        return {
            headline: `${results.length} ${label} found`,
            summary: `Found ${results.length} verified ${label} matching your search.`,
            facetsApplied: [],
        };
    }

    /**
     * P3 + P5: Remove duplicate photos within a result set.
     * Walks all domain-specific image fields and clears any URL already used by a prior result.
     */
    private deduplicatePhotos(results: CAOResult[]): void {
        const usedUrls = new Set<string>();

        for (const result of results) {
            const e = result.enrichment;
            if (!e) continue;

            // Collect all image URLs from this result and dedup against prior results
            const imageFields: Array<{ get: () => string | undefined; clear: () => void }> = [];

            // Places: photos array
            if (e.places?.photos) {
                for (let i = 0; i < e.places.photos.length; i++) {
                    const idx = i;
                    imageFields.push({
                        get: () => e.places!.photos![idx],
                        clear: () => { e.places!.photos!.splice(idx, 1); },
                    });
                }
            }

            // Movies: posterUrl, backdropUrl
            if (e.movies?.posterUrl) imageFields.push({ get: () => e.movies!.posterUrl, clear: () => { e.movies!.posterUrl = undefined; } });
            if (e.movies?.backdropUrl) imageFields.push({ get: () => e.movies!.backdropUrl, clear: () => { e.movies!.backdropUrl = undefined; } });

            // Events: imageUrl
            if (e.events?.imageUrl) imageFields.push({ get: () => e.events!.imageUrl, clear: () => { e.events!.imageUrl = undefined; } });

            // Videos: thumbnailUrl
            if (e.videos?.thumbnailUrl) imageFields.push({ get: () => e.videos!.thumbnailUrl, clear: () => { e.videos!.thumbnailUrl = undefined; } });

            // Articles: imageUrl
            if (e.articles?.imageUrl) imageFields.push({ get: () => e.articles!.imageUrl, clear: () => { e.articles!.imageUrl = undefined; } });

            // News: imageUrl
            if (e.news?.imageUrl) imageFields.push({ get: () => e.news!.imageUrl, clear: () => { e.news!.imageUrl = undefined; } });

            // Books: coverUrl
            if (e.books?.coverUrl) imageFields.push({ get: () => e.books!.coverUrl, clear: () => { e.books!.coverUrl = undefined; } });

            // General: thumbnail
            if (e.general?.thumbnail) imageFields.push({ get: () => e.general!.thumbnail, clear: () => { e.general!.thumbnail = undefined; } });

            // Music: albumArt
            if (e.music?.albumArt) imageFields.push({ get: () => e.music!.albumArt, clear: () => { e.music!.albumArt = undefined; } });

            // Check each image — if already used, clear it
            for (const field of imageFields) {
                const url = field.get();
                if (url && usedUrls.has(url)) {
                    field.clear();
                } else if (url) {
                    usedUrls.add(url);
                }
            }
        }
    }

    /**
     * P7: Upgrade Wikipedia thumbnail URLs from low-res (100px/220px) to 400px.
     * Wikipedia URLs follow: .../thumb/.../NNNpx-Filename → replace NNN with 400.
     */
    private upgradeWikiThumbnails(results: CAOResult[]): void {
        const upgrade = (url: string | undefined): string | undefined => {
            if (!url) return url;
            // Match Wikipedia thumbnail URLs and upgrade resolution
            if (url.includes('upload.wikimedia.org') && url.includes('/thumb/')) {
                return url.replace(/\/(\d+)px-([^/]+)$/, '/400px-$2');
            }
            return url;
        };

        for (const result of results) {
            const e = result.enrichment;
            if (!e) continue;
            if (e.events?.imageUrl) e.events.imageUrl = upgrade(e.events.imageUrl);
            if (e.general?.thumbnail) e.general.thumbnail = upgrade(e.general.thumbnail);
            if (e.books?.coverUrl) e.books.coverUrl = upgrade(e.books.coverUrl);
        }
    }
}
