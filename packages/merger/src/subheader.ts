/**
 * Subheader Generator
 * 
 * Generates compact, domain-specific info lines for search results.
 * Places:   "0.3 mi · Open now · 4.5★ · $$"
 * Movies:   "2018 · Alex Garland · 1h 55m"
 * Music:    "Bon Iver · Bon Iver, Bon Iver · 2011"
 * Events:   "Feb 7 · The McKittrick Hotel · $100–$150"
 * Videos:   "Vox · 12:34 · 2.1M views"
 * Articles: "Stratechery · Ben Thompson · Jan 15"
 */

import type { EnrichmentResult, Domain } from '@kalidasa/types';

const SEP = ' · ';

/**
 * Generate a subheader string from enrichment data for a given domain.
 * Returns undefined if no meaningful subheader can be built.
 */
export function generateSubheader(
    domain: Domain,
    enrichment: EnrichmentResult
): string | undefined {
    switch (domain) {
        case 'places':
            return buildPlacesSubheader(enrichment);
        case 'movies':
            return buildMoviesSubheader(enrichment);
        case 'music':
            return buildMusicSubheader(enrichment);
        case 'events':
            return buildEventsSubheader(enrichment);
        case 'videos':
            return buildVideosSubheader(enrichment);
        case 'articles':
            return buildArticlesSubheader(enrichment);
        case 'general':
            return buildGeneralSubheader(enrichment);
        default:
            return undefined;
    }
}

// ============================================================================
// Domain-specific builders
// ============================================================================

function buildPlacesSubheader(e: EnrichmentResult): string | undefined {
    const p = e.places;
    if (!p) return undefined;

    const chips: string[] = [];

    if (p.openNow !== undefined) {
        chips.push(p.openNow ? 'Open now' : 'Closed');
    }
    if (p.rating) {
        chips.push(`${p.rating}★`);
    }
    if (p.priceLevel) {
        chips.push(p.priceLevel);
    }

    return chips.length > 0 ? chips.join(SEP) : undefined;
}

function buildMoviesSubheader(e: EnrichmentResult): string | undefined {
    const m = e.movies;
    if (!m) return undefined;

    const chips: string[] = [];

    if (m.year) {
        chips.push(m.year);
    }
    if (m.director) {
        chips.push(m.director);
    }
    if (m.runtime) {
        chips.push(formatRuntime(m.runtime));
    }

    return chips.length > 0 ? chips.join(SEP) : undefined;
}

function buildMusicSubheader(e: EnrichmentResult): string | undefined {
    const m = e.music;
    if (!m) return undefined;

    const chips: string[] = [];

    if (m.artist) {
        chips.push(m.artist);
    }
    if (m.album) {
        chips.push(m.album);
    }
    if (m.releaseDate) {
        chips.push(formatYear(m.releaseDate));
    }

    return chips.length > 0 ? chips.join(SEP) : undefined;
}

function buildEventsSubheader(e: EnrichmentResult): string | undefined {
    const ev = e.events;
    if (!ev) return undefined;

    const chips: string[] = [];

    if (ev.startDate) {
        chips.push(formatShortDate(ev.startDate));
    }
    if (ev.venue) {
        chips.push(ev.venue);
    }
    if (ev.priceRange) {
        chips.push(ev.priceRange);
    }

    return chips.length > 0 ? chips.join(SEP) : undefined;
}

function buildVideosSubheader(e: EnrichmentResult): string | undefined {
    const v = e.videos;
    if (!v) return undefined;

    const chips: string[] = [];

    if (v.channelName) {
        chips.push(v.channelName);
    }
    if (v.duration) {
        chips.push(v.duration);
    }
    if (v.viewCount) {
        chips.push(formatViewCount(v.viewCount));
    }

    return chips.length > 0 ? chips.join(SEP) : undefined;
}

function buildArticlesSubheader(e: EnrichmentResult): string | undefined {
    const a = e.articles;
    if (!a) return undefined;

    const chips: string[] = [];

    if (a.source) {
        chips.push(a.source);
    }
    if (a.author) {
        chips.push(a.author);
    }
    if (a.publishedAt) {
        chips.push(formatShortDate(a.publishedAt));
    }

    return chips.length > 0 ? chips.join(SEP) : undefined;
}

function buildGeneralSubheader(e: EnrichmentResult): string | undefined {
    // General domain: try to extract anything identifiable from the general enrichment
    const g = e.general;
    if (!g) return undefined;

    // General enrichment is sparse — only summary/thumbnail/wikipedia
    // Not enough structured data for a meaningful chip bar
    return undefined;
}

// ============================================================================
// Formatting helpers
// ============================================================================

/** e.g. 115 minutes → "1h 55m" */
function formatRuntime(minutes: number): string {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h === 0) return `${m}m`;
    if (m === 0) return `${h}h`;
    return `${h}h ${m}m`;
}

/** Extract year from a date string like "2018-01-15" or "2018" */
function formatYear(dateStr: string): string {
    return dateStr.substring(0, 4);
}

/** Format a date string to "Feb 7" style */
function formatShortDate(dateStr: string): string {
    try {
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) return dateStr;
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } catch {
        return dateStr;
    }
}

/** Format view count: 2100000 → "2.1M views", 53000 → "53K views" */
function formatViewCount(count: number): string {
    if (count >= 1_000_000) {
        const m = count / 1_000_000;
        return `${m % 1 === 0 ? m.toFixed(0) : m.toFixed(1)}M views`;
    }
    if (count >= 1_000) {
        const k = count / 1_000;
        return `${k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)}K views`;
    }
    return `${count} views`;
}
