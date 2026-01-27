/**
 * Google Places Hook (New API)
 * 
 * Uses the Google Places API (New) for verified place data.
 */

import type {
    EnrichmentHook,
    RawCAOCandidate,
    EnrichmentContext,
    EnrichmentData,
    EnrichmentDomain
} from '@kalidasa/types';

export class GooglePlacesHook implements EnrichmentHook {
    name = 'google_places';
    domains: EnrichmentDomain[] = ['places'];
    priority = 100;

    private apiKey: string;
    private fieldMask: string;

    constructor(apiKey?: string) {
        this.apiKey = apiKey || process.env.GOOGLE_PLACES_API_KEY || '';
        this.fieldMask = [
            'places.id',
            'places.displayName',
            'places.formattedAddress',
            'places.rating',
            'places.userRatingCount',
            'places.priceLevel',
            'places.currentOpeningHours',
            'places.websiteUri',
            'places.nationalPhoneNumber',
            'places.googleMapsUri',
            'places.photos',
            'places.reviews',
            'places.location',
        ].join(',');
    }

    async enrich(
        candidate: RawCAOCandidate,
        context: EnrichmentContext
    ): Promise<EnrichmentData | null> {
        if (!this.apiKey) {
            console.warn('[GooglePlacesHook] No API key configured');
            return null;
        }

        const searchQuery = this.buildSearchQuery(candidate, context);

        try {
            const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Goog-Api-Key': this.apiKey,
                    'X-Goog-FieldMask': this.fieldMask,
                },
                body: JSON.stringify({
                    textQuery: searchQuery,
                    languageCode: 'en',
                }),
            });

            if (!response.ok) {
                console.warn(`[GooglePlacesHook] API error: ${response.status}`);
                return null;
            }

            const data = await response.json();
            const place = data.places?.[0];

            if (!place) {
                return null;
            }

            return {
                verified: true,
                source: 'google_places',
                canonical: {
                    type: 'google_place_id',
                    value: place.id,
                },
                places: {
                    rating: place.rating,
                    reviewCount: place.userRatingCount,
                    priceLevel: this.mapPriceLevel(place.priceLevel),
                    openNow: place.currentOpeningHours?.openNow,
                    hours: place.currentOpeningHours?.weekdayDescriptions,
                    address: place.formattedAddress,
                    phone: place.nationalPhoneNumber,
                    website: place.websiteUri,
                    googleMapsUrl: place.googleMapsUri,
                    location: place.location
                        ? { lat: place.location.latitude, lng: place.location.longitude }
                        : undefined,
                    photos: this.extractPhotos(place.photos),
                    reviews: this.extractReviews(place.reviews),
                },
            };
        } catch (error) {
            console.error('[GooglePlacesHook] Error:', error);
            return null;
        }
    }

    async healthCheck(): Promise<boolean> {
        try {
            const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Goog-Api-Key': this.apiKey,
                    'X-Goog-FieldMask': 'places.id',
                },
                body: JSON.stringify({
                    textQuery: 'health check',
                    languageCode: 'en',
                }),
            });
            return response.ok;
        } catch {
            return false;
        }
    }

    private buildSearchQuery(candidate: RawCAOCandidate, context: EnrichmentContext): string {
        const parts: string[] = [];

        parts.push(candidate.search_hint || candidate.name);

        if (context.searchLocation?.city) {
            parts.push(context.searchLocation.city);
        }

        return parts.join(' ').trim();
    }

    private mapPriceLevel(priceLevel?: string): string {
        if (!priceLevel) return '$$';

        const mapping: Record<string, string> = {
            PRICE_LEVEL_FREE: '$',
            PRICE_LEVEL_INEXPENSIVE: '$',
            PRICE_LEVEL_MODERATE: '$$',
            PRICE_LEVEL_EXPENSIVE: '$$$',
            PRICE_LEVEL_VERY_EXPENSIVE: '$$$$',
        };

        return mapping[priceLevel] || '$$';
    }

    private extractPhotos(photos?: Array<{ name: string }>): string[] {
        if (!photos || photos.length === 0) return [];

        return photos.slice(0, 5).map(
            photo =>
                `https://places.googleapis.com/v1/${photo.name}/media?key=${this.apiKey}&maxHeightPx=800&maxWidthPx=800`
        );
    }

    private extractReviews(
        reviews?: Array<{
            rating: number;
            text: { text: string };
            authorAttribution?: { displayName: string };
            relativePublishTimeDescription?: string;
        }>
    ): Array<{ rating: number; text: string; author: string }> {
        if (!reviews || reviews.length === 0) return [];

        return reviews.slice(0, 3).map(review => ({
            rating: review.rating,
            text: review.text?.text || '',
            author: review.authorAttribution?.displayName || 'Anonymous',
        }));
    }
}
