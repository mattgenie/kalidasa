/**
 * Music Facets
 */

import type { Facet } from '@kalidasa/types';

export const musicFacets: Facet[] = [
    // Taste
    {
        id: 'taste.genre',
        label: 'Genre',
        signals: ['pop', 'rock', 'hip-hop', 'jazz', 'classical', 'electronic', 'country', 'r&b', 'indie'],
    },
    {
        id: 'taste.mood_energy',
        label: 'Mood/Energy',
        signals: ['upbeat', 'chill', 'melancholic', 'energetic', 'relaxing', 'intense'],
    },
    {
        id: 'taste.tempo',
        label: 'Tempo',
        signals: ['fast', 'slow', 'moderate', 'danceable', 'mellow'],
    },
    {
        id: 'taste.era',
        label: 'Era',
        signals: ['classic', 'modern', '80s', '90s', '2000s', 'new release', 'throwback'],
    },
    {
        id: 'taste.vocal_style',
        label: 'Vocal Style',
        signals: ['instrumental', 'vocals', 'female vocals', 'male vocals', 'acoustic'],
    },

    // Context
    {
        id: 'context.activity',
        label: 'Activity',
        signals: ['workout', 'studying', 'driving', 'cooking', 'party', 'sleeping'],
    },
    {
        id: 'context.social',
        label: 'Social Setting',
        signals: ['party', 'dinner party', 'background', 'solo listening', 'karaoke'],
    },
    {
        id: 'context.time_of_day',
        label: 'Time of Day',
        signals: ['morning', 'afternoon', 'evening', 'late night', 'wake up'],
    },
    {
        id: 'context.mood_setting',
        label: 'Mood Setting',
        signals: ['romantic', 'productive', 'focus', 'celebration', 'relaxation'],
    },

    // Discovery
    {
        id: 'discovery.trending',
        label: 'Trending',
        signals: ['trending', 'viral', 'popular now', 'chart-topping'],
    },
    {
        id: 'discovery.hidden_gem',
        label: 'Hidden Gem',
        signals: ['underrated', 'hidden gem', 'underground', 'indie'],
    },
    {
        id: 'discovery.similar_to',
        label: 'Similar To',
        signals: ['like', 'similar to', 'fans of', 'if you like'],
    },

    // Format
    {
        id: 'format.playlist',
        label: 'Playlist',
        signals: ['playlist', 'mix', 'compilation', 'curated'],
    },
    {
        id: 'format.album',
        label: 'Album',
        signals: ['album', 'full album', 'lp', 'record'],
    },
    {
        id: 'format.single',
        label: 'Single',
        signals: ['single', 'song', 'track'],
    },

    // Artist
    {
        id: 'artist.specific',
        label: 'Specific Artist',
        signals: ['by', 'from', 'artist', 'band', 'singer'],
    },
    {
        id: 'artist.emerging',
        label: 'Emerging Artist',
        signals: ['new artist', 'emerging', 'up and coming', 'debut'],
    },
];
