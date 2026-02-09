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
            const places = data.places;

            if (!places || places.length === 0) {
                return null;
            }

            // Find the best-matching place instead of blindly taking [0]
            const place = this.findBestMatch(candidate.name, places);

            // City validation: reject cross-city misresolutions using coordinates
            if (context.searchLocation?.city && place.location) {
                const expectedCenter = this.getCityCenter(context.searchLocation.city);
                if (expectedCenter) {
                    const dist = this.haversineKm(
                        place.location.latitude, place.location.longitude,
                        expectedCenter.lat, expectedCenter.lng
                    );
                    if (dist > 100) { // >100km = definitely wrong city
                        console.log(`[GooglePlacesHook] ✗ City mismatch for "${candidate.name}": ${dist.toFixed(0)}km from ${context.searchLocation.city} (${place.formattedAddress})`);
                        return null;
                    }
                }
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

        // Use identifiers for disambiguation — address + neighborhood for best results
        if (candidate.identifiers?.address) {
            parts.push(String(candidate.identifiers.address));
        }
        if (candidate.identifiers?.neighborhood) {
            // Only add neighborhood if not already included in address
            const addressStr = String(candidate.identifiers?.address || '');
            const neighborhood = String(candidate.identifiers.neighborhood);
            if (!addressStr.toLowerCase().includes(neighborhood.toLowerCase())) {
                parts.push(neighborhood);
            }
        }

        if (context.searchLocation?.city) {
            // Only add city if not already present in address or neighborhood
            const existing = parts.join(' ').toLowerCase();
            if (!existing.includes(context.searchLocation.city.toLowerCase())) {
                parts.push(context.searchLocation.city);
            }
        }

        return parts.join(' ').trim();
    }

    /**
     * Find the best-matching place from Google's results using name similarity.
     * Falls back to the first result if no good match is found.
     */
    private findBestMatch(
        candidateName: string,
        places: Array<{ id: string; displayName?: { text: string };[key: string]: any }>
    ): typeof places[0] {
        if (places.length === 1) return places[0];

        const target = candidateName.toLowerCase().trim();

        let bestPlace = places[0];
        let bestScore = -1;

        for (const place of places) {
            const placeName = (place.displayName?.text || '').toLowerCase().trim();
            if (!placeName) continue;

            // Exact match
            if (placeName === target) return place;

            // Substring containment (strong signal)
            if (placeName.includes(target) || target.includes(placeName)) {
                const score = 0.9;
                if (score > bestScore) {
                    bestScore = score;
                    bestPlace = place;
                }
                continue;
            }

            // Word overlap similarity
            const score = this.wordOverlapSimilarity(target, placeName);
            if (score > bestScore) {
                bestScore = score;
                bestPlace = place;
            }
        }

        // Log if best match differs from first result
        if (bestPlace !== places[0]) {
            console.log(`[GooglePlacesHook] Re-ranked: "${candidateName}" → "${bestPlace.displayName?.text}" (score=${bestScore.toFixed(2)}, was "${places[0].displayName?.text}")`);
        }

        return bestPlace;
    }

    /**
     * Calculate word overlap similarity between two strings.
     * Returns a score between 0 and 1.
     */
    private wordOverlapSimilarity(a: string, b: string): number {
        const wordsA = new Set(a.split(/\s+/).filter(w => w.length > 1));
        const wordsB = new Set(b.split(/\s+/).filter(w => w.length > 1));
        if (wordsA.size === 0 || wordsB.size === 0) return 0;

        let overlap = 0;
        for (const word of wordsA) {
            if (wordsB.has(word)) overlap++;
        }

        return overlap / Math.max(wordsA.size, wordsB.size);
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

    /**
     * Get approximate city center coordinates for distance-based validation.
     * Returns null for unknown cities (validation skipped).
     */
    private getCityCenter(city: string): { lat: number; lng: number } | null {
        const normalized = city.toLowerCase().replace(/\s+city$/i, '').trim();
        const centers: Record<string, { lat: number; lng: number }> = {
            'athens': { lat: 37.9838, lng: 23.7275 },
            'tokyo': { lat: 35.6762, lng: 139.6503 },
            'paris': { lat: 48.8566, lng: 2.3522 },
            'new york': { lat: 40.7128, lng: -74.0060 },
            'london': { lat: 51.5074, lng: -0.1278 },
            'bangkok': { lat: 13.7563, lng: 100.5018 },
            'rome': { lat: 41.9028, lng: 12.4964 },
            'barcelona': { lat: 41.3874, lng: 2.1686 },
            'berlin': { lat: 52.5200, lng: 13.4050 },
            'amsterdam': { lat: 52.3676, lng: 4.9041 },
            'lisbon': { lat: 38.7223, lng: -9.1393 },
            'dubai': { lat: 25.2048, lng: 55.2708 },
            'singapore': { lat: 1.3521, lng: 103.8198 },
            'hong kong': { lat: 22.3193, lng: 114.1694 },
            'sydney': { lat: -33.8688, lng: 151.2093 },
            'los angeles': { lat: 34.0522, lng: -118.2437 },
            'chicago': { lat: 41.8781, lng: -87.6298 },
            'san francisco': { lat: 37.7749, lng: -122.4194 },
            'miami': { lat: 25.7617, lng: -80.1918 },
            'seoul': { lat: 37.5665, lng: 126.9780 },
            'istanbul': { lat: 41.0082, lng: 28.9784 },
            'mexico city': { lat: 19.4326, lng: -99.1332 },
            'buenos aires': { lat: -34.6037, lng: -58.3816 },
            'mumbai': { lat: 19.0760, lng: 72.8777 },
            'cairo': { lat: 30.0444, lng: 31.2357 },
        };
        return centers[normalized] || null;
    }

    /**
     * Haversine distance in km between two lat/lng points.
     */
    private haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
        const R = 6371;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }
}
