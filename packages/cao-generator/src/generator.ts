/**
 * CAO Generator
 * 
 * Uses Gemini with native grounding to generate structured candidates.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import type { KalidasaSearchRequest, RawCAO, Domain } from '@kalidasa/types';
import { FacetRegistry } from '@kalidasa/facet-libraries';
import { buildPrompt } from './prompt-builder.js';
import { parseCAO } from './parser.js';

export interface CAOGeneratorOptions {
    apiKey?: string;
    model?: string;
    temperature?: number;
    maxCandidates?: number;
}

export class CAOGenerator {
    private genAI: GoogleGenerativeAI;
    private facetRegistry: FacetRegistry;
    private model: string;
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
    }> {
        const startTime = Date.now();

        // Build prompt with facets
        const prompt = buildPrompt(request, this.facetRegistry, this.maxCandidates);

        // Get Gemini model with grounding
        const model = this.genAI.getGenerativeModel({
            model: this.model,
            generationConfig: {
                // Note: responseMimeType not supported with google_search in 2.5-flash
                temperature: this.temperature,
            },
            // Enable native grounding (google_search for Gemini 3)
            tools: [
                {
                    // @ts-expect-error - Gemini SDK types may not include this yet
                    google_search: {},
                },
            ],
        });

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
            };
        } catch (error) {
            console.error('[CAOGenerator] Error generating CAO:', error);
            throw error;
        }
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
