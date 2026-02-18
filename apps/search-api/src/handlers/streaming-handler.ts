/**
 * Streaming Search Pipeline
 * 
 * Conveyor-belt processing: each candidate flows through
 * generation → enrichment → summary + personalization → SSE output.
 * 
 * Uses the same shared prompt functions as the batch path
 * (see /kalidasa-rules workflow for dual-path requirements).
 * 
 * IMPORTANT: The news domain is routed through NewsSearchEngine
 * (NewsMesh + Exa + Diffbot) instead of the generic StreamingCAOGenerator.
 * This ensures the full search-first pipeline is used for news.
 */

import type { Request, Response } from 'express';
import type { KalidasaSearchRequest, RawCAOCandidate, EnrichedCandidate } from '@kalidasa/types';
import { buildDisplayLabel, compositeKey } from '@kalidasa/types';
import { StreamingCAOGenerator, type StreamingCandidate } from '@kalidasa/cao-generator';
import { NewsSearchEngine } from '@kalidasa/cao-generator';
import { EventsSearchEngine, type RawEvent } from '@kalidasa/cao-generator';
import {
    buildSummaryPrompt, parseSummaryResponse,
    buildForUserPrompt, parseForUserResponse,
} from '@kalidasa/cao-generator';
import { StreamingEnricher, createHookRegistry, HookHealthMonitor, geocodeAddress } from '@kalidasa/enrichment';
import { generateSubheader } from '@kalidasa/merger';
import type { Stage1aCandidate } from '@kalidasa/cao-generator';

import { GoogleGenerativeAI } from '@google/generative-ai';

/**
 * Haversine distance between two lat/lng points in km.
 * Used for Q1: Places geo-validation (50km max from user).
 */
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2
        + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
        * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Generate summary for a single candidate using the shared prompt
 */
async function generateSummary(
    candidateName: string,
    queryText: string,
    domain: string,
    genAI: GoogleGenerativeAI,
    /** Optional context to ground the LLM (venue, date, description) */
    contextHint?: string
): Promise<string> {
    try {
        const candidate: Stage1aCandidate = {
            name: candidateName,
            identifiers: {},
            enrichment_hooks: [],
            // Attach context as search_hint so the prompt builder includes it
            search_hint: contextHint,
        };
        const prompt = buildSummaryPrompt([candidate], queryText, domain);
        const model = genAI.getGenerativeModel({
            model: 'gemini-2.0-flash',
            generationConfig: { responseMimeType: 'application/json', temperature: 0.7, maxOutputTokens: 256 },
        });
        const result = await model.generateContent(prompt);
        const parsed = parseSummaryResponse(result.response.text());

        // Index-based: single candidate is always "1"
        return parsed.summaries['1'] || '';
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
    conversation?: KalidasaSearchRequest['conversation'],
    /** Enrichment context for factual grounding — prevents venue/date hallucination */
    enrichmentContext?: Record<string, string>
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
        const prompt = buildForUserPrompt([candidate], capsule, queryText, domain, undefined, conversationContext, enrichmentContext);
        const model = genAI.getGenerativeModel({
            model: 'gemini-2.0-flash',
            generationConfig: { responseMimeType: 'application/json', temperature: 0.4, maxOutputTokens: 256 },
        });
        const result = await model.generateContent(prompt);
        const parsed = parseForUserResponse(result.response.text());

        // Index-based: single candidate is always "1"
        return parsed.personalizations['1'] || '';
    } catch {
        return '';
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
        reasoning?: { whyRecommended: string; pros: string[]; cons: string[] };
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
let healthMonitor: HookHealthMonitor | null = null;

function getStreamingServices() {
    if (!streamingGenerator) {
        streamingGenerator = new StreamingCAOGenerator();
    }
    if (!streamingEnricher) {
        const registry = createHookRegistry();
        streamingEnricher = new StreamingEnricher(registry);

        // Start background health monitoring (every 5 minutes)
        if (!healthMonitor) {
            healthMonitor = new HookHealthMonitor();
            healthMonitor.start(registry);
        }
    }
    if (!genAI) {
        genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

        // Register non-hook external dependency checks
        if (healthMonitor) {
            const ai = genAI;
            healthMonitor.registerExternalCheck('gemini', async () => {
                try {
                    const model = ai.getGenerativeModel({ model: 'gemini-2.0-flash' });
                    const result = await model.generateContent('Say "ok"');
                    return !!result.response.text();
                } catch {
                    return false;
                }
            });

            healthMonitor.registerExternalCheck('google_geocoding', async () => {
                const result = await geocodeAddress('Times Square, New York');
                return result !== null;
            });
        }
    }
    return { streamingGenerator, streamingEnricher, genAI };
}

/**
 * Handle news domain via the dedicated NewsSearchEngine pipeline.
 * Uses NewsMesh + Exa + Diffbot — bypasses LLM candidate generation entirely.
 * Batch LLM: 2 calls total (1 summary batch + 1 forUser batch) instead of 16.
 */
async function handleNewsStream(
    searchRequest: KalidasaSearchRequest,
    res: Response,
    requestId: string,
    startTime: number,
    genAI: GoogleGenerativeAI
): Promise<void> {
    console.log(`[${requestId}] 📰 News domain: using NewsSearchEngine (NewsMesh + Exa + Diffbot)`);

    const newsEngine = new NewsSearchEngine(genAI, 'gemini-2.0-flash');
    const maxResults = searchRequest.options?.maxResults || 8;

    // Run the full news search pipeline
    const { mode, candidates: newsCandidates, clusters } = await newsEngine.search(
        searchRequest.query.text,
        maxResults
    );

    console.log(`[${requestId}] 📰 NewsSearchEngine returned ${newsCandidates.length} candidates (mode=${mode})`);

    if (newsCandidates.length === 0) {
        console.error(`[${requestId}] 🚨 NewsSearchEngine returned 0 candidates — check NewsMesh/Exa API keys`);
        sendSSE(res, {
            type: 'bundle',
            data: {
                headline: 'No news articles found',
                summary: `No relevant articles found for "${searchRequest.query.text}"`,
                count: 0,
            },
        });
        sendSSE(res, {
            type: 'done',
            data: { totalMs: Date.now() - startTime, count: 0 },
        });
        return;
    }

    // Build conversation context for forUser
    let conversationContext: string | undefined;
    if (searchRequest.conversation?.recentMessages?.length || searchRequest.conversation?.previousSearches?.length) {
        const parts: string[] = [];
        if (searchRequest.conversation.previousSearches?.length) {
            parts.push(`Previous searches: ${searchRequest.conversation.previousSearches.slice(-3).join(', ')}`);
        }
        if (searchRequest.conversation.recentMessages?.length) {
            const msgs = searchRequest.conversation.recentMessages.slice(-3)
                .map(m => `${m.speaker}: ${m.content}`).join('\n');
            parts.push(`Recent messages:\n${msgs}`);
        }
        conversationContext = parts.join('\n');
    }

    // Batch LLM: 2 calls instead of 16 (1 summary + 1 forUser)
    const model = genAI.getGenerativeModel({
        model: 'gemini-2.0-flash',
        generationConfig: { responseMimeType: 'application/json', temperature: 0.7 },
    });
    const forUserModel = genAI.getGenerativeModel({
        model: 'gemini-2.0-flash',
        generationConfig: { responseMimeType: 'application/json', temperature: 0.4 },
    });

    const summaryPrompt = buildSummaryPrompt(newsCandidates, searchRequest.query.text, 'news', mode as any, clusters as any);
    const forUserPrompt = buildForUserPrompt(newsCandidates, searchRequest.capsule, searchRequest.query.text, 'news', mode as any, conversationContext);

    const [summaryResult, forUserResult] = await Promise.all([
        model.generateContent(summaryPrompt).then(r => parseSummaryResponse(r.response.text())).catch(() => ({ summaries: {} as Record<string, string> })),
        forUserModel.generateContent(forUserPrompt).then(r => parseForUserResponse(r.response.text())).catch(() => ({ personalizations: {} as Record<string, string> })),
    ]);

    console.log(`[${requestId}] 📰 Batch LLM complete: ${Object.keys(summaryResult.summaries).length} summaries, ${Object.keys(forUserResult.personalizations).length} personalizations`);

    // Emit each candidate with matched summary + forUser
    for (let ni = 0; ni < newsCandidates.length; ni++) {
        const candidate = newsCandidates[ni];
        const newsData = (candidate as any)._newsEnrichment;
        const idx = String(ni + 1);

        // Index-based matching
        const summary = summaryResult.summaries[idx] || '';
        const forUser = forUserResult.personalizations[idx] || '';

        // Q2: Derive whyRecommended from forUser's first sentence
        const whyRecommended = forUser ? (forUser.split(/[.!?]\s/)[0] + '.') : '';

        sendSSE(res, {
            type: 'candidate',
            data: {
                name: candidate.name,
                subheader: newsData?.source
                    ? `${newsData.source}${newsData.publishedAt ? ' · ' + new Date(newsData.publishedAt).toLocaleDateString() : ''}`
                    : undefined,
                summary: summary || newsData?.summary || '',
                personalization: { forUser },
                reasoning: { whyRecommended, pros: [], cons: [] },
                enrichment: {
                    verified: true,
                    source: 'news_composite',
                    news: newsData,
                },
                verified: true,
            },
        });

        console.log(`[${requestId}] → Streamed news: ${candidate.name.substring(0, 60)}`);
    }

    // Bundle
    sendSSE(res, {
        type: 'bundle',
        data: {
            headline: `${newsCandidates.length} news articles found`,
            summary: `Found ${newsCandidates.length} articles from verified sources for "${searchRequest.query.text}"`,
            count: newsCandidates.length,
        },
    });

    // Done
    const totalMs = Date.now() - startTime;
    sendSSE(res, {
        type: 'done',
        data: { totalMs, count: newsCandidates.length },
    });

    console.log(`[${requestId}] ✅ News stream complete: ${newsCandidates.length} articles, 2 LLM calls (${totalMs}ms)`);
}

/**
 * Handle events domain via the dedicated EventsSearchEngine pipeline.
 * Pipelines results as each API stream completes for optimal T4:
 * - Ticketmaster (~2s) → emit immediately with per-candidate LLM
 * - Grounded search (~5s) → dedup + emit
 * - LLM festivals (~3s) → dedup + emit  
 * - SerpApi (~1s) → dedup + emit
 */
async function handleEventsStream(
    searchRequest: KalidasaSearchRequest,
    res: Response,
    requestId: string,
    startTime: number,
    genAI: GoogleGenerativeAI
): Promise<void> {
    console.log(`[${requestId}] 🎫 Events domain: using pipelined EventsSearchEngine`);

    const eventsEngine = new EventsSearchEngine(genAI, 'gemini-2.0-flash');
    const maxResults = searchRequest.options?.maxResults || 8;
    const city = searchRequest.logistics?.searchLocation?.city || '';
    const timeWindow = eventsEngine.computeTimeWindow(searchRequest.logistics?.time?.localTime);

    // Track emitted events for cross-stream dedup
    const emittedNames = new Set<string>();
    let emittedCount = 0;

    // Build conversation context once for reuse
    let conversationContext: string | undefined;
    if (searchRequest.conversation?.recentMessages?.length || searchRequest.conversation?.previousSearches?.length) {
        const parts: string[] = [];
        if (searchRequest.conversation.previousSearches?.length) {
            parts.push(`Previous searches: ${searchRequest.conversation.previousSearches.slice(-3).join(', ')}`);
        }
        if (searchRequest.conversation.recentMessages?.length) {
            const msgs = searchRequest.conversation.recentMessages.slice(-3)
                .map(m => `${m.speaker}: ${m.content}`).join('\n');
            parts.push(`Recent messages:\n${msgs}`);
        }
        conversationContext = parts.join('\n');
    }

    /**
     * Process a single event: LLM filter → summary + forUser → emit SSE.
     * Returns true if emitted, false if filtered out.
     */
    const processAndEmit = async (event: RawEvent): Promise<boolean> => {
        if (emittedCount >= maxResults) return false;

        // Dedup check
        const normalizedName = eventsEngine.normalizeEventName(event.name);
        if (emittedNames.has(normalizedName)) return false;
        emittedNames.add(normalizedName);

        // LLM filter: is this event appropriate for the query?
        const isRelevant = await filterEvent(event, searchRequest.query.text, city, genAI);
        if (!isRelevant) {
            console.log(`[${requestId}] 🚫 Filtered out: ${event.name}`);
            return false;
        }

        if (emittedCount >= maxResults) return false; // Re-check after async filter

        // Build factual context from event metadata — grounds the LLM
        const contextParts: string[] = [];
        if (event.venue) contextParts.push(`Venue: ${event.venue}`);
        if (event.venueAddress) contextParts.push(`Address: ${event.venueAddress}`);
        if (event.startDate) contextParts.push(`Date: ${event.startDate}`);
        if (event.description) contextParts.push(`Description: ${event.description.substring(0, 300)}`);
        // Always include city as minimum context for the LLM
        if (contextParts.length === 0 && city) contextParts.push(`City: ${city}`);
        const contextHint = contextParts.length > 0 ? contextParts.join(' | ') : undefined;

        // Build enrichment context for forUser — prevents venue/date hallucination
        const forUserContext: Record<string, string> = {};
        if (contextHint) forUserContext[event.name] = contextHint;

        // Generate summary + forUser + image (if missing) in parallel
        // Image resolution has a 1.5s timeout to never block emission
        const imageWithTimeout = event.imageUrl
            ? Promise.resolve(event.imageUrl)
            : Promise.race([
                eventsEngine.findEventImage(event.name, city, event.sourceUrls),
                new Promise<null>(resolve => setTimeout(() => resolve(null), 1500)),
            ]);
        const [summary, forUser, resolvedImage] = await Promise.all([
            generateSummary(event.name, searchRequest.query.text, 'events', genAI, contextHint),
            generateForUser(event.name, searchRequest.query.text, 'events', searchRequest.capsule, genAI, searchRequest.conversation, forUserContext),
            imageWithTimeout,
        ]);

        // NEVER emit an empty, refusal, or stub summary — fallback chain
        let finalSummary = summary;
        const isRefusal = finalSummary && /don't have enough|need more context|unable to summarize|cannot provide/i.test(finalSummary);
        // Catch stubs: empty, refusal, or just the event name echoed back (under 50 useful chars)
        const isStub = finalSummary && finalSummary.trim().length < 50 && finalSummary.replace(/[.!?,;:\s]/g, '').length < 40;
        const isNameEcho = finalSummary && finalSummary.replace(/[.!?,;:\s]/g, '').toLowerCase() === event.name.replace(/[.!?,;:\s]/g, '').toLowerCase();
        if (!finalSummary || finalSummary.trim().length === 0 || isRefusal || isStub || isNameEcho) {
            if (event.description && event.description.trim().length > 0) {
                // Use event description as fallback
                finalSummary = event.description.length > 300
                    ? event.description.substring(0, 297) + '...'
                    : event.description;
            } else {
                // Last resort: build from metadata
                const fallbackParts = [event.name];
                if (event.venue) fallbackParts.push(`at ${event.venue}`);
                if (event.startDate) {
                    try {
                        const d = new Date(event.startDate);
                        if (!isNaN(d.getTime())) {
                            fallbackParts.push(`on ${d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`);
                        }
                    } catch { }
                }
                finalSummary = fallbackParts.join(' ') + '.';
            }
            console.log(`[${requestId}] ⚠️ Empty summary for "${event.name}" — used fallback`);
        }

        if (emittedCount >= maxResults) return false; // Re-check after async LLM

        // Build enrichment data
        const enrichment = {
            verified: true,
            source: 'events_composite',
            events: {
                venue: event.venue,
                venueAddress: event.venueAddress,
                startDate: event.startDate,
                endDate: event.endDate,
                ticketUrl: event.ticketUrl,
                priceRange: event.priceRange,
                imageUrl: resolvedImage || event.imageUrl || undefined,
                description: event.description,
                status: event.status,
            },
        };

        // Build subheader: "Venue · Date" or just date
        let subheader: string | undefined;
        const parts: string[] = [];
        if (event.venue) parts.push(event.venue);
        if (event.startDate) {
            try {
                const d = new Date(event.startDate);
                if (!isNaN(d.getTime())) {
                    parts.push(d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
                } else {
                    parts.push(event.startDate);
                }
            } catch {
                parts.push(event.startDate);
            }
        }
        if (parts.length > 0) subheader = parts.join(' · ');

        const whyRecommended = forUser ? (forUser.split(/[.!?]\s/)[0] + '.') : '';

        sendSSE(res, {
            type: 'candidate',
            data: {
                name: event.name,
                subheader,
                summary: finalSummary,
                personalization: { forUser },
                reasoning: { whyRecommended, pros: [], cons: [] },
                enrichment,
                verified: true,
            },
        });

        emittedCount++;
        console.log(`[${requestId}] → Streamed event #${emittedCount}: ${event.name} (${Date.now() - startTime}ms)`);
        return true;
    };

    /**
     * Pre-filter: remove obvious garbage entries before expensive LLM filter.
     * Grounded search commonly returns parsing artifacts like "Date/time:" etc.
     */
    const preFilterEvents = (events: RawEvent[]): RawEvent[] => {
        const garbagePatterns = [
            /^date\/time:?$/i,
            /^venue\s*(or\s*location)?:?$/i,
            /^brief\s*description:?$/i,
            /^location:?$/i,
            /^description:?$/i,
            /^\d+\.\s*$/,   // Just a number "1."
            /^event\s*name:?$/i,
        ];
        return events.filter(e => {
            if (!e.name || e.name.length < 4) return false;
            if (garbagePatterns.some(p => p.test(e.name.trim()))) return false;
            return true;
        });
    };

    // Time budget: stop processing after 20s to avoid tail dragging
    const TIME_BUDGET_MS = 20_000;
    const isOverBudget = () => (Date.now() - startTime) > TIME_BUDGET_MS;

    /**
     * Process a batch of events from a stream result, emitting as each completes.
     * Uses concurrency=4 for faster slot filling.
     */
    const processStreamResults = async (events: RawEvent[], streamLabel: string): Promise<void> => {
        if (events.length === 0 || emittedCount >= maxResults) return;

        // Pre-filter garbage before expensive LLM calls
        const cleaned = preFilterEvents(events);
        const filtered = events.length - cleaned.length;
        console.log(`[${requestId}] 🎫 Processing ${streamLabel}: ${cleaned.length} events${filtered ? ` (${filtered} pre-filtered)` : ''}`);

        // Process in groups of 4 for higher throughput
        for (let i = 0; i < cleaned.length && emittedCount < maxResults; i += 4) {
            if (isOverBudget()) {
                console.log(`[${requestId}] ⏰ Time budget exceeded (${Date.now() - startTime}ms), stopping candidate processing`);
                break;
            }
            const batch = cleaned.slice(i, i + 4);
            await Promise.all(batch.map(e => processAndEmit(e)));
        }
    };

    // ---- Fire all 4 API streams in parallel, process results as they arrive ----
    // Use a racing pattern: process each stream's results as its Promise settles

    const stream1Promise = eventsEngine.searchTicketmaster(
        searchRequest.query.text, city, searchRequest.logistics?.searchLocation?.coordinates, timeWindow
    );
    const stream2aPromise = eventsEngine.searchKnownFestivals(
        searchRequest.query.text, city, timeWindow
    );
    const stream2bPromise = eventsEngine.searchGroundedEvents(
        searchRequest.query.text, city, timeWindow
    );
    const stream3Promise = eventsEngine.searchSerpApi(
        searchRequest.query.text, city
    );

    // Wrap each stream with its label for racing
    const streams = [
        { promise: stream1Promise.catch(() => [] as RawEvent[]), label: 'Ticketmaster' },
        { promise: stream2aPromise.catch(() => [] as RawEvent[]), label: 'LLM+Wikipedia' },
        { promise: stream2bPromise.catch(() => [] as RawEvent[]), label: 'Grounded Search' },
        { promise: stream3Promise.catch(() => [] as RawEvent[]), label: 'SerpApi' },
    ];

    // Race: process each stream as it resolves
    const pending = new Set(streams.map((s, i) => i));
    const wrapped = streams.map((s, i) =>
        s.promise.then(events => ({ index: i, events, label: s.label }))
    );

    while (pending.size > 0 && emittedCount < maxResults && !isOverBudget()) {
        // Race all pending streams
        const result = await Promise.race(
            [...pending].map(i => wrapped[i])
        );

        pending.delete(result.index);
        console.log(`[${requestId}] 🎫 ${result.label} resolved: ${result.events.length} events (${Date.now() - startTime}ms)`);

        // Process this stream's results immediately
        await processStreamResults(result.events, result.label);
    }

    if (isOverBudget() && emittedCount < maxResults) {
        console.log(`[${requestId}] ⏰ Time budget reached with ${emittedCount}/${maxResults} results`);
    }

    // Bundle + Done
    sendSSE(res, {
        type: 'bundle',
        data: {
            headline: `${emittedCount} events found`,
            summary: `Found ${emittedCount} events for "${searchRequest.query.text}" in ${city || 'your area'}`,
            count: emittedCount,
        },
    });

    const totalMs = Date.now() - startTime;
    sendSSE(res, {
        type: 'done',
        data: { totalMs, count: emittedCount },
    });

    console.log(`[${requestId}] ✅ Events stream complete: ${emittedCount} events (${totalMs}ms)`);
}

/**
 * LLM filter: determine if an event is relevant to the user's query.
 * Quick, lightweight check — rejects vague/generic entries.
 */
async function filterEvent(
    event: RawEvent,
    queryText: string,
    city: string,
    genAI: GoogleGenerativeAI
): Promise<boolean> {
    // Auto-pass: ticketed events from Ticketmaster are pre-filtered by API
    if (event.source === 'ticketmaster') return true;

    // Auto-reject: events with no name or extremely short names
    if (!event.name || event.name.length < 3) return false;

    // Auto-reject: vague category-style names (not actual events)
    const vaguePatterns = [
        /^(valentine'?s?\s+day|christmas|new year'?s?|halloween)\s*(events?|celebrations?)?$/i,
        /\b(celebrations?|events?)\s*$/i,
        /^[a-z\s]+(month|week|day)\s+(celebrations?|events?|observances?)$/i,
    ];
    if (vaguePatterns.some(p => p.test(event.name.trim()))) return false;

    // LLM filter for remaining events (grounded search, LLM festivals)
    try {
        const model = genAI.getGenerativeModel({
            model: 'gemini-2.0-flash',
            generationConfig: {
                responseMimeType: 'application/json',
                temperature: 0.1,
                maxOutputTokens: 32,
            },
        });

        const prompt = `Is "${event.name}" a specific, named event or an vague aggregate category?
Answer {"relevant": true} if it is a SPECIFIC event (even if not perfectly matching the query).
Answer {"relevant": false} ONLY if it is a vague aggregate like "Valentine's Day Events" or "History Month Celebrations".

Examples:
- "Austin Marathon" → true (specific named event)
- "Rodeo Austin" → true (specific named event)
- "Valentine's Day Events" → false (vague aggregate)
- "Texas Black History Month Celebrations" → false (vague aggregate)
- "SXSW" → true (specific named event)`;

        const result = await model.generateContent(prompt);
        const parsed = JSON.parse(result.response.text());
        return parsed.relevant === true;
    } catch {
        // On filter error, let the event through (fail-open)
        return true;
    }
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

    console.log(`[${requestId}] 🔄 Streaming search: "${searchRequest.query.text}" (domain=${searchRequest.query.domain})`);

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.flushHeaders();

    const { streamingGenerator, streamingEnricher, genAI } = getStreamingServices();

    try {
        // ==== NEWS DOMAIN: Search-first pipeline via NewsSearchEngine ====
        if (searchRequest.query.domain === 'news') {
            await handleNewsStream(searchRequest, res, requestId, startTime, genAI!);
            res.end();
            return;
        }

        // ==== EVENTS DOMAIN: Search-first pipeline via EventsSearchEngine ====
        if (searchRequest.query.domain === 'events') {
            await handleEventsStream(searchRequest, res, requestId, startTime, genAI!);
            res.end();
            return;
        }

        // ==== ALL OTHER DOMAINS: Standard streaming pipeline ====

        // Oversample: generate extra candidates, emit only verified.
        const maxResults = searchRequest.options?.maxResults || 4;
        const oversampleTarget = Math.ceil(maxResults * 2);
        const enrichTimeout = 5000;

        // Start streaming generation with oversample target
        const candidateStream = streamingGenerator!.generateStream({
            ...searchRequest,
            options: { ...searchRequest.options, maxResults: oversampleTarget },
        });

        // ==== ALL REMAINING DOMAINS: Pipelined conveyor belt (concurrency=2) ====
        // L2: Process 2 candidates concurrently for ~40% T4 improvement.
        // Each candidate still runs enrichment+summary+forUser in parallel.
        let candidateCount = 0;
        let verifiedCount = 0;
        let skippedCount = 0;
        const CONCURRENCY = 2;

        // Process a single candidate through the full pipeline
        const processCandidate = async (candidate: StreamingCandidate): Promise<{
            candidate: StreamingCandidate;
            enriched: { verified: boolean; enrichment?: any };
            summary: string;
            forUser: string;
            startMs: number;
        } | null> => {
            const candidateStart = Date.now();
            const rawCandidate: RawCAOCandidate = {
                name: candidate.name,
                type: 'entity',
                summary: '',
                identifiers: candidate.identifiers,
                enrichment_hooks: candidate.enrichment_hooks,
                search_hint: candidate.search_hint,
            };

            // 3-way parallel: enrichment + summary + forUser
            // Use display label (with identifiers) for LLM to produce deterministic keys
            const displayLabel = buildDisplayLabel(searchRequest.query.domain || 'general', candidate);
            const [enriched, summary, forUser] = await Promise.all([
                streamingEnricher!.enrichOne(rawCandidate, {
                    timeout: enrichTimeout,
                    requestId,
                    searchLocation: searchRequest.logistics.searchLocation,
                }),
                generateSummary(
                    displayLabel,
                    searchRequest.query.text,
                    searchRequest.query.domain,
                    genAI!
                ),
                generateForUser(
                    displayLabel,
                    searchRequest.query.text,
                    searchRequest.query.domain,
                    searchRequest.capsule,
                    genAI!,
                    searchRequest.conversation
                ),
            ]);

            if (!enriched.verified || !summary) {
                const reason = !enriched.verified ? 'unverified' : 'no summary';
                console.log(`[${requestId}] ⊘ Skipping: ${candidate.name} (${reason}, ${Date.now() - candidateStart}ms)`);
                return null;
            }

            // Q1: Haversine geo-validation for Places (50km max)
            if (searchRequest.query.domain === 'places') {
                const userCoords = searchRequest.logistics.searchLocation?.coordinates;
                const placeLocation = (enriched.enrichment as any)?.places?.location;
                if (userCoords && placeLocation?.lat && placeLocation?.lng) {
                    const distKm = haversineKm(userCoords.lat, userCoords.lng, placeLocation.lat, placeLocation.lng);
                    if (distKm > 50) {
                        console.log(`[${requestId}] ⊘ Geo-filter: ${candidate.name} is ${distKm.toFixed(0)}km away (max 50km)`);
                        return null;
                    }
                }
            }

            return { candidate, enriched, summary, forUser, startMs: candidateStart };
        };

        // Sliding window: keep up to CONCURRENCY candidates in-flight
        type CandidateResult = Awaited<ReturnType<typeof processCandidate>>;
        const inFlight: Promise<CandidateResult>[] = [];

        const emitResult = (result: Awaited<ReturnType<typeof processCandidate>>) => {
            if (!result) {
                skippedCount++;
                return;
            }
            verifiedCount++;
            const { candidate, enriched, summary, forUser, startMs } = result;

            // Q2: Derive whyRecommended from forUser's first sentence
            const whyRecommended = forUser ? (forUser.split(/[.!?]\s/)[0] + '.') : '';

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
                    reasoning: { whyRecommended, pros: [], cons: [] },
                    enrichment: enriched.enrichment,
                    verified: enriched.verified,
                },
            });
            console.log(`[${requestId}] → Streamed ${candidate.name} (${Date.now() - startMs}ms)`);
        };

        // Composite key deduplication
        const seenKeys = new Set<string>();
        const domain = searchRequest.query.domain || 'general';

        for await (const candidate of candidateStream) {
            if (verifiedCount >= maxResults) break;

            // Dedup via composite key
            const key = compositeKey(domain, candidate);
            if (seenKeys.has(key)) {
                console.log(`[${requestId}] ⊘ Dedup: skipping duplicate ${key}`);
                continue;
            }
            seenKeys.add(key);

            candidateCount++;

            // Launch candidate processing
            inFlight.push(processCandidate(candidate));

            // When window is full, wait for the first to finish and emit
            if (inFlight.length >= CONCURRENCY) {
                const result = await inFlight.shift()!;
                emitResult(result);
            }
        }

        // Drain remaining in-flight candidates
        for (const pending of inFlight) {
            if (verifiedCount >= maxResults) break;
            const result = await pending;
            emitResult(result);
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
