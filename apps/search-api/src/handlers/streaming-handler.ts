/**
 * Streaming Search Pipeline
 * 
 * Conveyor-belt processing: each candidate flows through
 * generation → enrichment → personalization → SSE output.
 */

import type { Request, Response } from 'express';
import type { KalidasaSearchRequest, RawCAOCandidate, EnrichedCandidate } from '@kalidasa/types';
import { StreamingCAOGenerator, type StreamingCandidate } from '@kalidasa/cao-generator';
import { StreamingEnricher, createHookRegistry } from '@kalidasa/enrichment';

// Import streaming personalizer
import { GoogleGenerativeAI } from '@google/generative-ai';

/**
 * Simple inline personalizer (to avoid circular dependency)
 */
async function personalizeCandidate(
    name: string,
    query: string,
    userName: string,
    prefs: string,
    genAI: GoogleGenerativeAI
): Promise<string> {
    try {
        const model = genAI.getGenerativeModel({
            model: 'gemini-2.0-flash',
            generationConfig: { maxOutputTokens: 100, temperature: 0.7 },
        });
        const result = await model.generateContent(
            `Why is "${name}" good for ${userName}? Query: "${query}". Prefs: ${prefs}. One sentence:`
        );
        return result.response.text().trim() || `Great for ${userName}`;
    } catch {
        return `Recommended for ${userName}`;
    }
}

/**
 * SSE Event Types
 */
interface SSECandidateEvent {
    type: 'candidate';
    data: {
        name: string;
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

    const userName = searchRequest.capsule.members?.[0]?.name || 'user';
    const prefs = JSON.stringify(searchRequest.capsule.members?.[0]?.preferences || {});

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

            // Parallel: enrichment + personalization
            const [enriched, personalization] = await Promise.all([
                streamingEnricher!.enrichOne(rawCandidate, {
                    timeout: 2000,
                    requestId,
                    searchLocation: searchRequest.logistics.searchLocation,
                }),
                personalizeCandidate(
                    candidate.name,
                    searchRequest.query.text,
                    userName,
                    prefs,
                    genAI!
                ),
            ]);

            if (enriched.verified) {
                verifiedCount++;
            }

            // Send candidate event
            sendSSE(res, {
                type: 'candidate',
                data: {
                    name: candidate.name,
                    summary: enriched.enrichment?.places?.address ||
                        enriched.enrichment?.movies?.overview || '',
                    personalization: { forUser: personalization },
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
