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

    // Build conversation context UPFRONT so all domain-specific prompts can use it
    const conversationContext = buildConversationContext(request);
    const refinementBlock = conversationContext
        ? `\n${conversationContext}\n\nREFINEMENT FILTER (CRITICAL): This query is a refinement of a previous search. Every recommendation MUST clearly satisfy the refinement criteria. Do NOT include results that conflict with what the user asked for.\n`
        : '';

    const identifierExamples: Record<string, string> = {
        places: '{"address": "street address if known", "neighborhood": "district or area name", "city": "city name"}',
        movies: '{"year": 2023, "director": "Director Name"}',
        music: '{"artist": "Artist", "album": "Album"}',
        events: '{"venue": "venue name", "city": "city", "date": "YYYY-MM-DD if known"}',
        books: '{"author": "Author Name", "publisher": "Publisher", "year": 2024}',
        articles: '{"author": "Author Name", "source": "publication or site", "topic": "subject area"}',
        news: '{"source": "outlet name", "date": "YYYY-MM-DD", "author": "author name"}',
        general: '{"category": "topic"}',
    };

    // Hook defaults are assigned mechanistically in parseLine(), not by the LLM.

    // Movies: year + director required for composite key
    if (domain === 'movies') {
        // Extract year from query if present
        const yearMatch = request.query.text.match(/\b(19|20)\d{2}\b/);

        return `Find ${maxCandidates} movies for: "${request.query.text}"
${refinementBlock}
REQUIRED identifiers: "year" AND "director". BOTH are mandatory — candidates without them are SKIPPED.
${yearMatch ? `The query mentions year ${yearMatch[0]} - use this for recent movies.` : 'Use the movie\'s actual release year.'}

Output EXACTLY one JSON object per line (NDJSON format). No extra text.
Each line:
{"name": "exact movie title", "identifiers": {"year": YYYY, "director": "Director Name"}, "search_hint": "exact title"}

Start outputting now:`;
    }

    // Places: emphasize address for Google Places disambiguation
    if (domain === 'places') {
        return `Find ${maxCandidates} recommendations for: "${request.query.text}"
Domain: ${domain}
Location: ${location}
${refinementBlock}
LOCALITY RULE (CRITICAL): Every place MUST be located in or immediately adjacent to ${location} (within ~50km).
Do NOT suggest places in other cities, states, or countries.
If you cannot find ${maxCandidates} good results in ${location}, return fewer results rather than padding with out-of-area suggestions.

IMPORTANT: Only recommend places you are confident actually exist. Each will be verified via Google Places API. Prefer well-known, established venues over obscure or recently-opened ones that may be harder to verify. If uncertain about a place's exact name or location, skip it.

CRITICAL: The "neighborhood" in identifiers MUST be the district/area name (e.g., "Monastiraki", "Le Marais", "Shibuya"). Include "address" if you know the street. Google Places lookup needs at minimum name + neighborhood + city.
The "search_hint" should be the venue name + neighborhood or street for disambiguation (e.g., "Zillers Roof Garden Mitropoleos Syntagma Athens").

Output EXACTLY one JSON object per line (NDJSON format). No extra text.
Each line must be valid JSON:
{"name": "exact venue name", "identifiers": {"address": "street if known", "neighborhood": "district/area", "city": "${location}"}, "search_hint": "venue name + area"}

Start outputting now:`;
    }

    // Events: constrained prompt for high Ticketmaster/Eventbrite/Wikipedia hit rate
    if (domain === 'events') {
        // For refinements, explicitly re-state original genre/category to prevent drift
        let genreContext = '';
        if (request.conversation?.previousSearches?.length) {
            const original = request.conversation.previousSearches[0];
            genreContext = `\nGENRE CONTINUITY: The user originally searched for "${original}". This refinement must stay within the same genre/category. Do NOT switch genres.\n`;
        }

        return `Find ${maxCandidates} events for: "${request.query.text}"
Location: ${location}
${refinementBlock}${genreContext}
CRITICAL RULES:
1. STRONGLY PREFER ticketed events — concerts, theater shows, sports games,
   comedy shows, and events listed on Ticketmaster or Eventbrite.
   PREFER well-known artists/acts that frequently tour and are likely
   playing in ${location} soon. Avoid obscure local acts that won't
   appear in Ticketmaster or Eventbrite search results.
2. For large public events (parades, festivals, free cultural events),
   use the OFFICIAL event name as it would appear on Wikipedia.
3. "search_hint" MUST be the headliner artist/performer name + city,
   NOT the tour name (e.g., "Billie Eilish New York" not "Hit Me Hard Tour").
4. Only recommend REAL, UPCOMING events. No past events, no made-up names.
   Focus on recurring events (annual festivals, permanent shows) and
   major touring artists who are likely currently on tour.
5. Events MUST be in or near: ${location}.

Output EXACTLY one JSON object per line (NDJSON format). No extra text.
Each line must be valid JSON:
{"name": "event or artist name", "identifiers": {"venue": "venue if known", "city": "${location}"}, "search_hint": "artist or event name + city"}

Start outputting now:`;
    }

    // Music: artist + type + year required for composite key
    if (domain === 'music') {
        return `Find ${maxCandidates} music recommendations for: "${request.query.text}"
${refinementBlock}
CRITICAL RULES:
1. Each must be a REAL album or song with a REAL artist.
2. REQUIRED identifiers: "type", "artist", "year". ALL THREE are mandatory — candidates without them are SKIPPED.
3. "type" MUST be "album" or "song" — this determines how we look it up.
4. Mix well-known classics with interesting deeper cuts.
5. Include "search_hint" as "title artist" for disambiguation.

GOOD:
{"name": "Kind of Blue", "identifiers": {"type": "album", "artist": "Miles Davis", "year": 1959}, "search_hint": "Kind of Blue Miles Davis"}
{"name": "So What", "identifiers": {"type": "song", "artist": "Miles Davis", "year": 1959, "album": "Kind of Blue"}, "search_hint": "So What Miles Davis"}

BAD: {"name": "Jazz Music", ...}  ← GENRE, not a specific album or song!

Output EXACTLY one JSON object per line (NDJSON format). No extra text.
{"name": "exact title", "identifiers": {"type": "album|song", "artist": "artist name", "year": YYYY}, "search_hint": "title artist"}

Start outputting now:`;
    }

    // Books: author + year required for composite key
    if (domain === 'books') {
        return `Find ${maxCandidates} specific, real books for: "${request.query.text}"
${refinementBlock}
CRITICAL RULES:
1. Each must be a PUBLISHED book with a real author. NOT a topic or Wikipedia page.
2. REQUIRED identifiers: "author" AND "year". BOTH are mandatory — candidates without them are SKIPPED.
3. Include publisher if known.
4. Mix classic/foundational books AND recent high-quality titles.
5. Do NOT include articles, essays, or blog posts — ONLY books.
6. Only include books you are CONFIDENT actually exist.

GOOD:
{"name": "Thinking, Fast and Slow", "identifiers": {"author": "Daniel Kahneman", "publisher": "Farrar, Straus and Giroux", "year": 2011}, "search_hint": "Thinking Fast and Slow Daniel Kahneman"}

BAD: {"name": "Behavioral Economics", ...}  ← TOPIC, not a book!

Output EXACTLY one JSON object per line (NDJSON format). No extra text.
{"name": "exact book title", "identifiers": {"author": "author name", "publisher": "publisher", "year": YYYY}, "search_hint": "title author"}

Start outputting now:`;
    }

    // Articles: DISABLED — domain not ready yet
    // if (domain === 'articles') { ... }
    // Kept in hookDefaults/identifierExamples string maps for forward compatibility

    // News: source is required for composite key
    if (domain === 'news') {
        return `Find ${maxCandidates} recent news articles about: "${request.query.text}"
${refinementBlock}
CRITICAL RULES:
1. Each must be a REAL, RECENT news article from the last 30 days.
2. REQUIRED identifiers: "source" (outlet name). Mandatory — candidates without it are SKIPPED.
3. Include author and date if known.
4. Use exact headlines as published.
5. Do NOT include opinion pieces, essays, or books — ONLY news articles.

Output EXACTLY one JSON object per line (NDJSON format). No extra text.
{"name": "exact headline", "identifiers": {"source": "outlet name", "author": "author name", "date": "YYYY-MM-DD"}, "search_hint": "headline source"}

Start outputting now:`;
    }

    // General: category is required for composite key
    return `Find ${maxCandidates} recommendations for: "${request.query.text}"
Domain: ${domain}
Location: ${location}
${refinementBlock}
REQUIRED identifiers: "category" (topic area). Mandatory — candidates without it are SKIPPED.
SEARCH_HINT RULE: The "search_hint" is used to look up each result in an external API.
Include enough context to disambiguate: if the query implies a specific format (anime, TV series, podcast, etc.),
include that format in the search_hint. Example: "My Happy Marriage anime series" NOT just "My Happy Marriage".

Output EXACTLY one JSON object per line (NDJSON format). No extra text.
Each line must be valid JSON:
{"name": "...", "identifiers": {"category": "topic", ...}, "search_hint": "..."}

Start outputting now:`;
}

/**
 * Build conversation context string from the search request
 */
function buildConversationContext(request: KalidasaSearchRequest): string {
    const parts: string[] = [];

    if (request.conversation?.previousSearches?.length) {
        parts.push(`Previous searches: ${request.conversation.previousSearches.slice(-3).join(', ')}`);
    }

    if (request.conversation?.recentMessages?.length) {
        const msgs = request.conversation.recentMessages
            .slice(-3)
            .map(m => `${m.speaker}: ${m.content}`)
            .join(' | ');
        parts.push(`Recent conversation: ${msgs}`);
    }

    return parts.length > 0 ? parts.join('\n') : '';
}

/**
 * Domain → enrichment hook mapping.
 * Assigned mechanistically (not by the LLM) to guarantee correctness.
 */
const DOMAIN_HOOKS: Record<string, string[]> = {
    places: ['google_places'],
    movies: ['tmdb'],
    music: ['apple_music', 'musicbrainz'],
    events: ['events_composite'],
    books: ['books_composite'],
    news: ['newsapi'],
    general: ['wikipedia'],
};

/**
 * Parse a single line of NDJSON and assign enrichment hooks mechanistically.
 */
// Required identifier fields per domain — candidates missing these are SKIPPED.
const REQUIRED_IDENTIFIERS: Record<string, string[]> = {
    music: ['artist', 'year'],
    movies: ['director', 'year'],
    books: ['author', 'year'],
    events: ['city'],
    news: ['source'],
    general: ['category'],
};

function parseLine(line: string, domain: string): StreamingCandidate | null {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('```')) return null;

    try {
        const parsed = JSON.parse(trimmed);
        if (parsed.name) {
            const ids = parsed.identifiers || {};

            // Strict validation: skip candidates missing required identifiers
            const required = REQUIRED_IDENTIFIERS[domain] || [];
            const missing = required.filter(f => !ids[f] && ids[f] !== 0);
            if (missing.length > 0) {
                console.warn(`[parseLine] SKIP "${parsed.name}": missing required identifiers [${missing.join(', ')}] for domain ${domain}`);
                return null;
            }

            return {
                name: parsed.name,
                identifiers: ids,
                search_hint: parsed.search_hint,
                enrichment_hooks: DOMAIN_HOOKS[domain] || ['wikipedia'],
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
        this.maxCandidates = options.maxCandidates || 15;
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

        console.log(`[StreamingCAO] Starting stream, temporality: ${temporality.type}, maxCandidates: ${this.maxCandidates}`);

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
                    const candidate = parseLine(line, request.query.domain);
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
                const candidate = parseLine(buffer, request.query.domain);
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
