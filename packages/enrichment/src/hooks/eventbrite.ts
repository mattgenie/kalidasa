/**
 * Eventbrite Hook
 * 
 * Uses Eventbrite API for event data.
 */

import type {
    EnrichmentHook,
    RawCAOCandidate,
    EnrichmentContext,
    EnrichmentData,
    EnrichmentDomain
} from '@kalidasa/types';

export class EventbriteHook implements EnrichmentHook {
    name = 'eventbrite';
    domains: EnrichmentDomain[] = ['events'];
    priority = 90;

    private token: string;
    private baseUrl = 'https://www.eventbriteapi.com/v3';

    constructor(token?: string) {
        // CRIT-02: Fail-fast on missing token
        const resolvedToken = token ?? process.env.EVENTBRITE_API_KEY;
        if (!resolvedToken) {
            throw new Error('[EventbriteHook] EVENTBRITE_API_KEY is required - check environment variables');
        }
        this.token = resolvedToken;
    }

    async enrich(
        candidate: RawCAOCandidate,
        context: EnrichmentContext
    ): Promise<EnrichmentData | null> {
        const query = candidate.search_hint || candidate.name;

        try {
            // Build location params if available
            let locationParams = '';
            if (context.searchLocation?.city) {
                locationParams = `&location.address=${encodeURIComponent(context.searchLocation.city)}`;
            } else if (context.searchLocation?.coordinates) {
                locationParams = `&location.latitude=${context.searchLocation.coordinates.lat}&location.longitude=${context.searchLocation.coordinates.lng}`;
            }

            const url = `${this.baseUrl}/events/search/?q=${encodeURIComponent(query)}${locationParams}`;
            const response = await fetch(url, {
                headers: {
                    Authorization: `Bearer ${this.token}`,
                },
            });

            if (!response.ok) {
                console.warn(`[EventbriteHook] API error: ${response.status}`);
                return null;
            }

            const data = await response.json();
            const event = data.events?.[0];

            if (!event) {
                return null;
            }

            return {
                verified: true,
                source: 'eventbrite',
                canonical: {
                    type: 'eventbrite_id',
                    value: event.id,
                },
                events: {
                    venue: event.venue?.name,
                    venueAddress: event.venue?.address?.localized_address_display,
                    startDate: event.start?.local,
                    endDate: event.end?.local,
                    ticketUrl: event.url,
                    imageUrl: event.logo?.original?.url,
                    status: event.status,
                },
            };
        } catch (error) {
            console.error('[EventbriteHook] Error:', error);
            return null;
        }
    }

    async healthCheck(): Promise<boolean> {
        try {
            const response = await fetch(`${this.baseUrl}/users/me/`, {
                headers: {
                    Authorization: `Bearer ${this.token}`,
                },
            });
            return response.ok;
        } catch {
            return false;
        }
    }
}
