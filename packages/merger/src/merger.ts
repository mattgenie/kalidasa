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
            this.toCAOResult(candidate, index)
        );

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
    private toCAOResult(candidate: EnrichedCandidate, index: number): CAOResult {
        const id = candidate.enrichment?.canonical?.value || `result-${index}-${Date.now()}`;

        return {
            id,
            type: candidate.type,
            name: candidate.name,
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
            enrichment: {
                verified: true,
                source: candidate.enrichment?.source,
                places: candidate.enrichment?.places,
                movies: candidate.enrichment?.movies,
                music: candidate.enrichment?.music,
                events: candidate.enrichment?.events,
                videos: candidate.enrichment?.videos,
                articles: candidate.enrichment?.articles,
                general: candidate.enrichment?.general,
            },
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
            articles: 'articles',
            general: 'results',
        };

        const label = domainLabels[domain] || 'results';

        return {
            headline: `${results.length} ${label} found`,
            summary: `Found ${results.length} verified ${label} matching your search.`,
            facetsApplied: [],
        };
    }
}
