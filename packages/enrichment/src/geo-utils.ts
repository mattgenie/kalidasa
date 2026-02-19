/**
 * Geo Utilities
 * 
 * Haversine distance calculation and Google Maps geocoding
 * for coordinate-based venue validation.
 */

const GOOGLE_MAPS_KEY = process.env.GOOGLE_PLACES_API_KEY || '';

/**
 * Geocode an address string to coordinates via Google Maps Geocoding API.
 * Returns null on any failure (missing key, network error, no results).
 */
export async function geocodeAddress(
    address: string
): Promise<{ lat: number; lng: number } | null> {
    if (!GOOGLE_MAPS_KEY || !address) return null;

    try {
        const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)
            }&key=${GOOGLE_MAPS_KEY}`;

        const res = await fetch(url);
        if (!res.ok) {
            console.warn(`[Geocode] Google Maps error: ${res.status}`);
            return null;
        }

        const data = await res.json();
        const loc = data.results?.[0]?.geometry?.location;
        return loc ? { lat: loc.lat, lng: loc.lng } : null;
    } catch (error) {
        console.warn('[Geocode] Failed:', error);
        return null;
    }
}

/**
 * Haversine distance between two lat/lng points in kilometers.
 * 
 * Reference distances:
 *   NYC ↔ Newark:    16km
 *   NYC ↔ Jersey City: 10km
 *   Oakland ↔ SF:     15km
 *   NYC ↔ Chicago: 1,146km
 */
export function haversineKm(
    a: { lat: number; lng: number },
    b: { lat: number; lng: number }
): number {
    const R = 6371; // Earth radius in km
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const x =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) *
        Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function toRad(deg: number): number {
    return deg * Math.PI / 180;
}
