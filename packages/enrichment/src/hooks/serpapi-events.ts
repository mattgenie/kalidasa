/**
 * SerpApi Google Events Hook
 *
 * Uses SerpApi's Google Events engine to find events via Google's event listings.
 * Returns structured event data including venue, date, ticket links, and images.
 */

import type {
    EnrichmentHook,
    RawCAOCandidate,
    EnrichmentContext,
    EnrichmentData,
    EnrichmentDomain
} from '@kalidasa/types';

export class SerpApiEventsHook implements EnrichmentHook {
    name = 'serpapi_events';
    domains: EnrichmentDomain[] = ['events'];
    priority = 92; // Between TM (95) and EB (90)

    private apiKey: string;
    private baseUrl = 'https://serpapi.com/search.json';

    constructor(apiKey?: string) {
        const resolvedKey = apiKey ?? process.env.SERPAPI_API_KEY;
        if (!resolvedKey) {
            throw new Error('[SerpApiEventsHook] SERPAPI_API_KEY is required');
        }
        this.apiKey = resolvedKey;
    }

    async enrich(
        candidate: RawCAOCandidate,
        context: EnrichmentContext
    ): Promise<EnrichmentData | null> {
        const query = candidate.search_hint || candidate.name;
        const city = context.searchLocation?.city || '';

        // Build search query — include city for better geographic targeting
        const searchQuery = city ? `${query} in ${city}` : query;

        try {
            const params = new URLSearchParams({
                engine: 'google_events',
                q: searchQuery,
                api_key: this.apiKey,
                hl: 'en',
                gl: 'us',
            });

            const response = await fetch(`${this.baseUrl}?${params.toString()}`);

            if (!response.ok) {
                console.warn(`[SerpApiEvents] API error: ${response.status}`);
                return null;
            }

            const data = await response.json();
            const events = data.events_results;

            if (!events || events.length === 0) {
                return null;
            }

            // Find the best matching event — prefer one whose title matches the candidate
            const bestEvent = this.findBestMatch(events, candidate.name);

            if (!bestEvent) {
                return null;
            }

            // Extract ticket URL — prefer "tickets" link_type, fall back to first link
            const ticketUrl = this.extractTicketUrl(bestEvent);

            // Build the venue address from the address array
            const venueAddress = bestEvent.address
                ? bestEvent.address.join(', ')
                : undefined;

            // Parse the date — SerpApi provides natural language dates
            const startDate = this.parseEventDate(bestEvent.date);

            return {
                verified: true,
                source: 'serpapi_events',
                canonical: {
                    type: 'serpapi_event',
                    value: bestEvent.title,
                },
                events: {
                    venue: bestEvent.venue?.name,
                    venueAddress,
                    startDate,
                    ticketUrl,
                    imageUrl: bestEvent.image || bestEvent.thumbnail,
                    description: bestEvent.description
                        ? bestEvent.description.substring(0, 300)
                        : undefined,
                    status: 'onsale',
                },
            };
        } catch (error) {
            console.error('[SerpApiEvents] Error:', error);
            return null;
        }
    }

    /**
     * Find the best matching event from SerpApi results.
     * Prefers events whose title contains words from the candidate name.
     * Returns null if no event title has meaningful word overlap.
     */
    private findBestMatch(
        events: SerpApiEvent[],
        candidateName: string
    ): SerpApiEvent | null {
        const candidateWords = candidateName
            .toLowerCase()
            .split(/\s+/)
            .filter(w => w.length > 2); // Ignore tiny words like "a", "in", "the"

        if (candidateWords.length === 0) return null;

        // Score each event by how many candidate words appear in its title
        let bestEvent: SerpApiEvent | null = null;
        let bestScore = 0;
        let bestRatio = 0;

        for (const event of events) {
            const title = event.title.toLowerCase();
            const titleWords = title.split(/\s+/).filter(w => w.length > 2);
            const matchedWords = candidateWords.filter(w => title.includes(w));
            const score = matchedWords.length;

            if (score === 0) continue;

            // Require at least 50% of candidate words to match
            const forwardRatio = score / candidateWords.length;
            if (forwardRatio < 0.5) continue;

            // Check backward: if the title has many extra words, it's likely
            // a different entity (e.g., "The Disco Killers" vs "The Killers")
            const titleMatchCount = titleWords.filter(w =>
                candidateWords.some(cw => w.includes(cw) || cw.includes(w))
            ).length;
            const backwardRatio = titleWords.length > 0
                ? titleMatchCount / titleWords.length
                : 0;

            // Combined quality score: prefer high overlap in both directions
            const combinedRatio = (forwardRatio + backwardRatio) / 2;

            if (score > bestScore || (score === bestScore && combinedRatio > bestRatio)) {
                bestScore = score;
                bestRatio = combinedRatio;
                bestEvent = event;
            }
        }

        if (bestScore === 0) {
            console.log(`[SerpApiEvents] No title match for "${candidateName}" in ${events.length} results`);
            return null;
        }

        // Require reasonable bidirectional match quality
        if (bestRatio < 0.3) {
            console.log(`[SerpApiEvents] Weak match for "${candidateName}" → "${bestEvent?.title}" (ratio: ${bestRatio.toFixed(2)})`);
            return null;
        }

        return bestEvent;
    }

    /**
     * Extract the best ticket URL from ticket_info array.
     * Preference: tickets > more info, and well-known sources first.
     */
    private extractTicketUrl(event: SerpApiEvent): string | undefined {
        if (!event.ticket_info || event.ticket_info.length === 0) {
            return event.link;
        }

        // Prefer entries with link_type "tickets"
        const ticketEntries = event.ticket_info.filter(
            t => t.link_type === 'tickets'
        );

        if (ticketEntries.length > 0) {
            // Prefer well-known ticket sources
            const preferred = ['ticketmaster.com', 'eventbrite.com', 'axs.com', 'seatgeek.com'];
            const knownSource = ticketEntries.find(t =>
                preferred.some(p => t.source?.toLowerCase().includes(p.replace('.com', '')))
            );
            return knownSource?.link ?? ticketEntries[0].link;
        }

        return event.link;
    }

    /**
     * Parse SerpApi's natural-language date into ISO format.
     * SerpApi returns dates like { start_date: "Dec 7", when: "Sat, Dec 7, 8:00 PM CST" }
     */
    private parseEventDate(date?: SerpApiDate): string | undefined {
        if (!date) return undefined;

        const now = new Date();
        const currentYear = now.getFullYear();

        try {
            // Try the "when" field first — more specific
            if (date.when) {
                // Extract start portion (before any "–" range separator)
                const startPart = date.when.split('–')[0].trim();

                // Remove timezone abbreviation and day-of-week prefix
                const cleaned = startPart
                    .replace(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s*/i, '')
                    .replace(/\s+(CST|EST|PST|MST|CDT|EDT|PDT|MDT|CT|ET|PT|MT)$/i, '');

                // Inject current year if no year is present
                const hasYear = /\b20\d{2}\b/.test(cleaned);
                const withYear = hasYear ? cleaned : `${cleaned}, ${currentYear}`;

                const parsed = new Date(withYear);
                if (!isNaN(parsed.getTime())) {
                    // If the date is in the past, try next year
                    if (parsed < now && !hasYear) {
                        const nextYear = new Date(`${cleaned}, ${currentYear + 1}`);
                        if (!isNaN(nextYear.getTime())) {
                            return nextYear.toISOString();
                        }
                    }
                    return parsed.toISOString();
                }
            }

            // Fallback: try start_date with current year
            if (date.start_date) {
                const withYear = `${date.start_date}, ${currentYear}`;
                const fallback = new Date(withYear);
                if (!isNaN(fallback.getTime())) {
                    if (fallback < now) {
                        const nextYear = new Date(`${date.start_date}, ${currentYear + 1}`);
                        if (!isNaN(nextYear.getTime())) {
                            return nextYear.toISOString();
                        }
                    }
                    return fallback.toISOString();
                }
            }
        } catch {
            // Date parsing failed, return undefined
        }

        return undefined;
    }

    async healthCheck(): Promise<boolean> {
        try {
            const params = new URLSearchParams({
                engine: 'google_events',
                q: 'events in New York',
                api_key: this.apiKey,
                hl: 'en',
                gl: 'us',
            });
            const response = await fetch(`${this.baseUrl}?${params.toString()}`);
            return response.ok;
        } catch {
            return false;
        }
    }
}

// ---- SerpApi response types ----

interface SerpApiDate {
    start_date?: string;
    when?: string;
}

interface SerpApiTicketInfo {
    source?: string;
    link?: string;
    link_type?: string;
}

interface SerpApiVenue {
    name?: string;
    rating?: number;
    reviews?: number;
    link?: string;
}

interface SerpApiEvent {
    title: string;
    date?: SerpApiDate;
    address?: string[];
    link?: string;
    description?: string;
    ticket_info?: SerpApiTicketInfo[];
    venue?: SerpApiVenue;
    thumbnail?: string;
    image?: string;
}
