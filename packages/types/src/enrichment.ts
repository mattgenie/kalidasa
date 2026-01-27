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
    /** Reasoning from Gemini */
    reasoning: {
        whyRecommended: string;
        pros: string[];
        cons: string[];
    };
    /** Personalization notes */
    personalization?: {
        forUser?: { text: string; basis: string; confidence: string };
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
// Enrichment Hook Interface
// ============================================================================

export type EnrichmentDomain = 'places' | 'movies' | 'music' | 'events' | 'videos' | 'articles' | 'general';

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
     * Optional: Health check for this hook's API
     */
    healthCheck?(): Promise<boolean>;
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
