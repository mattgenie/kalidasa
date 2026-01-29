/**
 * Streaming CAO Generator
 * 
 * Uses Gemini's streaming API to emit candidates one at a time
 * as they are generated, enabling conveyor-belt processing.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import type { KalidasaSearchRequest } from '@kalidasa/types';
import { classifyTemporality, type TemporalityResult } from './temporality.js';

/**
 * Streaming candidate - emitted one at a time
 */
export interface StreamingCandidate {
    name: string;
    identifiers: Record<string, string | number>;
    search_hint?: string;
    enrichment_hooks: string[];
}

export interface StreamingGeneratorOptions {
    apiKey?: string;
    model?: string;
    maxCandidates?: number;
}

/**
 * Build NDJSON streaming prompt
 */
function buildStreamingPrompt(
    request: KalidasaSearchRequest,
    maxCandidates: number
): string {
    const domain = request.query.domain;
    const location = request.logistics.searchLocation?.city || 'any';

    const identifierExamples: Record<string, string> = {
        places: '{"address": "123 Main St", "city": "NYC"}',
        movies: '{"year": 2023, "director": "Director Name"}',
        music: '{"artist": "Artist", "album": "Album"}',
        general: '{"category": "topic"}',
    };

    const hookDefaults: Record<string, string> = {
        places: '["google_places"]',
        movies: '["tmdb"]',
        music: '["apple_music"]',
        general: '["wikipedia"]',
    };

    // Movies: emphasize year is CRITICAL for lookup
    if (domain === 'movies') {
        // Extract year from query if present
        const yearMatch = request.query.text.match(/\b(19|20)\d{2}\b/);
        const yearHint = yearMatch ? ` (from ${yearMatch[0]})` : '';

        return `Find ${maxCandidates} movies for: "${request.query.text}"

CRITICAL: The "year" field is REQUIRED for each movie. TMDB lookup will fail without it.
${yearMatch ? `The query mentions year ${yearMatch[0]} - use this for recent movies.` : 'Infer the year from context or use the movie\'s actual release year.'}

Output EXACTLY one JSON object per line (NDJSON format). No extra text.
Each line:
{"name": "exact movie title", "identifiers": {"year": YYYY, "director": "director name"}, "search_hint": "exact title", "enrichment_hooks": ["tmdb"]}

Start outputting now:`;
    }

    return `Find ${maxCandidates} recommendations for: "${request.query.text}"
Domain: ${domain}
Location: ${location}

Output EXACTLY one JSON object per line (NDJSON format). No extra text.
Each line must be valid JSON:
{"name": "...", "identifiers": ${identifierExamples[domain] || identifierExamples.general}, "search_hint": "...", "enrichment_hooks": ${hookDefaults[domain] || hookDefaults.general}}

Start outputting now:`;
}

/**
 * Parse a single line of NDJSON
 */
function parseLine(line: string): StreamingCandidate | null {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('```')) return null;

    try {
        const parsed = JSON.parse(trimmed);
        if (parsed.name) {
            return {
                name: parsed.name,
                identifiers: parsed.identifiers || {},
                search_hint: parsed.search_hint,
                enrichment_hooks: parsed.enrichment_hooks || [],
            };
        }
    } catch {
        // Not valid JSON, skip
    }
    return null;
}

export class StreamingCAOGenerator {
    private genAI: GoogleGenerativeAI;
    private model: string;
    private maxCandidates: number;

    constructor(options: StreamingGeneratorOptions = {}) {
        const apiKey = options.apiKey || process.env.GEMINI_API_KEY || '';
        if (!apiKey) {
            throw new Error('GEMINI_API_KEY is required');
        }

        this.genAI = new GoogleGenerativeAI(apiKey);
        this.model = options.model || 'gemini-2.0-flash';
        this.maxCandidates = options.maxCandidates || 10;
    }

    /**
     * Generate candidates as an async iterable stream
     */
    async *generateStream(
        request: KalidasaSearchRequest
    ): AsyncGenerator<StreamingCandidate, TemporalityResult, undefined> {
        const temporality = classifyTemporality(
            request.query.text,
            request.query.domain
        );

        console.log(`[StreamingCAO] Starting stream, temporality: ${temporality.type}`);

        const prompt = buildStreamingPrompt(request, this.maxCandidates);

        const modelConfig: any = {
            model: this.model,  // gemini-2.0-flash - fast!
            generationConfig: {
                temperature: 0.7,
            },
        };

        // REMOVED: Grounding logic for temporal queries
        // Enrichment hooks (Google Places API, TMDB, etc.) handle verification
        // This saves ~15-20s per search request
        console.log(`[StreamingCAO] Using ${modelConfig.model} (temporality: ${temporality.type})`);

        const model = this.genAI.getGenerativeModel(modelConfig);

        try {
            const result = await model.generateContentStream(prompt);

            let buffer = '';
            let candidateCount = 0;

            for await (const chunk of result.stream) {
                const text = chunk.text();
                buffer += text;

                // Process complete lines
                const lines = buffer.split('\n');
                buffer = lines.pop() || ''; // Keep incomplete line in buffer

                for (const line of lines) {
                    const candidate = parseLine(line);
                    if (candidate) {
                        candidateCount++;
                        console.log(`[StreamingCAO] Yielding candidate ${candidateCount}: ${candidate.name}`);
                        yield candidate;

                        if (candidateCount >= this.maxCandidates) {
                            return temporality;
                        }
                    }
                }
            }

            // Process any remaining buffer
            if (buffer.trim()) {
                const candidate = parseLine(buffer);
                if (candidate && candidateCount < this.maxCandidates) {
                    candidateCount++;
                    console.log(`[StreamingCAO] Yielding final candidate ${candidateCount}: ${candidate.name}`);
                    yield candidate;
                }
            }

            console.log(`[StreamingCAO] Stream complete: ${candidateCount} candidates`);
            return temporality;
        } catch (error) {
            console.error('[StreamingCAO] Stream error:', error);
            throw error;
        }
    }
}
