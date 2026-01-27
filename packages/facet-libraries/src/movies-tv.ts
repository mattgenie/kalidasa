/**
 * Movies & TV Facets
 */

import type { Facet } from '@kalidasa/types';

export const moviesTvFacets: Facet[] = [
    // Taste Facets
    {
        id: 'taste.genre',
        label: 'Genre',
        signals: ['action', 'comedy', 'drama', 'horror', 'thriller', 'romance', 'sci-fi', 'documentary'],
    },
    {
        id: 'taste.mood',
        label: 'Mood',
        signals: ['funny', 'scary', 'inspiring', 'relaxing', 'intense', 'feel-good', 'dark'],
    },
    {
        id: 'taste.pace',
        label: 'Pacing',
        signals: ['slow burn', 'fast-paced', 'epic', 'short', 'bingeable'],
    },
    {
        id: 'taste.era',
        label: 'Era',
        signals: ['classic', 'modern', '80s', '90s', '2000s', 'new release', 'retro'],
    },
    {
        id: 'taste.tone',
        label: 'Tone',
        signals: ['light', 'dark', 'quirky', 'serious', 'satirical', 'emotional'],
    },

    // Content Type
    {
        id: 'content.type',
        label: 'Content Type',
        signals: ['movie', 'tv show', 'series', 'miniseries', 'documentary', 'anime'],
    },
    {
        id: 'content.length',
        label: 'Length',
        signals: ['short', 'feature length', 'limited series', 'multiple seasons'],
    },
    {
        id: 'content.rating',
        label: 'Content Rating',
        signals: ['family-friendly', 'pg', 'mature', 'adult', 'kid-safe'],
    },

    // Quality
    {
        id: 'quality.critical_acclaim',
        label: 'Critical Acclaim',
        signals: ['award-winning', 'critically acclaimed', 'oscar', 'emmy', 'best of'],
    },
    {
        id: 'quality.audience_favorite',
        label: 'Audience Favorite',
        signals: ['popular', 'viral', 'cult classic', 'beloved', 'trending'],
    },
    {
        id: 'quality.hidden_gem',
        label: 'Hidden Gem',
        signals: ['underrated', 'overlooked', 'hidden gem', 'sleeper hit'],
    },

    // Availability
    {
        id: 'availability.streaming',
        label: 'Streaming Platform',
        signals: ['netflix', 'hulu', 'disney+', 'hbo', 'amazon prime', 'apple tv'],
    },
    {
        id: 'availability.free',
        label: 'Free to Watch',
        signals: ['free', 'included', 'no subscription'],
    },

    // People
    {
        id: 'people.actor',
        label: 'Actor',
        signals: ['starring', 'with', 'actor', 'actress', 'lead'],
    },
    {
        id: 'people.director',
        label: 'Director',
        signals: ['directed by', 'from the director of', 'filmmaker'],
    },

    // Context
    {
        id: 'context.watch_party',
        label: 'Watch Party',
        signals: ['group', 'friends', 'party', 'everyone will enjoy'],
    },
    {
        id: 'context.solo',
        label: 'Solo Viewing',
        signals: ['alone', 'personal', 'just me'],
    },
    {
        id: 'context.date',
        label: 'Date Night',
        signals: ['date', 'couple', 'romantic evening'],
    },
    {
        id: 'context.background',
        label: 'Background Viewing',
        signals: ['background', 'while working', 'casual'],
    },
];
