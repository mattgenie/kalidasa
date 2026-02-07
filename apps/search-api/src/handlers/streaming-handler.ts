/**
 * Streaming Search Pipeline
 * 
 * Conveyor-belt processing: each candidate flows through
 * generation → enrichment → summary + personalization → SSE output.
 * 
 * Uses the same shared prompt functions as the batch path
 * (see /kalidasa-rules workflow for dual-path requirements).
 */

import type { Request, Response } from 'express';
import type { KalidasaSearchRequest, RawCAOCandidate, EnrichedCandidate } from '@kalidasa/types';
import { StreamingCAOGenerator, type StreamingCandidate } from '@kalidasa/cao-generator';
import {
    buildSummaryPrompt, parseSummaryResponse,
    buildForUserPrompt, parseForUserResponse,
} from '@kalidasa/cao-generator';
import { StreamingEnricher, createHookRegistry } from '@kalidasa/enrichment';
import { generateSubheader } from '@kalidasa/merger';
import type { Stage1aCandidate } from '@kalidasa/cao-generator';

import { GoogleGenerativeAI } from '@google/generative-ai';

/**
 * Generate summary for a single candidate using the shared prompt
 */
async function generateSummary(
    candidateName: string,
    queryText: string,
    domain: string,
    genAI: GoogleGenerativeAI
): Promise<string> {
    try {
        const candidate: Stage1aCandidate = {
            name: candidateName,
            identifiers: {},
            enrichment_hooks: [],
        };
        const prompt = buildSummaryPrompt([candidate], queryText, domain);
        const model = genAI.getGenerativeModel({
            model: 'gemini-2.0-flash',
            generationConfig: { responseMimeType: 'application/json', temperature: 0.7 },
        });
        const result = await model.generateContent(prompt);
        const parsed = parseSummaryResponse(result.response.text());
        return parsed.summaries[candidateName] || '';
    } catch {
        return '';
    }
}

/**
 * Generate forUser personalization for a single candidate using the shared prompt
 */
async function generateForUser(
    candidateName: string,
    queryText: string,
    domain: string,
    capsule: KalidasaSearchRequest['capsule'],
    genAI: GoogleGenerativeAI
): Promise<string> {
    try {
        const candidate: Stage1aCandidate = {
            name: candidateName,
            identifiers: {},
            enrichment_hooks: [],
        };
        const prompt = buildForUserPrompt([candidate], capsule, queryText, domain);
        const model = genAI.getGenerativeModel({
            model: 'gemini-2.0-flash',
            generationConfig: { responseMimeType: 'application/json', temperature: 0.7 },
        });
        const result = await model.generateContent(prompt);
        const parsed = parseForUserResponse(result.response.text());
        return parsed.personalizations[candidateName] || `Recommended for ${capsule.members?.[0]?.name || 'you'}`;
    } catch {
        return `Recommended for ${capsule.members?.[0]?.name || 'you'}`;
    }
}

/**
 * SSE Event Types
 */
interface SSECandidateEvent {
    type: 'candidate';
    data: {
        name: string;
        subheader?: string;
        summary?: string;
        personalization?: { forUser: string };
        enrichment?: any;
        verified: boolean;
    };
}

interface SSEBundleEvent {
    type: 'bundle';
    data: {
        headline: string;
        summary: string;
        count: number;
    };
}

interface SSEDoneEvent {
    type: 'done';
    data: {
        totalMs: number;
        count: number;
    };
}

interface SSEErrorEvent {
    type: 'error';
    data: { message: string };
}

type SSEEvent = SSECandidateEvent | SSEBundleEvent | SSEDoneEvent | SSEErrorEvent;

/**
 * Send SSE event to response
 */
function sendSSE(res: Response, event: SSEEvent): void {
    res.write(`event: ${event.type}\n`);
    res.write(`data: ${JSON.stringify(event.data)}\n\n`);
}

// Singletons
let streamingGenerator: StreamingCAOGenerator | null = null;
let streamingEnricher: StreamingEnricher | null = null;
let genAI: GoogleGenerativeAI | null = null;

function getStreamingServices() {
    if (!streamingGenerator) {
        streamingGenerator = new StreamingCAOGenerator();
    }
    if (!streamingEnricher) {
        const registry = createHookRegistry();
        streamingEnricher = new StreamingEnricher(registry);
    }
    if (!genAI) {
        genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
    }
    return { streamingGenerator, streamingEnricher, genAI };
}

/**
 * Streaming search handler - SSE endpoint
 */
export async function streamingSearchHandler(req: Request, res: Response): Promise<void> {
    const startTime = Date.now();
    const requestId = `stream-${Date.now()}`;

    // Parse request from query params or body
    let searchRequest: KalidasaSearchRequest;
    try {
        if (req.method === 'POST') {
            searchRequest = req.body;
        } else {
            // GET request - params in query string
            searchRequest = JSON.parse(req.query.request as string);
        }
    } catch {
        res.status(400).json({ error: 'Invalid request' });
        return;
    }

    console.log(`[${requestId}] 🔄 Streaming search: "${searchRequest.query.text}"`);

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.flushHeaders();

    const { streamingGenerator, streamingEnricher, genAI } = getStreamingServices();

    let candidateCount = 0;
    let verifiedCount = 0;

    try {
        // Start streaming generation
        const candidateStream = streamingGenerator!.generateStream(searchRequest);

        for await (const candidate of candidateStream) {
            candidateCount++;
            const candidateStart = Date.now();

            // Convert to RawCAOCandidate format
            const rawCandidate: RawCAOCandidate = {
                name: candidate.name,
                type: 'entity',
                summary: '',
                identifiers: candidate.identifiers,
                enrichment_hooks: candidate.enrichment_hooks,
                search_hint: candidate.search_hint,
            };

            // Parallel: enrichment + summary + forUser
            const [enriched, summary, forUser] = await Promise.all([
                streamingEnricher!.enrichOne(rawCandidate, {
                    timeout: 2000,
                    requestId,
                    searchLocation: searchRequest.logistics.searchLocation,
                }),
                generateSummary(
                    candidate.name,
                    searchRequest.query.text,
                    searchRequest.query.domain,
                    genAI!
                ),
                generateForUser(
                    candidate.name,
                    searchRequest.query.text,
                    searchRequest.query.domain,
                    searchRequest.capsule,
                    genAI!
                ),
            ]);

            if (enriched.verified) {
                verifiedCount++;
            }

            // Send candidate event
            const domain = searchRequest.query.domain || 'general';
            sendSSE(res, {
                type: 'candidate',
                data: {
                    name: candidate.name,
                    subheader: enriched.enrichment
                        ? generateSubheader(domain as any, { verified: enriched.verified, ...(enriched.enrichment as any) })
                        : undefined,
                    summary,
                    personalization: { forUser },
                    enrichment: enriched.enrichment,
                    verified: enriched.verified,
                },
            });

            console.log(`[${requestId}] → Streamed ${candidate.name} (${Date.now() - candidateStart}ms)`);
        }

        // Send bundle
        sendSSE(res, {
            type: 'bundle',
            data: {
                headline: `${verifiedCount} results found`,
                summary: `Found ${verifiedCount} verified results for "${searchRequest.query.text}"`,
                count: verifiedCount,
            },
        });

        // Send done
        const totalMs = Date.now() - startTime;
        sendSSE(res, {
            type: 'done',
            data: { totalMs, count: candidateCount },
        });

        console.log(`[${requestId}] ✅ Stream complete: ${verifiedCount}/${candidateCount} verified (${totalMs}ms)`);

    } catch (error) {
        console.error(`[${requestId}] ❌ Stream error:`, error);
        sendSSE(res, {
            type: 'error',
            data: { message: error instanceof Error ? error.message : 'Stream failed' },
        });
    }

    res.end();
}
