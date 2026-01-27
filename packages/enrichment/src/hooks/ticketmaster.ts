/**
 * Ticketmaster Hook
 * 
 * Uses Ticketmaster Discovery API for event data.
 */

import type {
    EnrichmentHook,
    RawCAOCandidate,
    EnrichmentContext,
    EnrichmentData,
    EnrichmentDomain
} from '@kalidasa/types';

export class TicketmasterHook implements EnrichmentHook {
    name = 'ticketmaster';
    domains: EnrichmentDomain[] = ['events', 'music'];
    priority = 80;

    private apiKey: string;
    private baseUrl = 'https://app.ticketmaster.com/discovery/v2';

    constructor(apiKey?: string) {
        this.apiKey = apiKey || process.env.TICKETMASTER_CONSUMER_KEY || '';
    }

    async enrich(
        candidate: RawCAOCandidate,
        context: EnrichmentContext
    ): Promise<EnrichmentData | null> {
        if (!this.apiKey) {
            console.warn('[TicketmasterHook] No API key configured');
            return null;
        }

        const query = candidate.search_hint || candidate.name;

        try {
            // Build location params if available
            let locationParams = '';
            if (context.searchLocation?.city) {
                locationParams = `&city=${encodeURIComponent(context.searchLocation.city)}`;
            } else if (context.searchLocation?.coordinates) {
                locationParams = `&latlong=${context.searchLocation.coordinates.lat},${context.searchLocation.coordinates.lng}`;
            }

            const url = `${this.baseUrl}/events.json?keyword=${encodeURIComponent(query)}${locationParams}&apikey=${this.apiKey}&size=1`;
            const response = await fetch(url);

            if (!response.ok) {
                console.warn(`[TicketmasterHook] API error: ${response.status}`);
                return null;
            }

            const data = await response.json();
            const event = data._embedded?.events?.[0];

            if (!event) {
                return null;
            }

            const venue = event._embedded?.venues?.[0];
            const priceRanges = event.priceRanges?.[0];

            return {
                verified: true,
                source: 'ticketmaster',
                canonical: {
                    type: 'ticketmaster_id',
                    value: event.id,
                },
                events: {
                    venue: venue?.name,
                    venueAddress: venue?.address?.line1
                        ? `${venue.address.line1}, ${venue.city?.name}, ${venue.state?.stateCode}`
                        : undefined,
                    startDate: event.dates?.start?.dateTime || event.dates?.start?.localDate,
                    ticketUrl: event.url,
                    priceRange: priceRanges
                        ? `$${priceRanges.min} - $${priceRanges.max}`
                        : undefined,
                    imageUrl: event.images?.[0]?.url,
                    status: event.dates?.status?.code,
                },
            };
        } catch (error) {
            console.error('[TicketmasterHook] Error:', error);
            return null;
        }
    }

    async healthCheck(): Promise<boolean> {
        try {
            const response = await fetch(`${this.baseUrl}/events.json?keyword=test&apikey=${this.apiKey}&size=1`);
            return response.ok;
        } catch {
            return false;
        }
    }
}
