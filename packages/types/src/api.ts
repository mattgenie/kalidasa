/**
 * API Request/Response Types
 */

import type { PersonalizationCapsule } from './capsule.js';
import type { LogisticsContext } from './logistics.js';
import type { CAOResult, AnswerBundle, RenderHints, ComparisonMatrix, SourceItem } from './cao.js';

// ============================================================================
// Search Request
// ============================================================================

export type Domain = 'places' | 'movies' | 'music' | 'events' | 'videos' | 'articles' | 'general';

export interface KalidasaSearchRequest {
    /**
     * Query information
     */
    query: {
        /** Natural language search description */
        text: string;
        /** Primary domain for this search */
        domain: Domain;
        /** Primary intent (e.g., "find restaurant", "compare options") */
        intent?: string;
        /** Explicit exclusions from conversation */
        excludes?: string[];
    };

    /**
     * Personalization capsule - who is searching and their preferences
     */
    capsule: PersonalizationCapsule;

    /**
     * Logistics context - when, where, and practical constraints
     */
    logistics: LogisticsContext;

    /**
     * Conversation context for additional understanding
     */
    conversation?: ConversationContext;

    /**
     * Search options
     */
    options?: SearchOptions;
}

export interface ConversationContext {
    /** Recent messages for context */
    recentMessages?: Array<{
        speaker: string;
        content: string;
        isAgent: boolean;
    }>;
    /** Prior search descriptions this session */
    previousSearches?: string[];
    /** User corrections to remember */
    corrections?: string[];
}

export interface SearchOptions {
    /** Maximum results to return (default 12) */
    maxResults?: number;
    /** Include debug timing/stats (default false) */
    includeDebug?: boolean;
    /** Enrichment timeout in ms (default 2000) */
    enrichmentTimeout?: number;
}

// ============================================================================
// Search Response
// ============================================================================

export interface KalidasaSearchResponse {
    /** Verified enriched results */
    results: CAOResult[];

    /** Frontend rendering hints */
    renderHints: RenderHints;

    /** High-level answer summary */
    answerBundle?: AnswerBundle;

    /** For "X vs Y" comparison queries */
    comparisonMatrix?: ComparisonMatrix;

    /** For knowledge queries with sources */
    sourcesList?: SourceItem[];

    /** Debug information (if requested) */
    debug?: SearchDebug;
}

export interface SearchDebug {
    timing: {
        totalMs: number;
        caoGenerationMs: number;
        enrichmentMs: number;
    };
    enrichment: {
        candidatesGenerated: number;
        candidatesVerified: number;
        hookSuccessRates: Record<string, number>;
    };
    groundingSources?: string[];
    temporality?: {
        type: 'current' | 'evergreen' | 'historical';
        confidence: 'high' | 'medium' | 'low';
        useGrounding: boolean;
        reason: string;
    };
    error?: string;
}
