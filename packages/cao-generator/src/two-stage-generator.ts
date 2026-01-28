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
     */
    private async runStage1a(
        request: KalidasaSearchRequest,
        temporality: TemporalityResult
    ): Promise<Stage1aCandidate[]> {
        const prompt = buildStage1aPrompt(request, this.maxCandidates);

        const modelConfig: any = {
            model: this.model,
            generationConfig: {
                responseMimeType: 'application/json',
                temperature: 0.7,
            },
        };

        // Add grounding for current/temporal queries
        if (temporality.useGrounding) {
            modelConfig.model = 'gemini-2.5-flash';
            delete modelConfig.generationConfig.responseMimeType;
            modelConfig.tools = [{ google_search: {} }];
        }

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
