/**
 * CAO Generator
 * 
 * Uses Gemini with adaptive grounding based on query temporality.
 * - Current/temporal queries: Use google_search grounding
 * - Evergreen queries: Use model knowledge (faster, no grounding)
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import type { KalidasaSearchRequest, RawCAO, Domain } from '@kalidasa/types';
import { FacetRegistry } from '@kalidasa/facet-libraries';
import { buildPrompt } from './prompt-builder.js';
import { parseCAO } from './parser.js';
import { classifyTemporality, type TemporalityResult } from './temporality.js';

export interface CAOGeneratorOptions {
    apiKey?: string;
    model?: string;
    modelUngrounded?: string;  // Model for evergreen queries
    temperature?: number;
    maxCandidates?: number;
}

export class CAOGenerator {
    private genAI: GoogleGenerativeAI;
    private facetRegistry: FacetRegistry;
    private model: string;
    private modelUngrounded: string;
    private temperature: number;
    private maxCandidates: number;

    constructor(options: CAOGeneratorOptions = {}) {
        const apiKey = options.apiKey || process.env.GEMINI_API_KEY || '';
        if (!apiKey) {
            throw new Error('GEMINI_API_KEY is required');
        }

        this.genAI = new GoogleGenerativeAI(apiKey);
        this.facetRegistry = new FacetRegistry();
        this.model = options.model || 'gemini-2.5-flash';
        this.modelUngrounded = options.modelUngrounded || 'gemini-2.0-flash';
        this.temperature = options.temperature || 0.7;
        this.maxCandidates = options.maxCandidates || 10;
    }

    /**
     * Generate a CAO for the given search request
     */
    async generate(request: KalidasaSearchRequest): Promise<{
        cao: RawCAO;
        latencyMs: number;
        groundingSources?: string[];
        temporality?: TemporalityResult;
    }> {
        const startTime = Date.now();

        // Classify query temporality to decide grounding strategy
        const temporality = classifyTemporality(
            request.query.text,
            request.query.domain
        );

        console.log(
            `[CAOGenerator] Temporality: ${temporality.type} (${temporality.confidence}) - ` +
            `${temporality.useGrounding ? 'using grounding' : 'no grounding'}`
        );

        // Build prompt
        const prompt = buildPrompt(request, this.facetRegistry, this.maxCandidates);

        // Get appropriate model based on temporality
        const model = temporality.useGrounding
            ? this.getGroundedModel()
            : this.getUngroundedModel();

        try {
            const result = await model.generateContent(prompt);
            const response = result.response;
            const text = response.text();

            // Parse the CAO
            const cao = parseCAO(text);

            // Extract grounding sources if available
            const groundingSources = this.extractGroundingSources(response);

            return {
                cao,
                latencyMs: Date.now() - startTime,
                groundingSources,
                temporality,
            };
        } catch (error) {
            console.error('[CAOGenerator] Error generating CAO:', error);
            throw error;
        }
    }

    /**
     * Get model with grounding enabled (for current/temporal queries)
     */
    private getGroundedModel() {
        return this.genAI.getGenerativeModel({
            model: this.model,
            generationConfig: {
                temperature: this.temperature,
            },
            tools: [
                {
                    // @ts-expect-error - Gemini SDK types may not include this yet
                    google_search: {},
                },
            ],
        });
    }

    /**
     * Get model without grounding (for evergreen queries - faster)
     */
    private getUngroundedModel() {
        return this.genAI.getGenerativeModel({
            model: this.modelUngrounded,
            generationConfig: {
                responseMimeType: 'application/json',
                temperature: this.temperature,
            },
        });
    }

    /**
     * Extract grounding sources from response metadata
     */
    private extractGroundingSources(response: any): string[] | undefined {
        try {
            const groundingMetadata = response.candidates?.[0]?.groundingMetadata;
            if (groundingMetadata?.groundingChunks) {
                return groundingMetadata.groundingChunks
                    .filter((chunk: any) => chunk.web?.uri)
                    .map((chunk: any) => chunk.web.uri);
            }
        } catch {
            // Grounding metadata not available
        }
        return undefined;
    }

    /**
     * Get facet registry for external use
     */
    getFacetRegistry(): FacetRegistry {
        return this.facetRegistry;
    }
}
