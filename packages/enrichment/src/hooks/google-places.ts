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
    EnrichmentDomain,
    HealthCheckResult
} from '@kalidasa/types';
import { parseRetryAfter } from '../health-monitor.js';

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
            'places.photos.authorAttributions',
            'places.photos.widthPx',
            'places.photos.heightPx',
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

            // Q7+Q13: Misresolution guard — findBestMatch returns null if no good match
            if (!place) {
                console.log(`[GooglePlacesHook] ✗ No match for "${candidate.name}" — all ${places.length} results too distant (name similarity < 0.3)`);
                return null;
            }

            // City validation: reject cross-city misresolutions using coordinates
            if (context.searchLocation?.city && place.location) {
                const expectedCenter = this.getCityCenter(context.searchLocation.city);
                if (expectedCenter) {
                    const dist = this.haversineKm(
                        place.location.latitude, place.location.longitude,
                        expectedCenter.lat, expectedCenter.lng
                    );
                    if (dist > 50) { // >50km = wrong city (narrowed from 100km per Q1)
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

    async healthCheck(): Promise<HealthCheckResult> {
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
            if (response.ok) return { healthy: true };
            return {
                healthy: false,
                error: {
                    httpStatus: response.status,
                    message: `Places API: ${response.status} ${response.statusText}`,
                    retryAfterMs: parseRetryAfter(response.headers.get('Retry-After')),
                },
            };
        } catch (e) {
            return {
                healthy: false,
                error: { message: e instanceof Error ? e.message : 'Connection failed' },
            };
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
     * Q7: Returns null if no match meets the minimum threshold (0.3).
     */
    private findBestMatch(
        candidateName: string,
        places: Array<{ id: string; displayName?: { text: string };[key: string]: any }>
    ): typeof places[0] | null {
        if (places.length === 0) return null;

        const target = candidateName.toLowerCase().trim();
        const MIN_SIMILARITY = 0.1; // Q7: Very low floor — only reject complete mismatches

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

        // Q7: Reject if best match is below minimum threshold
        if (bestScore >= 0 && bestScore < MIN_SIMILARITY) {
            console.log(`[GooglePlacesHook] ✗ Best match for "${candidateName}" is "${bestPlace.displayName?.text}" (score=${bestScore.toFixed(2)} < ${MIN_SIMILARITY})`);
            return null;
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

    /**
     * P4: Smart photo selection — prefer user-uploaded, landscape, larger images.
     * Filters out tiny images and ranks by quality signals.
     */
    private extractPhotos(photos?: Array<{
        name: string;
        widthPx?: number;
        heightPx?: number;
        authorAttributions?: Array<{ displayName?: string; uri?: string }>;
    }>): string[] {
        if (!photos || photos.length === 0) return [];

        // Score each photo by quality signals
        const scored = photos
            .filter(p => {
                // Filter out tiny images that are likely icons/logos
                const w = p.widthPx || 0;
                const h = p.heightPx || 0;
                if ((w > 0 || h > 0) && (w < 200 || h < 200)) return false;
                return true;
            })
            .map(photo => {
                let score = 0;

                // User-uploaded photos have real author attributions (not "Google")
                const hasRealAuthor = photo.authorAttributions?.some(
                    a => a.displayName && a.displayName !== 'Google' && a.displayName !== 'Google Maps'
                );
                if (hasRealAuthor) score += 3;

                // Landscape orientation is better for cards/UI
                const w = photo.widthPx || 0;
                const h = photo.heightPx || 0;
                if (w > h && w > 0) score += 1;

                // Larger images are generally higher quality
                const area = w * h;
                if (area > 1_000_000) score += 1;       // >1MP
                else if (area > 500_000) score += 0.5;  // >0.5MP

                return { photo, score };
            });

        // Sort by score descending, take top 5
        scored.sort((a, b) => b.score - a.score);

        return scored.slice(0, 5).map(
            ({ photo }) =>
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
