/**
 * Composite Events Hook
 * 
 * Runs Ticketmaster, Eventbrite, SerpApi (Google Events), and Wikipedia in
 * parallel for event enrichment. Validates results (city, temporal), detects
 * whether Wikipedia results are actually events, and merges the best data
 * with image fallback.
 */

import type {
    EnrichmentHook,
    RawCAOCandidate,
    EnrichmentContext,
    EnrichmentData,
    EnrichmentDomain
} from '@kalidasa/types';

import { TicketmasterHook } from './ticketmaster.js';
import { EventbriteHook } from './eventbrite.js';
import { SerpApiEventsHook } from './serpapi-events.js';
import { WikipediaHook } from './wikipedia.js';

export class CompositeEventsHook implements EnrichmentHook {
    name = 'events_composite';
    domains: EnrichmentDomain[] = ['events'];
    priority = 95;

    private ticketmaster: TicketmasterHook;
    private eventbrite: EventbriteHook | null;
    private serpapi: SerpApiEventsHook | null;
    private wikipedia: WikipediaHook;

    constructor() {
        this.ticketmaster = new TicketmasterHook();

        // Eventbrite throws if API key is missing — graceful degradation
        try {
            this.eventbrite = new EventbriteHook();
        } catch {
            console.warn('[CompositeEvents] Eventbrite unavailable (no API key), continuing without');
            this.eventbrite = null;
        }

        // SerpApi throws if API key is missing — graceful degradation
        try {
            this.serpapi = new SerpApiEventsHook();
        } catch {
            console.warn('[CompositeEvents] SerpApi unavailable (no API key), continuing without');
            this.serpapi = null;
        }

        this.wikipedia = new WikipediaHook();
    }

    async enrich(
        candidate: RawCAOCandidate,
        context: EnrichmentContext
    ): Promise<EnrichmentData | null> {
        // For Wikipedia, augment search_hint with "festival"/"event" to avoid
        // disambiguation misses (e.g., "Outside Lands" → geographic area,
        // but "Outside Lands festival" → the music festival)
        const wikiCandidate = this.augmentForWikipedia(candidate);

        // Run all sources in parallel
        const [tmSettled, ebSettled, serpSettled, wikiSettled] = await Promise.allSettled([
            this.ticketmaster.enrich(candidate, context),
            this.eventbrite?.enrich(candidate, context) ?? Promise.resolve(null),
            this.serpapi?.enrich(candidate, context) ?? Promise.resolve(null),
            this.wikipedia.enrich(wikiCandidate, context),
        ]);

        const tmResult = tmSettled.status === 'fulfilled' ? tmSettled.value : null;
        const ebResult = ebSettled.status === 'fulfilled' ? ebSettled.value : null;
        const serpResult = serpSettled.status === 'fulfilled' ? serpSettled.value : null;
        const wikiResult = wikiSettled.status === 'fulfilled' ? wikiSettled.value : null;

        // Validate ticketed results (city + temporal)
        const validTm = this.validateTicketedResult(tmResult, context, 'Ticketmaster');
        const validEb = this.validateTicketedResult(ebResult, context, 'Eventbrite');
        const validSerp = this.validateTicketedResult(serpResult, context, 'SerpApi');

        // Check if Wikipedia result is actually an event AND matches the candidate
        const wikiTitle = wikiResult?.canonical?.value || '';
        const wikiIsEvent = this.isWikipediaEvent(wikiResult);
        const wikiMatchesCandidate = this.titleMatches(candidate.name, wikiTitle);

        // Only use Wikipedia if it's an event AND the title matches the candidate
        const useWiki = wikiIsEvent && wikiMatchesCandidate;

        if (wikiResult && !useWiki && wikiIsEvent) {
            console.log(`[CompositeEvents] Wiki title mismatch: "${wikiTitle}" ≠ "${candidate.name}"`);
        }

        // Log what we found
        const sources: string[] = [];
        if (validTm) sources.push('TM');
        if (validSerp) sources.push('Serp');
        if (validEb) sources.push('EB');
        if (useWiki) sources.push('Wiki');
        console.log(`[CompositeEvents] ${candidate.name}: sources=[${sources.join(',')}]`);

        // Merge results: TM > SerpApi > EB > Wikipedia
        return this.merge(validTm, validSerp, validEb, useWiki ? wikiResult : null);
    }

    /**
     * Validate a ticketed result: correct city and future date.
     */
    private validateTicketedResult(
        result: EnrichmentData | null,
        context: EnrichmentContext,
        source: string
    ): EnrichmentData | null {
        if (!result?.events) return null;

        // City validation
        const requestedCity = context.searchLocation?.city?.toLowerCase();
        if (requestedCity) {
            const venueAddress = result.events.venueAddress?.toLowerCase() || '';

            // Try to extract the actual city from the address
            // Addresses: "Street, City, ST" or "Venue, Street, City, ST"
            const addressCity = this.extractCityFromAddress(venueAddress);

            if (addressCity) {
                // Compare extracted city against requested city
                if (!addressCity.includes(requestedCity) && !requestedCity.includes(addressCity)) {
                    console.log(`[CompositeEvents] ${source} rejected: city "${addressCity}" ≠ "${requestedCity}"`);
                    return null;
                }
            } else {
                // Fallback: check if city appears in venue name
                const venueName = result.events.venue?.toLowerCase() || '';
                if (venueName && !venueName.includes(requestedCity)) {
                    const combined = `${venueName} ${venueAddress}`;
                    if (!combined.includes(requestedCity)) {
                        console.log(`[CompositeEvents] ${source} rejected: venue "${result.events.venue}" not in "${requestedCity}"`);
                        return null;
                    }
                }
            }
        }

        // Temporal validation: reject past events
        if (result.events.startDate) {
            const eventDate = new Date(result.events.startDate);
            if (!isNaN(eventDate.getTime()) && eventDate < new Date()) {
                console.log(`[CompositeEvents] ${source} rejected: past event (${result.events.startDate})`);
                return null;
            }
        }

        return result;
    }

    /**
     * Extract the city name from a US-style address.
     * "24 Willie Mays Plaza, San Francisco, CA" → "san francisco"
     * "1650 Premium Outlet Blvd, Aurora, IL" → "aurora"
     */
    private extractCityFromAddress(address: string): string | null {
        if (!address) return null;

        // US addresses: "Street, City, State" — city is second-to-last comma segment
        // State is typically a 2-letter abbreviation
        const parts = address.split(',').map(p => p.trim());

        if (parts.length >= 2) {
            // Find the segment that looks like "City, ST" (last segment has state)
            const lastPart = parts[parts.length - 1].trim();
            const hasState = /^[a-z]{2}$/.test(lastPart) || /\b[a-z]{2}\s*\d{0,5}$/.test(lastPart);

            if (hasState && parts.length >= 3) {
                // City is the segment before the state
                return parts[parts.length - 2].trim();
            }
        }

        return null;
    }

    /**
     * Detect whether a Wikipedia result describes an event (festival, parade, etc.)
     * vs a person, band, or generic concept.
     */
    private isWikipediaEvent(result: EnrichmentData | null): boolean {
        if (!result?.general) return false;

        // Check both the short description and the full summary
        const description = (result.general.description || '').toLowerCase();
        const summary = (result.general.summary || '').toLowerCase();
        const text = `${description} ${summary}`;

        const eventIndicators = [
            'festival', 'event', 'ceremony', 'parade',
            'convention', 'fair', 'tournament', 'exhibition',
            'marathon', 'rally', 'celebration', 'carnival',
            'annual', 'recurring', 'held every', 'takes place',
            'concert series', 'music event', 'arts festival',
            'championship', 'competition', 'expo',
        ];

        return eventIndicators.some(word => text.includes(word));
    }

    /**
     * Check if a Wikipedia title reasonably matches the candidate name.
     * Prevents false merges like: candidate "Hamilton" → Wikipedia "Festival of Friends"
     * (a festival in Hamilton, Ontario — not the musical).
     */
    private titleMatches(candidateName: string, wikiTitle: string): boolean {
        if (!wikiTitle) return false;

        const a = candidateName.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
        const b = wikiTitle.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();

        // Exact match
        if (a === b) return true;

        // One contains the other (e.g., "Outside Lands" matches "Outside Lands (festival)")
        if (a.includes(b) || b.includes(a)) return true;

        // Word overlap: only for names with 3+ words (short names are too ambiguous)
        const aWords = a.split(/\s+/);
        if (aWords.length < 3) return false;

        const bWords = new Set(b.split(/\s+/));
        const overlap = aWords.filter(w => bWords.has(w)).length;
        return overlap >= Math.ceil(aWords.length * 0.5);
    }

    /**
     * Merge results from multiple sources.
     * Priority: Ticketmaster > SerpApi > Eventbrite > Wikipedia.
     * Image fallback chain: TM → SerpApi → EB → Wikipedia thumbnail.
     */
    private merge(
        tm: EnrichmentData | null,
        serp: EnrichmentData | null,
        eb: EnrichmentData | null,
        wiki: EnrichmentData | null
    ): EnrichmentData | null {
        const primary = tm ?? serp ?? eb;

        if (!primary && !wiki) return null;

        if (primary) {
            // Ticketed event: use structured data, supplement with Wikipedia
            return {
                ...primary,
                events: {
                    ...primary.events,
                    // Image fallback chain through all sources
                    imageUrl: primary.events?.imageUrl
                        || serp?.events?.imageUrl
                        || eb?.events?.imageUrl
                        || wiki?.general?.thumbnail
                        || undefined,
                    // Add Wikipedia description if available
                    description: wiki?.general?.summary
                        ? wiki.general.summary.substring(0, 300)
                        : primary.events?.description,
                    wikipediaUrl: wiki?.general?.wikipediaUrl,
                },
            };
        }

        // Wikipedia-only event (parade, free festival, public event)
        return {
            verified: true,
            source: 'wikipedia',
            canonical: wiki!.canonical,
            events: {
                imageUrl: wiki!.general?.thumbnail,
                description: wiki!.general?.summary
                    ? wiki!.general.summary.substring(0, 300)
                    : undefined,
                wikipediaUrl: wiki!.general?.wikipediaUrl,
            },
        };
    }

    /**
     * Augment a candidate's search fields for better Wikipedia event discovery.
     * Appends "festival" or "event" to help Wikipedia resolve to the event
     * article instead of geographic/biographical disambiguations.
     */
    private augmentForWikipedia(candidate: RawCAOCandidate): RawCAOCandidate {
        const name = candidate.name.toLowerCase();

        // Don't augment if the name already contains event-qualifying terms
        const alreadyQualified = [
            'festival', 'parade', 'marathon', 'convention',
            'expo', 'fair', 'ceremony', 'tournament',
        ].some(term => name.includes(term));

        if (alreadyQualified) {
            return candidate;
        }

        // Try "Name festival" first as search_hint
        const augmentedHint = `${candidate.name} festival`;

        return {
            ...candidate,
            search_hint: augmentedHint,
        };
    }

    async healthCheck(): Promise<boolean> {
        // At minimum, Ticketmaster + Wikipedia should be available
        const [tm, wiki] = await Promise.allSettled([
            this.ticketmaster.healthCheck?.() ?? Promise.resolve(true),
            this.wikipedia.healthCheck?.() ?? Promise.resolve(true),
        ]);
        return (
            (tm.status === 'fulfilled' && tm.value) ||
            (wiki.status === 'fulfilled' && wiki.value)
        );
    }
}
