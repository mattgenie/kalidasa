/**
 * Domain Registry Types
 * 
 * Type definitions for domain configuration.
 */

/**
 * Complete definition of a search domain.
 */
export interface DomainDefinition {
    /** Canonical name: places, movies, music, etc. */
    name: string;

    /** Singular result type: place, movie, music, etc. */
    singularType: string;

    /** Human-readable display name */
    displayName: string;

    /** Enrichment hooks in priority order */
    enrichmentHooks: string[];

    /** Identifier spec for CAO generation */
    identifierSpec: Record<string, string>;

    /** Default temporality (for grounding decisions) */
    temporalityDefault: 'current' | 'evergreen' | 'historical';

    /** Frontend item renderer component */
    itemRenderer: string;

    /** Categories for exclusion tracking */
    exclusionCategories: string[];

    /** Keywords for domain detection (optional) */
    detectionKeywords?: string[];

    /** Domain-specific prompt hints (optional) */
    promptHints?: string;
}

/**
 * The domain registry structure.
 */
export interface DomainRegistry {
    version: string;
    domains: Record<string, DomainDefinition>;
}
