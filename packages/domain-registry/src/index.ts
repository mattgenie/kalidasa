/**
 * @kalidasa/domain-registry
 * 
 * Centralized domain definitions for Kalidasa search.
 * Use this package to:
 * - Detect domain from query text
 * - Get domain-specific configuration
 * - Validate domain names
 * 
 * Adding a new domain:
 * 1. Add DomainDefinition to registry.ts
 * 2. Publish new version
 * 3. Chat Agent automatically picks it up
 */

import { DOMAIN_REGISTRY, REGISTRY_VERSION } from './registry.js';
import type { DomainDefinition, DomainRegistry } from './types.js';

// Re-export types
export * from './types.js';
export { DOMAIN_REGISTRY, REGISTRY_VERSION };

// ============================================================================
// Derived Types (compile-time literal unions from registry)
// ============================================================================

/** Compile-time literal union of all domain names: 'places' | 'movies' | 'music' | ... */
export type DomainName = keyof typeof DOMAIN_REGISTRY.domains;

/** Compile-time literal union of all singular result types: 'place' | 'movie' | 'music' | ... */
export type SingularType = typeof DOMAIN_REGISTRY.domains[DomainName]['singularType'];

/** Compile-time literal union of all item renderers: 'place_card' | 'movie_card' | ... */
export type ItemRendererType = typeof DOMAIN_REGISTRY.domains[DomainName]['itemRenderer'];

/** Typed domain names array for runtime iteration */
export const DOMAIN_NAMES = Object.keys(DOMAIN_REGISTRY.domains) as DomainName[];

/** Get domain definition by name */
export function getDomain(name: string): DomainDefinition | undefined {
    if (name in DOMAIN_REGISTRY.domains) {
        return DOMAIN_REGISTRY.domains[name as DomainName];
    }
    return undefined;
}

/** Check if domain is known */
export function isKnownDomain(name: string): boolean {
    return name in DOMAIN_REGISTRY.domains;
}

/** Get domain or fallback to general */
export function getDomainOrDefault(name: string): DomainDefinition {
    if (name in DOMAIN_REGISTRY.domains) {
        return DOMAIN_REGISTRY.domains[name as DomainName];
    }
    return DOMAIN_REGISTRY.domains.general;
}

// ============================================================================
// Domain Detection
// ============================================================================

/**
 * Detect domain from query text (lightweight keyword matching).
 * Returns 'general' if no domain matches.
 */
export function detectDomainFromQuery(query: string): string {
    const queryLower = query.toLowerCase();

    // Score each domain by keyword matches
    let bestDomain = 'general';
    let bestScore = 0;

    for (const [name, def] of Object.entries(DOMAIN_REGISTRY.domains)) {
        if (name === 'general') continue;  // Check last
        const keywords = def.detectionKeywords || [];

        let score = 0;
        for (const kw of keywords) {
            // Word boundary matching for better precision
            const regex = new RegExp(`\\b${escapeRegex(kw)}\\b`, 'i');
            if (regex.test(queryLower)) {
                score++;
            }
        }

        if (score > bestScore) {
            bestScore = score;
            bestDomain = name;
        }
    }

    return bestDomain;
}

/** Escape special regex characters */
function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ============================================================================
// Domain Configuration Getters
// ============================================================================

/** Get exclusion categories for a domain */
export function getExclusionCategories(domain: string): string[] {
    return getDomainOrDefault(domain).exclusionCategories;
}

/** Get enrichment hooks for a domain */
export function getEnrichmentHooks(domain: string): string[] {
    return getDomainOrDefault(domain).enrichmentHooks;
}

/** Get temporality default for a domain */
export function getTemporalityDefault(domain: string): 'current' | 'evergreen' | 'historical' {
    return getDomainOrDefault(domain).temporalityDefault;
}

/** Get item renderer for a domain */
export function getItemRenderer(domain: string): string {
    return getDomainOrDefault(domain).itemRenderer;
}

/** Get identifier spec for a domain */
export function getIdentifierSpec(domain: string): Record<string, string> {
    return getDomainOrDefault(domain).identifierSpec;
}

/** Get display name for a domain */
export function getDisplayName(domain: string): string {
    return getDomainOrDefault(domain).displayName;
}
