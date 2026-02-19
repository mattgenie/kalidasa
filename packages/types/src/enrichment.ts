/**
 * Enrichment Types
 * 
 * Interface for enrichment hooks and related types.
 */

import type { CAOResult, EnrichmentResult } from './cao.js';
import type { Domain } from './api.js';

// ============================================================================
// Raw CAO (before enrichment)
// ============================================================================

export interface RawCAO {
    candidates: RawCAOCandidate[];
    answerBundle?: {
        headline: string;
        summary: string;
        facetsApplied: string[];
    };
    renderHints?: {
        componentType: string;
        itemRenderer: string;
    };
}

export interface RawCAOCandidate {
    /** Display name */
    name: string;
    /** Result type */
    type: 'entity' | 'article' | 'video' | 'track' | 'event';
    /** Summary description */
    summary: string;
    /** Domain-specific identifiers for unique identification */
    identifiers?: Record<string, string | number>;
    /** Reasoning from Gemini (optional in leaner schema) */
    reasoning?: {
        whyRecommended: string;
        pros: string[];
        cons: string[];
    };
    /** Personalization notes (supports both simple and complex formats) */
    personalization?: {
        forUser?: string | { text: string; basis: string; confidence: string };
        forGroup?: Array<{ memberId: string; memberName: string; note: { text: string; basis: string; confidence: string } }>;
        groupNotes?: string[];
    };
    /** Which enrichment hooks to call */
    enrichment_hooks: string[];
    /** Search hint for finding this in external APIs */
    search_hint?: string;
    /** Facet scores */
    facetScores?: Record<string, number>;
}

// ============================================================================
// Composite Key & Display Label Helpers
// ============================================================================

/**
 * Build a deterministic composite key from domain + identifiers.
 * Used for deduplication and identity tracking across the pipeline.
 */
export function compositeKey(
    domain: string,
    candidate: { name: string; identifiers?: Record<string, string | number> }
): string {
    const id = candidate.identifiers || {};
    const norm = (s: string | number | undefined) => String(s || '').toLowerCase().trim();

    switch (domain) {
        case 'music':
            return `music::${norm(id.artist)}::${norm(candidate.name)}::${norm(id.year)}`;
        case 'movies':
            return `movies::${norm(id.director)}::${norm(candidate.name)}::${norm(id.year)}`;
        case 'books':
            return `books::${norm(id.author)}::${norm(candidate.name)}::${norm(id.year)}`;
        case 'events':
            return `events::${norm(candidate.name)}::${norm(id.venue)}::${norm(id.city)}`;
        case 'news':
            return `news::${norm(id.source)}::${norm(candidate.name)}`;
        case 'general':
            return `general::${norm(id.category)}::${norm(candidate.name)}`;
        default:
            return `${domain}::${norm(candidate.name)}`;
    }
}

/**
 * Build a human-readable display label from identifiers.
 * Used as the key in LLM summary/forUser prompts to eliminate
 * fuzzy name matching failures (the forUser fallback bug).
 *
 * Examples:
 *   music:  "Kind of Blue (Miles Davis, 1959)"
 *   movies: "Inception (Christopher Nolan, 2010)"
 *   books:  "Thinking, Fast and Slow (Daniel Kahneman, 2011)"
 *   events: "Outside Lands at Golden Gate Park"
 */
export function buildDisplayLabel(
    domain: string,
    candidate: { name: string; identifiers?: Record<string, string | number> }
): string {
    const id = candidate.identifiers || {};
    switch (domain) {
        case 'music': {
            const parts = [id.artist, id.year].filter(Boolean);
            return parts.length ? `${candidate.name} (${parts.join(', ')})` : candidate.name;
        }
        case 'movies': {
            const parts = [id.director, id.year].filter(Boolean);
            return parts.length ? `${candidate.name} (${parts.join(', ')})` : candidate.name;
        }
        case 'books': {
            const parts = [id.author, id.year].filter(Boolean);
            return parts.length ? `${candidate.name} (${parts.join(', ')})` : candidate.name;
        }
        case 'events':
            return id.venue ? `${candidate.name} at ${id.venue}` : candidate.name;
        default:
            return candidate.name;
    }
}

// ============================================================================
// Enrichment Hook Interface
// ============================================================================

import type { DomainName } from '@kalidasa/domain-registry';

export type EnrichmentDomain = string;  // Hooks may support disabled/future domains

/**
 * Structured health check result for error classification.
 * Hooks may return either boolean (backward compat) or this structure.
 */
export interface HealthCheckResult {
    healthy: boolean;
    error?: {
        httpStatus?: number;      // 429, 500, 401, etc.
        message: string;
        retryAfterMs?: number;    // From Retry-After header, if present
    };
}

export interface EnrichmentHook {
    /** Unique identifier for this hook */
    name: string;

    /** Which domains this hook can enrich */
    domains: EnrichmentDomain[];

    /** Priority for this hook (higher = tried first for same domain) */
    priority: number;

    /**
     * Attempt to enrich a candidate with verified data.
     * Returns null if candidate cannot be verified.
     * Should handle its own errors and return null on failure.
     */
    enrich(candidate: RawCAOCandidate, context: EnrichmentContext): Promise<EnrichmentData | null>;

    /**
     * Optional: Health check for this hook's API.
     * Can return boolean (backward compat) or HealthCheckResult (with error details).
     */
    healthCheck?(): Promise<boolean | HealthCheckResult>;
}

export interface EnrichmentContext {
    /** Search location for geo-based enrichment */
    searchLocation?: {
        city?: string;
        coordinates?: { lat: number; lng: number };
    };
    /** Timeout for this enrichment call */
    timeout: number;
    /** Request ID for logging */
    requestId: string;
}

export interface EnrichmentData {
    /** Verification succeeded */
    verified: boolean;
    /** Source hook name */
    source: string;
    /** Canonical ID for deduplication */
    canonical?: {
        type: string;
        value: string;
    };
    /** Domain-specific enrichment data */
    places?: import('./cao.js').PlacesEnrichment;
    movies?: import('./cao.js').MoviesEnrichment;
    music?: import('./cao.js').MusicEnrichment;
    events?: import('./cao.js').EventsEnrichment;
    videos?: import('./cao.js').VideosEnrichment;
    articles?: import('./cao.js').ArticlesEnrichment;
    books?: import('./cao.js').BooksEnrichment;
    news?: import('./cao.js').NewsEnrichment;
    general?: import('./cao.js').GeneralEnrichment;
}

// ============================================================================
// Enriched Candidate
// ============================================================================

export interface EnrichedCandidate extends RawCAOCandidate {
    /** Whether enrichment succeeded */
    verified: boolean;
    /** Enrichment data */
    enrichment?: EnrichmentData;
}
