/**
 * Two-Stage CAO Generator
 * 
 * Orchestrates parallel generation for <10s latency:
 * - Stage 1a: Fast candidate names (~3-5s)
 * - Stage 1b: Enrichment (parallel, ~1-2s)
 * - Stage 1c: Personalization (parallel, ~3-4s)
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import type { KalidasaSearchRequest, RawCAO, RawCAOCandidate, EnrichedCandidate } from '@kalidasa/types';
import { buildStage1aPrompt, parseStage1aResponse, type Stage1aCandidate } from './stage-1a-prompt.js';
import { buildStage1cPrompt, parseStage1cResponse, type Stage1cResponse } from './stage-1c-prompt.js';
import { classifyTemporality, type TemporalityResult } from './temporality.js';

/**
 * Enrichment function interface (to avoid circular dependency)
 */
export interface EnrichmentFunction {
    (candidates: RawCAOCandidate[], options: {
        timeout: number;
        requestId: string;
        searchLocation?: { city?: string; coordinates?: { lat: number; lng: number } };
    }): Promise<{ enriched: EnrichedCandidate[] }>;
}

export interface TwoStageGeneratorOptions {
    apiKey?: string;
    model?: string;
    maxCandidates?: number;
}

export interface TwoStageResult {
    cao: RawCAO;
    enriched: EnrichedCandidate[];
    latencyMs: number;
    stage1aMs: number;
    enrichmentMs: number;
    stage1cMs: number;
    temporality: TemporalityResult;
}

export class TwoStageGenerator {
    private genAI: GoogleGenerativeAI;
    private model: string;
    private maxCandidates: number;

    constructor(options: TwoStageGeneratorOptions = {}) {
        const apiKey = options.apiKey || process.env.GEMINI_API_KEY || '';
        if (!apiKey) {
            throw new Error('GEMINI_API_KEY is required');
        }

        this.genAI = new GoogleGenerativeAI(apiKey);
        this.model = options.model || 'gemini-2.0-flash';
        this.maxCandidates = options.maxCandidates || 10;
    }

    /**
     * Generate CAO with two-stage parallel processing
     */
    async generate(
        request: KalidasaSearchRequest,
        enrichFn: EnrichmentFunction
    ): Promise<TwoStageResult> {
        const startTime = Date.now();

        // Classify temporality (affects grounding in stage 1a if needed)
        const temporality = classifyTemporality(
            request.query.text,
            request.query.domain
        );

        console.log(`[TwoStage] Starting parallel generation...`);
        console.log(`[TwoStage] Temporality: ${temporality.type} (${temporality.confidence})`);

        // Stage 1a: Generate candidate names
        const stage1aStart = Date.now();
        const stage1aCandidates = await this.runStage1a(request, temporality);
        const stage1aMs = Date.now() - stage1aStart;
        console.log(`[TwoStage] Stage 1a complete: ${stage1aCandidates.length} candidates (${stage1aMs}ms)`);

        if (stage1aCandidates.length === 0) {
            console.error('[TwoStage] No candidates from Stage 1a');
            return this.emptyResult(startTime, stage1aMs, temporality);
        }

        // Convert Stage 1a candidates to RawCAOCandidate format for enrichment
        const rawCandidates: RawCAOCandidate[] = stage1aCandidates.map(c => ({
            name: c.name,
            type: 'entity' as const,
            summary: '',
            identifiers: c.identifiers,
            enrichment_hooks: c.enrichment_hooks,
            search_hint: c.search_hint,
        }));

        // Stage 1b + 1c: Run enrichment and personalization in parallel
        const parallelStart = Date.now();
        const [enrichResult, personalization] = await Promise.all([
            enrichFn(rawCandidates, {
                timeout: 5000,  // 5s timeout for external APIs
                requestId: `two-stage-${Date.now()}`,
                searchLocation: request.logistics.searchLocation,
            }),
            this.runStage1c(stage1aCandidates, request),
        ]);
        const parallelMs = Date.now() - parallelStart;

        const enriched = enrichResult.enriched;
        console.log(`[TwoStage] Stage 1b+1c parallel: ${enriched.length} enriched (${parallelMs}ms)`);

        // Merge personalization into enriched candidates
        const finalCandidates = this.mergePersonalization(enriched, personalization);

        // Build final CAO
        const cao: RawCAO = {
            candidates: finalCandidates,
            answerBundle: personalization.answerBundle
                ? { ...personalization.answerBundle, facetsApplied: [] }
                : {
                    headline: `${finalCandidates.length} results found`,
                    summary: `Found ${finalCandidates.length} verified results.`,
                    facetsApplied: [],
                },
        };

        return {
            cao,
            enriched: finalCandidates as EnrichedCandidate[],
            latencyMs: Date.now() - startTime,
            stage1aMs,
            enrichmentMs: parallelMs,
            stage1cMs: parallelMs,
            temporality,
        };
    }

    /**
     * Stage 1a: Generate candidate names
     * 
     * NOTE: We no longer use Grounding here. The enrichment hooks (Stage 1b)
     * verify results via external APIs (Google Places, TMDB, Spotify) which
     * provides better accuracy than LLM grounding at much lower latency.
     */
    private async runStage1a(
        request: KalidasaSearchRequest,
        temporality: TemporalityResult
    ): Promise<Stage1aCandidate[]> {
        // Videos domain: use specialized grounded search to find real YouTube URLs
        if (request.query.domain === 'videos') {
            return this.runVideoSearch(request);
        }

        const prompt = buildStage1aPrompt(request, this.maxCandidates);

        const modelConfig: any = {
            model: this.model,  // gemini-2.0-flash - fast!
            generationConfig: {
                responseMimeType: 'application/json',
                temperature: 0.7,
            },
        };

        // REMOVED: Grounding logic for temporal queries
        // Enrichment hooks (Google Places API, TMDB, etc.) handle verification
        // This saves ~15-20s per search request
        // Previously: if (temporality.useGrounding) { modelConfig.model = 'gemini-2.5-flash'; ... }

        console.log(`[TwoStage] Stage 1a using ${modelConfig.model} (temporality: ${temporality.type})`);

        const model = this.genAI.getGenerativeModel(modelConfig);

        try {
            const result = await model.generateContent(prompt);
            const text = result.response.text();
            return parseStage1aResponse(text);
        } catch (error) {
            console.error('[TwoStage] Stage 1a error:', error);
            return [];
        }
    }

    /**
     * Specialized video search using grounded Gemini to find real YouTube URLs
     */
    private async runVideoSearch(request: KalidasaSearchRequest): Promise<Stage1aCandidate[]> {
        // Step 1: Use grounded search to find YouTube videos
        // The prompt emphasizes finding and including actual YouTube URLs
        const prompt = `Search the web for ${this.maxCandidates} YouTube videos about: "${request.query.text}"

CRITICAL: For each video you find, you MUST include the full YouTube URL (https://www.youtube.com/watch?v=...).

List each video with:
1. Video title
2. Channel name  
3. Full YouTube URL

Example format:
- "How to Make Pasta" by Gordon Ramsay - https://www.youtube.com/watch?v=abcdefghijk`;

        const model = this.genAI.getGenerativeModel({
            model: 'gemini-2.5-flash',
            generationConfig: { temperature: 0.7 },
            tools: [{ google_search: {} }] as any,
        });

        try {
            const result = await model.generateContent(prompt);
            const text = result.response.text();

            // Step 2: Extract YouTube IDs from grounding metadata
            const groundingMeta = result.response.candidates?.[0]?.groundingMetadata;
            const youtubeData: Array<{ id: string; title?: string }> = [];

            if (groundingMeta?.groundingChuncks) {
                for (const chunk of groundingMeta.groundingChuncks) {
                    const uri = chunk?.web?.uri || '';
                    const title = chunk?.web?.title || '';

                    // Match youtube.com/watch?v=XXXXXXXXXXX or youtu.be/XXXXXXXXXXX
                    const watchMatch = uri.match(/youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})/);
                    const shortMatch = uri.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
                    const videoId = watchMatch?.[1] || shortMatch?.[1];

                    if (videoId && !youtubeData.some(v => v.id === videoId)) {
                        youtubeData.push({ id: videoId, title });
                    }
                }
            }

            console.log(`[TwoStage] Video search found ${youtubeData.length} YouTube URLs in grounding`);

            // Step 3: If grounding didn't find YouTube URLs, try to parse from response text
            if (youtubeData.length === 0) {
                // Look for YouTube URLs in the text response
                const urlMatches = text.matchAll(/youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})/g);
                const shortMatches = text.matchAll(/youtu\.be\/([a-zA-Z0-9_-]{11})/g);

                for (const match of urlMatches) {
                    if (!youtubeData.some(v => v.id === match[1])) {
                        youtubeData.push({ id: match[1] });
                    }
                }
                for (const match of shortMatches) {
                    if (!youtubeData.some(v => v.id === match[1])) {
                        youtubeData.push({ id: match[1] });
                    }
                }
                console.log(`[TwoStage] Found ${youtubeData.length} YouTube URLs in response text`);
            }

            // Step 4: Build candidates from YouTube IDs
            return youtubeData.slice(0, this.maxCandidates).map((video, i) => ({
                name: video.title || `Video ${i + 1}`,
                identifiers: { youtube_id: video.id },
                search_hint: video.title || request.query.text,
                enrichment_hooks: ['youtube'],
            }));

        } catch (error) {
            console.error('[TwoStage] Video search error:', error);
            return [];
        }
    }

    /**
     * Extract YouTube video IDs from grounding metadata citations
     */
    private enrichWithGroundingVideoIds(
        result: any,
        candidates: Stage1aCandidate[]
    ): Stage1aCandidate[] {
        try {
            const groundingMeta = result.response.candidates?.[0]?.groundingMetadata;
            if (!groundingMeta?.groundingChunks) {
                console.log('[TwoStage] No grounding chunks found for videos');
                return candidates;
            }

            // Extract YouTube URLs from grounding chunks
            const youtubeIds: string[] = [];
            const allUris: string[] = [];
            for (const chunk of groundingMeta.groundingChunks) {
                const uri = chunk?.web?.uri || '';
                allUris.push(uri);
                // Match youtube.com/watch?v=XXXXXXXXXXX or youtu.be/XXXXXXXXXXX
                const watchMatch = uri.match(/youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})/);
                const shortMatch = uri.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
                const videoId = watchMatch?.[1] || shortMatch?.[1];
                if (videoId && !youtubeIds.includes(videoId)) {
                    youtubeIds.push(videoId);
                }
            }

            console.log(`[TwoStage] Grounding URIs (${allUris.length}):`, allUris.slice(0, 5));
            console.log(`[TwoStage] Extracted ${youtubeIds.length} YouTube IDs from grounding`);

            // Inject real video IDs into candidates
            return candidates.map((candidate, i) => {
                if (youtubeIds[i]) {
                    return {
                        ...candidate,
                        identifiers: {
                            ...candidate.identifiers,
                            youtube_id: youtubeIds[i],
                        },
                    };
                }
                return candidate;
            });
        } catch (error) {
            console.error('[TwoStage] Error extracting YouTube IDs:', error);
            return candidates;
        }
    }

    /**
     * Stage 1c: Personalization
     */
    private async runStage1c(
        candidates: Stage1aCandidate[],
        request: KalidasaSearchRequest
    ): Promise<Stage1cResponse> {
        const prompt = buildStage1cPrompt(
            candidates,
            request.capsule,
            request.query.text
        );

        const model = this.genAI.getGenerativeModel({
            model: this.model,
            generationConfig: {
                responseMimeType: 'application/json',
                temperature: 0.7,
            },
        });

        try {
            const result = await model.generateContent(prompt);
            const text = result.response.text();
            return parseStage1cResponse(text);
        } catch (error) {
            console.error('[TwoStage] Stage 1c error:', error);
            return { personalizations: {} };
        }
    }

    /**
     * Merge personalization into enriched candidates
     */
    private mergePersonalization(
        enriched: EnrichedCandidate[],
        personalization: Stage1cResponse
    ): RawCAOCandidate[] {
        return enriched.map(candidate => {
            const p = personalization.personalizations[candidate.name];
            return {
                ...candidate,
                summary: p?.summary || candidate.summary || '',
                personalization: p ? {
                    forUser: p.forUser,
                } : undefined,
            };
        });
    }

    /**
     * Return empty result on failure
     */
    private emptyResult(
        startTime: number,
        stage1aMs: number,
        temporality: TemporalityResult
    ): TwoStageResult {
        return {
            cao: {
                candidates: [],
                answerBundle: {
                    headline: 'No results found',
                    summary: 'Unable to find matching results.',
                    facetsApplied: [],
                },
            },
            enriched: [],
            latencyMs: Date.now() - startTime,
            stage1aMs,
            enrichmentMs: 0,
            stage1cMs: 0,
            temporality,
        };
    }
}
