/**
 * Facet Libraries - Domain-specific controlled vocabularies
 */

import type { Facet, FacetLibrary, FacetDomain } from '@kalidasa/types';

import { placesFacets } from './places.js';
import { moviesTvFacets } from './movies-tv.js';
import { musicFacets } from './music.js';
import { knowledgeFacets } from './knowledge.js';
import { articlesFacets } from './articles.js';
import { videosFacets } from './videos.js';
import { authorityFacets } from './authority.js';
import { productsFacets } from './products.js';
import { temporalFacets } from './temporal.js';
import { perspectiveFacets } from './perspective.js';
import { signalsFacets } from './signals.js';
import { communityFacets } from './community.js';

export * from './places.js';
export * from './movies-tv.js';
export * from './music.js';
export * from './knowledge.js';
export * from './articles.js';
export * from './videos.js';
export * from './authority.js';
export * from './products.js';
export * from './temporal.js';
export * from './perspective.js';
export * from './signals.js';
export * from './community.js';

/**
 * FacetRegistry - Access facets by domain
 */
export class FacetRegistry {
    private libraries: Map<string, FacetLibrary> = new Map();

    constructor() {
        this.registerLibrary('places', placesFacets);
        this.registerLibrary('movies-tv', moviesTvFacets);
        this.registerLibrary('music', musicFacets);
        this.registerLibrary('knowledge', knowledgeFacets);
        this.registerLibrary('articles', articlesFacets);
        this.registerLibrary('videos', videosFacets);
        this.registerLibrary('authority', authorityFacets);
        this.registerLibrary('products', productsFacets);
        this.registerLibrary('temporal', temporalFacets);
        this.registerLibrary('perspective', perspectiveFacets);
        this.registerLibrary('signals', signalsFacets);
        this.registerLibrary('community', communityFacets);
    }

    private registerLibrary(domain: string, facets: Facet[]): void {
        this.libraries.set(domain, { domain, facets });
    }

    /**
     * Get all facets for a domain
     */
    getFacetsForDomain(domain: string): Facet[] {
        const library = this.libraries.get(domain);
        return library?.facets ?? [];
    }

    /**
     * Get facets for multiple domains
     */
    getFacetsForDomains(domains: string[]): Facet[] {
        return domains.flatMap(d => this.getFacetsForDomain(d));
    }

    /**
     * Get a specific facet by ID
     */
    getFacetById(id: string): Facet | undefined {
        for (const library of this.libraries.values()) {
            const facet = library.facets.find(f => f.id === id);
            if (facet) return facet;
        }
        return undefined;
    }

    /**
     * Get all available domains
     */
    getDomains(): string[] {
        return Array.from(this.libraries.keys());
    }

    /**
     * Format facets for prompt inclusion
     */
    formatForPrompt(domains: string[]): string {
        const facets = this.getFacetsForDomains(domains);
        return facets
            .map(f => `- ${f.id}: ${f.label}${f.promptHint ? ` (${f.promptHint})` : ''}`)
            .join('\n');
    }
}
