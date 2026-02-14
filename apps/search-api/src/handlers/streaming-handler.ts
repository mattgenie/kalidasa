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

        // Try exact match first, then fuzzy
        const exactMatch = parsed.summaries[candidateName];
        if (exactMatch) return exactMatch;

        const nameLower = candidateName.toLowerCase();
        for (const [key, value] of Object.entries(parsed.summaries)) {
            const keyLower = key.toLowerCase();
            if (keyLower.includes(nameLower) || nameLower.includes(keyLower)) {
                return value;
            }
        }

        const entries = Object.entries(parsed.summaries);
        if (entries.length === 1 && entries[0][1]) {
            return entries[0][1];
        }

        return '';
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
    genAI: GoogleGenerativeAI,
    conversation?: KalidasaSearchRequest['conversation']
): Promise<string> {
    try {
        const candidate: Stage1aCandidate = {
            name: candidateName,
            identifiers: {},
            enrichment_hooks: [],
        };
        // Build conversation context string for personalization
        let conversationContext: string | undefined;
        if (conversation?.recentMessages?.length || conversation?.previousSearches?.length) {
            const parts: string[] = [];
            if (conversation.previousSearches?.length) {
                parts.push(`Previous searches: ${conversation.previousSearches.slice(-3).join(', ')}`);
            }
            if (conversation.recentMessages?.length) {
                const msgs = conversation.recentMessages.slice(-3)
                    .map(m => `${m.speaker}: ${m.content}`).join('\n');
                parts.push(`Recent messages:\n${msgs}`);
            }
            conversationContext = parts.join('\n');
        }
        const prompt = buildForUserPrompt([candidate], capsule, queryText, domain, undefined, conversationContext);
        const model = genAI.getGenerativeModel({
            model: 'gemini-2.0-flash',
            generationConfig: { responseMimeType: 'application/json', temperature: 0.4 },
        });
        const result = await model.generateContent(prompt);
        const parsed = parseForUserResponse(result.response.text());

        // Try exact match first, then fuzzy match (LLM sometimes alters item names)
        const exactMatch = parsed.personalizations[candidateName];
        if (exactMatch) return exactMatch;

        // Fuzzy: case-insensitive substring match on keys
        const nameLower = candidateName.toLowerCase();
        for (const [key, value] of Object.entries(parsed.personalizations)) {
            const keyLower = key.toLowerCase();
            if (keyLower.includes(nameLower) || nameLower.includes(keyLower)) {
                return value;
            }
        }

        // Last resort: if there's exactly one entry, it's probably for this candidate
        const entries = Object.entries(parsed.personalizations);
        if (entries.length === 1 && entries[0][1]) {
            return entries[0][1];
        }

        return `Recommended for ${capsule.members?.[0]?.name || 'you'}`;
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

    // Oversample: generate 50% more candidates than requested, emit only verified
    const maxResults = searchRequest.options?.maxResults || 4;
    const oversampleTarget = Math.ceil(maxResults * 1.5);

    let candidateCount = 0;
    let verifiedCount = 0;
    let skippedCount = 0;

    try {
        // Start streaming generation with oversample target
        const candidateStream = streamingGenerator!.generateStream({
            ...searchRequest,
            options: { ...searchRequest.options, maxResults: oversampleTarget },
        });

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
                    timeout: 5000,
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
                    genAI!,
                    searchRequest.conversation
                ),
            ]);

            // Skip unverified enrichment or failed summary (null = Gemini doesn't know this place)
            if (!enriched.verified || !summary) {
                skippedCount++;
                const reason = !enriched.verified ? 'unverified' : 'no summary';
                console.log(`[${requestId}] ⊘ Skipping: ${candidate.name} (${reason}, ${Date.now() - candidateStart}ms)`);
                continue;
            }

            verifiedCount++;

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

            // Stop once we have enough verified results
            if (verifiedCount >= maxResults) break;
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

        console.log(`[${requestId}] ✅ Stream complete: ${verifiedCount}/${candidateCount} verified, ${skippedCount} skipped (${totalMs}ms)`);

    } catch (error) {
        console.error(`[${requestId}] ❌ Stream error:`, error);
        sendSSE(res, {
            type: 'error',
            data: { message: error instanceof Error ? error.message : 'Stream failed' },
        });
    }

    res.end();
}
