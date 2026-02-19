/**
 * Events Search Engine
 *
 * Search-first events pipeline that discovers real events from APIs,
 * then lets the LLM rank and personalize them. Three parallel streams:
 *
 * Stream 1: Ticketmaster — broad search for ticketed events (concerts, sports, theater)
 * Stream 2: Public celebrations (hybrid):
 *   2a: LLM generates known festivals/celebrations → Wikipedia enrichment
 *   2b: Gemini grounded search for current local events
 * Stream 3: SerpApi Google Events (nice-to-have, quota-limited)
 *
 * Used by TwoStageGenerator.runEventsPipeline() to bypass LLM candidate generation.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import type { Stage1aCandidate } from './stage-1a-prompt.js';

// ============================================================================
// Types
// ============================================================================

export interface RawEvent {
    name: string;
    venue?: string;
    venueAddress?: string;
    venueLatitude?: number;
    venueLongitude?: number;
    startDate?: string;
    endDate?: string;
    ticketUrl?: string;
    priceRange?: string;
    imageUrl?: string;
    description?: string;
    status?: string;
    source: 'ticketmaster' | 'serpapi' | 'grounded_search' | 'llm_wikipedia';
    eventType: 'ticketed' | 'festival' | 'community' | 'public';
    /** URLs from grounding metadata — used for og:image scraping */
    sourceUrls?: string[];
}

export interface EventsSearchResult {
    candidates: Stage1aCandidate[];
    rawEvents: RawEvent[];
}

// ============================================================================
// Events Search Engine
// ============================================================================

export class EventsSearchEngine {
    private genAI: GoogleGenerativeAI;
    private model: string;
    private ticketmasterKey: string;
    private serpApiKey: string;

    constructor(genAI: GoogleGenerativeAI, model: string) {
        this.genAI = genAI;
        this.model = model;
        this.ticketmasterKey = process.env.TICKETMASTER_CONSUMER_KEY || '';
        this.serpApiKey = process.env.SERPAPI_API_KEY || '';
    }

    /**
     * Full events search pipeline:
     * 1. Fan out to all three streams in parallel
     * 2. Merge + deduplicate
     * 3. LLM ranking (select top N, rank by fit for user)
     * 4. Return as Stage1aCandidates with pre-attached enrichment
     */
    async search(
        queryText: string,
        location: { city?: string; coordinates?: { lat: number; lng: number } },
        timeContext: { localTime?: string },
        maxResults: number
    ): Promise<EventsSearchResult> {
        console.log(`[EventsSearch] Starting search: "${queryText}" in ${location.city || 'unknown'}`);

        const city = location.city || '';
        const timeWindow = this.computeTimeWindow(timeContext.localTime);

        // ---- Fan out to all streams in parallel ----
        const [stream1, stream2a, stream2b, stream3] = await Promise.allSettled([
            this.searchTicketmaster(queryText, city, location.coordinates, timeWindow),
            this.searchKnownFestivals(queryText, city, timeWindow),
            this.searchGroundedEvents(queryText, city, timeWindow),
            this.searchSerpApi(queryText, city),
        ]);

        // Collect results from each stream
        const allEvents: RawEvent[] = [];

        if (stream1.status === 'fulfilled') {
            console.log(`[EventsSearch] Stream 1 (Ticketmaster): ${stream1.value.length} events`);
            allEvents.push(...stream1.value);
        } else {
            console.warn(`[EventsSearch] Stream 1 (Ticketmaster) failed:`, stream1.reason);
        }

        if (stream2a.status === 'fulfilled') {
            console.log(`[EventsSearch] Stream 2a (LLM festivals): ${stream2a.value.length} events`);
            allEvents.push(...stream2a.value);
        } else {
            console.warn(`[EventsSearch] Stream 2a (LLM festivals) failed:`, stream2a.reason);
        }

        if (stream2b.status === 'fulfilled') {
            console.log(`[EventsSearch] Stream 2b (Grounded search): ${stream2b.value.length} events`);
            allEvents.push(...stream2b.value);
        } else {
            console.warn(`[EventsSearch] Stream 2b (Grounded search) failed:`, stream2b.reason);
        }

        if (stream3.status === 'fulfilled') {
            console.log(`[EventsSearch] Stream 3 (SerpApi): ${stream3.value.length} events`);
            allEvents.push(...stream3.value);
        } else {
            console.warn(`[EventsSearch] Stream 3 (SerpApi) failed:`, stream3.reason);
        }

        console.log(`[EventsSearch] Total raw events: ${allEvents.length}`);

        if (allEvents.length === 0) {
            return { candidates: [], rawEvents: [] };
        }

        // ---- Deduplicate by name similarity ----
        const deduped = this.deduplicateEvents(allEvents);
        console.log(`[EventsSearch] After dedup: ${deduped.length} unique events`);

        // ---- LLM ranking: select top N, rank by fit for query ----
        const ranked = await this.rankEvents(deduped, queryText, city, maxResults);
        console.log(`[EventsSearch] After ranking: ${ranked.length} events`);

        // ---- Convert to Stage1aCandidates with pre-attached enrichment ----
        const candidates = this.toCandidates(ranked);

        return { candidates, rawEvents: ranked };
    }

    // ========================================================================
    // Stream 1: Ticketmaster broad search
    // ========================================================================

    public async searchTicketmaster(
        queryText: string,
        city: string,
        coordinates?: { lat: number; lng: number },
        timeWindow?: { start: string; end: string }
    ): Promise<RawEvent[]> {
        if (!this.ticketmasterKey) {
            console.warn('[EventsSearch:TM] No Ticketmaster API key');
            return [];
        }

        try {
            const params = new URLSearchParams({
                apikey: this.ticketmasterKey,
                size: '20',
                sort: 'date,asc',
            });

            // Use query terms as keyword
            const keywords = this.extractEventKeywords(queryText);
            if (keywords) params.set('keyword', keywords);

            // Location
            if (city) params.set('city', city);
            if (coordinates) {
                params.set('latlong', `${coordinates.lat},${coordinates.lng}`);
            }

            // Time window
            if (timeWindow) {
                params.set('startDateTime', timeWindow.start);
                params.set('endDateTime', timeWindow.end);
            }

            const url = `https://app.ticketmaster.com/discovery/v2/events.json?${params.toString()}`;
            const response = await fetch(url);

            if (!response.ok) {
                console.warn(`[EventsSearch:TM] API error: ${response.status}`);
                return [];
            }

            const data = await response.json();
            const events = data._embedded?.events || [];

            return events.map((e: any): RawEvent => {
                const venue = e._embedded?.venues?.[0];
                const prices = e.priceRanges?.[0];
                return {
                    name: e.name,
                    venue: venue?.name,
                    venueAddress: venue?.address?.line1
                        ? `${venue.address.line1}, ${venue.city?.name}, ${venue.state?.stateCode}`
                        : undefined,
                    venueLatitude: venue?.location?.latitude
                        ? parseFloat(venue.location.latitude) : undefined,
                    venueLongitude: venue?.location?.longitude
                        ? parseFloat(venue.location.longitude) : undefined,
                    startDate: e.dates?.start?.dateTime || e.dates?.start?.localDate,
                    ticketUrl: e.url,
                    priceRange: prices
                        ? `$${prices.min} - $${prices.max}`
                        : undefined,
                    imageUrl: e.images?.[0]?.url,
                    status: e.dates?.status?.code,
                    source: 'ticketmaster',
                    eventType: 'ticketed',
                };
            });
        } catch (error) {
            console.error('[EventsSearch:TM] Error:', error);
            return [];
        }
    }

    // ========================================================================
    // Stream 2a: LLM generates known festivals → Wikipedia enrichment
    // ========================================================================

    public async searchKnownFestivals(
        queryText: string,
        city: string,
        timeWindow?: { start: string; end: string }
    ): Promise<RawEvent[]> {
        if (!city) return [];

        try {
            // Phase 1: LLM generates known festivals/celebrations
            const month = timeWindow?.start
                ? new Date(timeWindow.start).toLocaleString('en-US', { month: 'long', year: 'numeric' })
                : new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' });

            const prompt = `List major public festivals, celebrations, parades, food festivals, art walks, cultural events, and community traditions happening in ${city} during ${month}.

Include:
- Annual recurring festivals (e.g., SXSW, Mardi Gras, cherry blossom festivals)
- Seasonal celebrations (holiday markets, 4th of July fireworks)
- Well-known weekly/monthly events (night markets, art walks, farmers markets)
- Cultural and heritage celebrations

Only include events you are confident actually occur in ${city} during this time period.
Do NOT invent events.

Return JSON array (no markdown):
[{"name": "Event Name", "typical_dates": "e.g. March 7-16", "type": "festival|parade|market|cultural|community|holiday", "description": "1-2 sentence description"}]`;

            const model = this.genAI.getGenerativeModel({
                model: this.model,  // gemini-2.0-flash — fast
                generationConfig: {
                    responseMimeType: 'application/json',
                    temperature: 0.3,  // Low temp for factuality
                },
            });

            const result = await model.generateContent(prompt);
            const text = result.response.text();

            let llmEvents: Array<{
                name: string;
                typical_dates?: string;
                type?: string;
                description?: string;
            }>;

            try {
                llmEvents = JSON.parse(text);
                if (!Array.isArray(llmEvents)) llmEvents = [];
            } catch {
                console.warn('[EventsSearch:LLM] Failed to parse LLM response');
                return [];
            }

            console.log(`[EventsSearch:LLM] Generated ${llmEvents.length} festival candidates`);

            // Phase 2: Verify/enrich each with Wikipedia (in parallel)
            const wikiResults = await Promise.allSettled(
                llmEvents.map(e => this.enrichWithWikipedia(e.name, city))
            );

            return llmEvents.map((e, i): RawEvent => {
                const wikiData = wikiResults[i].status === 'fulfilled'
                    ? wikiResults[i].value
                    : null;

                return {
                    name: e.name,
                    startDate: e.typical_dates,
                    description: wikiData?.extract || e.description,
                    imageUrl: wikiData?.imageUrl,
                    ticketUrl: wikiData?.url,
                    source: 'llm_wikipedia',
                    eventType: e.type === 'market' || e.type === 'community'
                        ? 'community'
                        : 'festival',
                };
            });
        } catch (error) {
            console.error('[EventsSearch:LLM] Error:', error);
            return [];
        }
    }

    /**
     * Look up an event on Wikipedia for description, image, and URL.
     */
    private async enrichWithWikipedia(
        eventName: string,
        city: string
    ): Promise<{ extract?: string; imageUrl?: string; url?: string } | null> {
        try {
            // Try with city context first, then without
            const queries = [
                `${eventName} ${city}`,
                eventName,
            ];

            for (const query of queries) {
                const searchUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`;
                const response = await fetch(searchUrl);

                if (!response.ok) continue;

                const data = await response.json();
                if (data.type === 'disambiguation') continue;

                // Check if it's event-related
                const extract = (data.extract || '').toLowerCase();
                const eventIndicators = [
                    'festival', 'event', 'celebration', 'parade', 'fair',
                    'market', 'carnival', 'convention', 'conference', 'exhibition',
                    'annual', 'held', 'takes place', 'occurring',
                ];
                const isEvent = eventIndicators.some(w => extract.includes(w));
                if (!isEvent) continue;

                return {
                    extract: data.extract?.substring(0, 300),
                    imageUrl: data.thumbnail?.source,
                    url: data.content_urls?.desktop?.page,
                };
            }

            return null;
        } catch {
            return null;
        }
    }

    // ========================================================================
    // Stream 2b: Gemini grounded search for current local events
    // ========================================================================

    public async searchGroundedEvents(
        queryText: string,
        city: string,
        timeWindow?: { start: string; end: string }
    ): Promise<RawEvent[]> {
        if (!city) return [];

        try {
            const timePhrase = timeWindow
                ? `between ${new Date(timeWindow.start).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })} and ${new Date(timeWindow.end).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`
                : 'this week';

            const prompt = `Search the web for upcoming events, festivals, concerts, shows, community events, and things to do in ${city} ${timePhrase}.

Focus on:
- Public festivals, parades, and celebrations
- Community events (art walks, food truck rallies, night markets, farmers markets)
- Cultural events and exhibitions
- Free or public events that wouldn't appear on Ticketmaster

For each event, provide:
1. Event name
2. Date/time
3. Venue or location
4. Brief description (1 sentence)

List at least 10 events if available. Be specific — include real event names, not generic descriptions.`;

            const model = this.genAI.getGenerativeModel({
                model: 'gemini-2.5-flash',
                generationConfig: { temperature: 0.3 },
                tools: [{ google_search: {} } as any],
            });

            const result = await model.generateContent(prompt);
            const text = result.response.text();

            // Extract events from the grounded response text
            const events = this.parseGroundedEvents(text, city);

            // Also extract URLs from grounding metadata
            const groundingMeta = (result.response as any).candidates?.[0]?.groundingMetadata;
            const groundingUrls = this.extractGroundingUrls(groundingMeta);

            // Attach grounding URLs to events for downstream image resolution
            const allUrls = groundingUrls.map(u => u.url);
            for (const event of events) {
                // Attach ALL grounding URLs for og:image scraping later
                event.sourceUrls = allUrls;

                if (!event.ticketUrl && groundingUrls.length > 0) {
                    // Try to find a URL that mentions this event
                    const relevant = groundingUrls.find(u =>
                        event.name.split(' ').some(w =>
                            w.length > 3 && u.title?.toLowerCase().includes(w.toLowerCase())
                        )
                    );
                    if (relevant) event.ticketUrl = relevant.url;
                }
            }

            return events;
        } catch (error) {
            console.error('[EventsSearch:Grounded] Error:', error);
            return [];
        }
    }

    /**
     * Parse the grounded search response text into structured events.
     * The text is unstructured natural language — we extract event-like entries.
     */
    private parseGroundedEvents(text: string, city: string): RawEvent[] {
        const events: RawEvent[] = [];
        const lines = text.split('\n');

        // Look for patterns like:
        // "1. **Event Name** - Date - Venue - Description"
        // "- **Event Name**: Description"
        // "Event Name (Date) at Venue"
        let currentEvent: Partial<RawEvent> | null = null;

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            // Match numbered or bulleted list items with bold event names
            const boldMatch = trimmed.match(
                /^(?:\d+[\.\)]\s*|\-\s*|\*\s*)\*\*(.+?)\*\*/
            );

            if (boldMatch) {
                // Save previous event if exists
                if (currentEvent?.name) {
                    events.push({
                        name: currentEvent.name,
                        venue: currentEvent.venue,
                        startDate: currentEvent.startDate,
                        description: currentEvent.description,
                        source: 'grounded_search',
                        eventType: 'community',
                    });
                }

                const name = boldMatch[1].trim();
                const rest = trimmed.substring(boldMatch[0].length).trim();

                currentEvent = { name };

                // Try to extract date, venue, description from the rest of the line
                if (rest) {
                    // Split on common separators
                    const parts = rest.split(/\s*[-–—:]\s*/);
                    for (const part of parts) {
                        const p = part.trim();
                        if (!p) continue;
                        if (this.looksLikeDate(p) && !currentEvent.startDate) {
                            currentEvent.startDate = p;
                        } else if (!currentEvent.description) {
                            currentEvent.description = p;
                        }
                    }
                }
            } else if (currentEvent && !currentEvent.description && trimmed.length > 20) {
                // Continuation line — likely a description
                currentEvent.description = trimmed.replace(/^\*\*.*?\*\*:?\s*/, '');
            }
        }

        // Don't forget the last event
        if (currentEvent?.name) {
            events.push({
                name: currentEvent.name,
                venue: currentEvent.venue,
                startDate: currentEvent.startDate,
                description: currentEvent.description,
                source: 'grounded_search',
                eventType: 'community',
            });
        }

        return events;
    }

    /**
     * Check if a string looks like a date/time.
     */
    private looksLikeDate(text: string): boolean {
        const datePatterns = [
            /\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/i,
            /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i,
            /\b\d{1,2}\/\d{1,2}/,
            /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
            /\b(mon|tue|wed|thu|fri|sat|sun)\b/i,
            /\bweekend\b/i,
            /\btonight\b/i,
            /\bthis week\b/i,
        ];
        return datePatterns.some(p => p.test(text));
    }

    /**
     * Extract URLs from Gemini grounding metadata.
     */
    private extractGroundingUrls(
        meta: any
    ): Array<{ url: string; title?: string }> {
        if (!meta) return [];

        const urls: Array<{ url: string; title?: string }> = [];

        // Try both spellings (groundingChunks and groundingChuncks — Gemini typo)
        const chunks = meta.groundingChunks || meta.groundingChuncks || [];
        for (const chunk of chunks) {
            const uri = chunk?.web?.uri;
            const title = chunk?.web?.title;
            if (uri && !urls.some(u => u.url === uri)) {
                urls.push({ url: uri, title });
            }
        }

        return urls;
    }

    // ========================================================================
    // Stream 3: SerpApi Google Events (nice-to-have)
    // ========================================================================

    public async searchSerpApi(queryText: string, city: string): Promise<RawEvent[]> {
        if (!this.serpApiKey) {
            console.log('[EventsSearch:SerpApi] No API key, skipping');
            return [];
        }

        try {
            const searchQuery = city ? `${queryText} in ${city}` : queryText;
            const params = new URLSearchParams({
                engine: 'google_events',
                q: searchQuery,
                api_key: this.serpApiKey,
                hl: 'en',
                gl: 'us',
            });

            const response = await fetch(`https://serpapi.com/search.json?${params.toString()}`);

            if (!response.ok) {
                console.warn(`[EventsSearch:SerpApi] API error: ${response.status}`);
                return [];
            }

            const data = await response.json();

            if (data.error) {
                console.warn(`[EventsSearch:SerpApi] ${data.error}`);
                return [];
            }

            const events = data.events_results || [];

            return events.slice(0, 20).map((e: any): RawEvent => {
                const venueAddress = e.address ? e.address.join(', ') : undefined;
                const ticketUrl = e.ticket_info?.find(
                    (t: any) => t.link_type === 'tickets'
                )?.link || e.link;

                return {
                    name: e.title,
                    venue: e.venue?.name,
                    venueAddress,
                    startDate: this.parseSerpApiDate(e.date),
                    ticketUrl,
                    imageUrl: e.image || e.thumbnail,
                    description: e.description?.substring(0, 300),
                    source: 'serpapi',
                    eventType: 'ticketed',
                };
            });
        } catch (error) {
            console.error('[EventsSearch:SerpApi] Error:', error);
            return [];
        }
    }

    /**
     * Parse SerpApi's natural-language date into something usable.
     */
    private parseSerpApiDate(date?: any): string | undefined {
        if (!date) return undefined;

        const now = new Date();
        const year = now.getFullYear();

        try {
            if (date.when) {
                const startPart = date.when.split('–')[0].trim();
                const cleaned = startPart
                    .replace(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s*/i, '')
                    .replace(/\s+(CST|EST|PST|MST|CDT|EDT|PDT|MDT|CT|ET|PT|MT)$/i, '');

                const hasYear = /\b20\d{2}\b/.test(cleaned);
                const withYear = hasYear ? cleaned : `${cleaned}, ${year}`;
                const parsed = new Date(withYear);

                if (!isNaN(parsed.getTime())) {
                    if (parsed < now && !hasYear) {
                        const nextYear = new Date(`${cleaned}, ${year + 1}`);
                        if (!isNaN(nextYear.getTime())) return nextYear.toISOString();
                    }
                    return parsed.toISOString();
                }
            }

            if (date.start_date) {
                const withYear = `${date.start_date}, ${year}`;
                const fallback = new Date(withYear);
                if (!isNaN(fallback.getTime())) return fallback.toISOString();
            }
        } catch {
            // Date parsing failed
        }

        return date.when || date.start_date;
    }

    // ========================================================================
    // Deduplication
    // ========================================================================

    public deduplicateEvents(events: RawEvent[]): RawEvent[] {
        const seen = new Map<string, RawEvent>();

        for (const event of events) {
            const key = this.normalizeEventName(event.name);

            if (seen.has(key)) {
                // Merge: prefer ticketed source for enrichment data
                const existing = seen.get(key)!;
                seen.set(key, this.mergeEvents(existing, event));
            } else {
                seen.set(key, event);
            }
        }

        return Array.from(seen.values());
    }

    public normalizeEventName(name: string): string {
        return name
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, '')
            .replace(/\s+/g, ' ')
            .trim()
            // Remove common suffixes like "2026", "festival", "concert"
            .replace(/\s*20\d{2}$/, '')
            .trim();
    }

    private mergeEvents(a: RawEvent, b: RawEvent): RawEvent {
        // Prefer ticketed source for structured data, but keep richer descriptions
        const primary = a.source === 'ticketmaster' ? a : b;
        const secondary = a.source === 'ticketmaster' ? b : a;

        return {
            ...primary,
            description: primary.description || secondary.description,
            imageUrl: primary.imageUrl || secondary.imageUrl,
            ticketUrl: primary.ticketUrl || secondary.ticketUrl,
            venue: primary.venue || secondary.venue,
            venueAddress: primary.venueAddress || secondary.venueAddress,
        };
    }

    // ========================================================================
    // LLM Ranking
    // ========================================================================

    /**
     * Use the LLM to rank events by relevance to the user's query.
     * This is where the search intent matters — "live music" vs "family-friendly"
     * vs "free things to do" should return very different top results.
     */
    private async rankEvents(
        events: RawEvent[],
        queryText: string,
        city: string,
        maxResults: number
    ): Promise<RawEvent[]> {
        if (events.length <= maxResults) return events;

        try {
            const eventList = events.map((e, i) =>
                `${i + 1}. "${e.name}" — ${e.eventType} | ${e.startDate || 'date TBD'} | ${e.venue || 'venue TBD'} | ${e.description?.substring(0, 80) || 'no description'}`
            ).join('\n');

            const prompt = `You are ranking events for the query: "${queryText}" in ${city}.

Here are ${events.length} events discovered from multiple sources:

${eventList}

Select the ${maxResults} most relevant events for someone searching "${queryText}".
Prioritize:
1. Direct relevance to the query
2. Events with confirmed dates (not TBD)
3. Variety — mix of event types (don't return 5 similar concerts)
4. Unique/interesting events over generic ones

Return a JSON array of the selected event numbers IN RANKED ORDER (best first):
[3, 7, 1, 12, ...]

Return ONLY the JSON array, no other text.`;

            const model = this.genAI.getGenerativeModel({
                model: this.model,
                generationConfig: {
                    responseMimeType: 'application/json',
                    temperature: 0.2,
                },
            });

            const result = await model.generateContent(prompt);
            const text = result.response.text();

            let rankings: number[];
            try {
                rankings = JSON.parse(text);
                if (!Array.isArray(rankings)) throw new Error('Not an array');
            } catch {
                console.warn('[EventsSearch:Rank] Failed to parse ranking, using original order');
                return events.slice(0, maxResults);
            }

            // Map rankings back to events (1-indexed → 0-indexed)
            const ranked: RawEvent[] = [];
            for (const idx of rankings) {
                const event = events[idx - 1];
                if (event && !ranked.includes(event)) {
                    ranked.push(event);
                }
                if (ranked.length >= maxResults) break;
            }

            // Fill remaining slots if ranking didn't return enough
            if (ranked.length < maxResults) {
                for (const event of events) {
                    if (!ranked.includes(event)) ranked.push(event);
                    if (ranked.length >= maxResults) break;
                }
            }

            return ranked;
        } catch (error) {
            console.error('[EventsSearch:Rank] Error:', error);
            return events.slice(0, maxResults);
        }
    }

    // ========================================================================
    // Candidate Conversion
    // ========================================================================

    /**
     * Convert raw events to Stage1aCandidates with pre-attached enrichment.
     */
    toCandidates(events: RawEvent[]): Stage1aCandidate[] {
        return events.map(e => ({
            name: e.name,
            identifiers: {
                source: e.source,
                eventType: e.eventType,
            },
            search_hint: e.name,
            enrichment_hooks: ['events_search'],  // Marker — already enriched
            // Attach raw event data for later enrichment merging
            _eventsEnrichment: {
                venue: e.venue,
                venueAddress: e.venueAddress,
                venueLatitude: e.venueLatitude,
                venueLongitude: e.venueLongitude,
                startDate: e.startDate,
                endDate: e.endDate,
                ticketUrl: e.ticketUrl,
                priceRange: e.priceRange,
                imageUrl: e.imageUrl,
                description: e.description,
                status: e.status,
            },
        } as Stage1aCandidate & { _eventsEnrichment: any }));
    }

    // ========================================================================
    // Image Resolution (multi-fallback)
    // ========================================================================

    /**
     * Find an image for an event using a three-tier fallback:
     * 1. SerpApi Google Images (best quality, event-specific)
     * 2. Wikipedia thumbnail (free, good for named festivals)
     * 3. Gemini grounded search (always available)
     *
     * Returns the first image URL found, or null if all fail.
     */
    public async findEventImage(name: string, city: string, sourceUrls?: string[]): Promise<string | null> {
        // Tier 1: Wikipedia thumbnail (fastest, ~200ms, free)
        try {
            const wikiData = await this.enrichWithWikipedia(name, city);
            if (wikiData?.imageUrl) {
                console.log(`[EventsImage] Wikipedia hit for "${name}"`);
                return wikiData.imageUrl;
            }
        } catch {
            // Wikipedia failed, fall through
        }

        // Tier 2: og:image scrape from existing source URLs (~500ms, free, no API call)
        if (sourceUrls && sourceUrls.length > 0) {
            for (const url of sourceUrls.slice(0, 3)) {
                try {
                    const ogImage = await this.scrapeOgImage(url);
                    if (ogImage) {
                        console.log(`[EventsImage] og:image hit for "${name}" from ${new URL(url).hostname}`);
                        return ogImage;
                    }
                } catch {
                    continue;
                }
            }
        }

        // Tier 3: SerpApi Google Images (~200ms, but quota-limited)
        try {
            const url = await this.searchSerpApiImage(name, city);
            if (url) {
                console.log(`[EventsImage] SerpApi hit for "${name}"`);
                return url;
            }
        } catch {
            // SerpApi failed (e.g. 429), fall through
        }

        // Tier 4: Gemini grounded search → og:image (slowest, ~4-5s, last resort)
        try {
            const url = await this.searchGroundedImage(name, city);
            if (url) {
                console.log(`[EventsImage] Gemini grounded hit for "${name}"`);
                return url;
            }
        } catch {
            // Gemini failed, fall through
        }

        console.log(`[EventsImage] No image found for "${name}"`);
        return null;
    }

    /**
     * Tier 1: Search SerpApi Google Images for an event photo.
     */
    private async searchSerpApiImage(name: string, city: string): Promise<string | null> {
        if (!this.serpApiKey) return null;

        const params = new URLSearchParams({
            engine: 'google_images',
            q: `${name} ${city} event`,
            api_key: this.serpApiKey,
            num: '3',
        });

        const response = await fetch(`https://serpapi.com/search.json?${params.toString()}`);
        if (!response.ok) return null;

        const data = await response.json();
        const images = data.images_results || [];

        // Pick the first result with a reasonable image
        for (const img of images) {
            const url = img.original || img.thumbnail;
            if (url && !url.includes('placeholder') && !url.includes('no-image')) {
                return url;
            }
        }

        return null;
    }

    /**
     * Tier 3: Find event web pages via Gemini grounded search,
     * then scrape og:image meta tags from those pages.
     * Most event pages advertise images via Open Graph tags.
     */
    private async searchGroundedImage(name: string, city: string): Promise<string | null> {
        const model = this.genAI.getGenerativeModel({
            model: 'gemini-2.0-flash',
            generationConfig: { temperature: 0.1, maxOutputTokens: 128 },
            tools: [{ google_search: {} } as any],
        });

        const prompt = `Find the official website or event listing page for "${name}" in ${city}. Provide the URL.`;
        const result = await model.generateContent(prompt);

        // Extract all grounding URLs
        const groundingMeta = (result.response as any).candidates?.[0]?.groundingMetadata;
        const chunks = groundingMeta?.groundingChunks || groundingMeta?.groundingChuncks || [];
        const urls: string[] = [];

        for (const chunk of chunks) {
            const uri = chunk?.web?.uri;
            if (uri && uri.startsWith('http')) urls.push(uri);
        }

        // Also try to extract URLs from response text
        const text = result.response.text();
        const textUrls = text.match(/https?:\/\/[^\s)>\]"']+/g) || [];
        for (const u of textUrls) {
            if (!urls.includes(u)) urls.push(u);
        }

        // Try to scrape og:image from each URL (first 3 only, with timeout)
        for (const url of urls.slice(0, 3)) {
            try {
                const ogImage = await this.scrapeOgImage(url);
                if (ogImage) return ogImage;
            } catch {
                continue;
            }
        }

        return null;
    }

    /**
     * Fetch a web page and extract the og:image meta tag.
     * Only fetches the first 16KB to minimize bandwidth.
     */
    private async scrapeOgImage(url: string): Promise<string | null> {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);

        try {
            const response = await fetch(url, {
                signal: controller.signal,
                headers: { 'User-Agent': 'KalidasaBot/1.0 (image-resolution)' },
                redirect: 'follow',
            });

            if (!response.ok) return null;

            // Read just enough to find og:image (usually in <head>)
            const reader = response.body?.getReader();
            if (!reader) return null;

            let html = '';
            const decoder = new TextDecoder();
            while (html.length < 16384) {
                const { done, value } = await reader.read();
                if (done) break;
                html += decoder.decode(value, { stream: true });

                // Early exit: once we've passed </head> we have what we need
                if (html.includes('</head>')) break;
            }
            reader.cancel();

            // Extract og:image
            const ogMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
                || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);

            if (ogMatch?.[1]) {
                const imgUrl = ogMatch[1];
                // Filter out generic/placeholder images
                if (imgUrl.includes('placeholder') || imgUrl.includes('default') || imgUrl.length < 20) {
                    return null;
                }
                return imgUrl;
            }

            return null;
        } finally {
            clearTimeout(timeout);
        }
    }

    // ========================================================================
    // Helpers
    // ========================================================================

    /**
     * Compute a time window for event searches.
     * Defaults to "this week + next 2 weeks" for broad coverage.
     */
    public computeTimeWindow(
        localTime?: string
    ): { start: string; end: string } | undefined {
        try {
            const now = localTime ? new Date(localTime) : new Date();
            const end = new Date(now);
            end.setDate(end.getDate() + 14); // Two weeks out

            // Ticketmaster wants ISO 8601 without milliseconds
            const fmt = (d: Date) =>
                d.toISOString().replace(/\.\d{3}Z$/, 'Z');

            return { start: fmt(now), end: fmt(end) };
        } catch {
            return undefined;
        }
    }

    /**
     * Extract meaningful keywords from the query for API searches.
     * Strips temporal phrases and generic words.
     */
    private extractEventKeywords(queryText: string): string {
        return queryText
            .replace(
                /\b(this|next|upcoming|tonight|today|tomorrow|weekend|week|month|events?|things?\s+to\s+do)\b/gi,
                ''
            )
            .replace(/\s+/g, ' ')
            .trim()
            || queryText; // Fall back to original if everything was stripped
    }
}
