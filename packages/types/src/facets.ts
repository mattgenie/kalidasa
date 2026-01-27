/**
 * Facet Types
 * 
 * Domain-specific controlled vocabulary for search facets.
 */

export interface Facet {
    /** Unique identifier, e.g., "fit.open_now" */
    id: string;
    /** Human-readable label */
    label: string;
    /** Signals/keywords that indicate this facet */
    signals: string[];
    /** Optional prompt hint for LLM */
    promptHint?: string;
}

export interface FacetLibrary {
    /** Domain this library applies to */
    domain: string;
    /** All facets in this library */
    facets: Facet[];
}

/**
 * All available facet domains
 */
export type FacetDomain =
    | 'places'
    | 'movies-tv'
    | 'music'
    | 'knowledge'
    | 'articles'
    | 'videos'
    | 'authority'
    | 'products'
    | 'temporal'
    | 'perspective'
    | 'signals'
    | 'community';
