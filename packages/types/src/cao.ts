/**
 * Compound Answer Object (CAO) Types
 * 
 * The structured output of a Kalidasa search.
 */

// ============================================================================
// CAO Result
// ============================================================================

export type CAOResultType = 'entity' | 'article' | 'video' | 'track' | 'event';

export interface CAOResult {
    /** Unique result identifier */
    id: string;

    /** Result type */
    type: CAOResultType;

    /** Display name */
    name: string;

    /** Compact info bar, e.g. "0.3 mi · Open now · 4.5★ · $$" */
    subheader?: string;

    /** 2-3 sentence description */
    summary: string;

    /** Canonical ID for deduplication */
    canonical?: CanonicalId;

    /** LLM-generated reasoning */
    reasoning: ResultReasoning;

    /** Per-member personalization notes */
    personalization: PersonalizationBlock;

    /** Verified enrichment data from hooks */
    enrichment: EnrichmentResult;

    /** Facet scores for this result */
    facetScores?: Record<string, number>;
}

export interface CanonicalId {
    type: 'google_place_id' | 'tmdb_id' | 'spotify_id' | 'apple_music_id' | 'imdb_id' | 'yelp_id' | 'wikipedia_title' | 'youtube_id' | 'eventbrite_id' | 'ticketmaster_id';
    value: string;
}

export interface ResultReasoning {
    /** Why Gemini recommended this */
    whyRecommended: string;
    /** Pros */
    pros: string[];
    /** Cons */
    cons: string[];
}

export interface PersonalizationBlock {
    /** Note for the primary user */
    forUser?: PersonalizationNote;
    /** Notes for group members */
    forGroup?: GroupMemberNote[];
    /** Notes about overall group fit */
    groupNotes?: string[];
}

export interface PersonalizationNote {
    text: string;
    basis: 'capsule' | 'evidence' | 'inference';
    confidence: 'high' | 'medium' | 'low';
}

export interface GroupMemberNote {
    memberId: string;
    memberName: string;
    note: PersonalizationNote;
}

// ============================================================================
// Enrichment Result
// ============================================================================

export interface EnrichmentResult {
    /** Whether this result was verified by an enrichment hook */
    verified: boolean;
    /** Which hook verified this */
    source?: string;

    /** Places enrichment data */
    places?: PlacesEnrichment;
    /** Movies enrichment data */
    movies?: MoviesEnrichment;
    /** Music enrichment data */
    music?: MusicEnrichment;
    /** Events enrichment data */
    events?: EventsEnrichment;
    /** Videos enrichment data */
    videos?: VideosEnrichment;
    /** Articles enrichment data */
    articles?: ArticlesEnrichment;
    /** General enrichment data */
    general?: GeneralEnrichment;
}

export interface PlacesEnrichment {
    rating?: number;
    reviewCount?: number;
    priceLevel?: string;
    openNow?: boolean;
    hours?: string[];
    address?: string;
    phone?: string;
    website?: string;
    googleMapsUrl?: string;
    location?: { lat: number; lng: number };
    photos?: string[];
    reviews?: Array<{
        rating: number;
        text: string;
        author: string;
    }>;
}

export interface MoviesEnrichment {
    rating?: number;
    year?: string;
    runtime?: number;
    genres?: string[];
    posterUrl?: string;
    backdropUrl?: string;
    overview?: string;
    cast?: Array<{ name: string; character: string }>;
    director?: string;
    platforms?: string[];
    imdbId?: string;
}

export interface MusicEnrichment {
    artist?: string;
    artists?: string[];
    album?: string;
    durationMs?: number;
    albumArt?: string;
    previewUrl?: string;
    explicit?: boolean;
    genres?: string[];
    releaseDate?: string;
}

export interface EventsEnrichment {
    venue?: string;
    venueAddress?: string;
    startDate?: string;
    endDate?: string;
    ticketUrl?: string;
    priceRange?: string;
    imageUrl?: string;
    status?: string;
}

export interface VideosEnrichment {
    title?: string;
    description?: string;
    thumbnailUrl?: string;
    duration?: string;
    viewCount?: number;
    likeCount?: number;
    publishedAt?: string;
    channelName?: string;
    channelId?: string;
    videoUrl?: string;
}

export interface ArticlesEnrichment {
    author?: string;
    publishedAt?: string;
    source?: string;
    imageUrl?: string;
    url?: string;
    summary?: string;
}

export interface GeneralEnrichment {
    summary?: string;
    thumbnail?: string;
    wikipediaUrl?: string;
}

// ============================================================================
// Answer Bundle & Render Hints
// ============================================================================

export interface AnswerBundle {
    /** Headline summary, e.g., "8 Italian restaurants in SoHo" */
    headline: string;
    /** 2-3 sentence overview */
    summary: string;
    /** Which facets were applied */
    facetsApplied: string[];
}

export interface RenderHints {
    /** Component type for the frontend */
    componentType: 'search_grid' | 'carousel' | 'detailed_list' | 'comparison_matrix';
    /** Domain for styling */
    domain: string;
    /** Item renderer component */
    itemRenderer: 'place_card' | 'movie_card' | 'music_card' | 'event_card' | 'video_card' | 'article_card' | 'generic_card';
    /** Layout options */
    layout?: {
        columns?: number;
        showMap?: boolean;
    };
}

// ============================================================================
// Optional Shapes
// ============================================================================

export interface ComparisonMatrix {
    /** Items being compared */
    items: string[];
    /** Comparison dimensions */
    dimensions: Array<{
        name: string;
        values: Record<string, string | number | boolean>;
    }>;
    /** Overall recommendation */
    recommendation?: string;
}

export interface SourceItem {
    title: string;
    url: string;
    snippet?: string;
    publishedAt?: string;
    source?: string;
}
