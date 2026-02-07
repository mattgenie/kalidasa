/**
 * Domain Registry
 * 
 * Central registry of all supported search domains.
 * Add new domains here to enable them across Kalidasa and Chat Agent.
 */

import type { DomainDefinition, DomainRegistry } from './types.js';

export const REGISTRY_VERSION = '1.0.0';

export const DOMAIN_REGISTRY: DomainRegistry = {
    version: REGISTRY_VERSION,
    domains: {
        places: {
            name: 'places',
            displayName: 'Restaurants & Venues',
            enrichmentHooks: ['google_places', 'yelp'],
            identifierSpec: { address: '...', city: '...' },
            temporalityDefault: 'current',
            itemRenderer: 'place_card',
            exclusionCategories: ['cuisines', 'features', 'priceRanges', 'neighborhoods'],
            detectionKeywords: [
                'restaurant', 'bar', 'cafe', 'food', 'eat', 'dinner', 'lunch',
                'brunch', 'breakfast', 'pizza', 'sushi', 'thai', 'italian',
                'mexican', 'chinese', 'indian', 'french', 'steakhouse',
                'venue', 'club', 'pub', 'bistro', 'diner', 'bakery'
            ],
        },
        movies: {
            name: 'movies',
            displayName: 'Movies & TV',
            enrichmentHooks: ['tmdb', 'omdb'],
            identifierSpec: { year: '2024', director: '...' },
            temporalityDefault: 'evergreen',
            itemRenderer: 'movie_card',
            exclusionCategories: ['genres', 'contentTypes', 'eras', 'ratings'],
            detectionKeywords: [
                'movie', 'film', 'watch', 'streaming', 'series', 'show',
                'netflix', 'hulu', 'disney', 'hbo', 'cinema', 'theaters',
                'documentary', 'comedy', 'drama', 'horror', 'action',
                'thriller', 'romance', 'sci-fi', 'animated', 'anime'
            ],
        },
        music: {
            name: 'music',
            displayName: 'Music & Songs',
            enrichmentHooks: ['apple_music', 'spotify'],
            identifierSpec: { artist: '...', album: '...' },
            temporalityDefault: 'evergreen',
            itemRenderer: 'music_card',
            exclusionCategories: ['genres', 'artists', 'moods', 'eras'],
            detectionKeywords: [
                'music', 'song', 'album', 'artist', 'playlist', 'listen',
                'spotify', 'band', 'singer', 'track', 'beats', 'lyrics',
                'jazz', 'rock', 'pop', 'hip-hop', 'classical', 'country',
                'electronic', 'r&b', 'soul', 'reggae', 'blues'
            ],
        },
        events: {
            name: 'events',
            displayName: 'Events & Experiences',
            enrichmentHooks: ['ticketmaster', 'eventbrite'],
            identifierSpec: { venue: '...', date: 'YYYY-MM-DD', city: '...' },
            temporalityDefault: 'current',
            itemRenderer: 'event_card',
            exclusionCategories: ['eventTypes', 'venues', 'priceRanges'],
            detectionKeywords: [
                'event', 'concert', 'show', 'ticket', 'festival', 'happening',
                'performance', 'live', 'tour', 'exhibition', 'conference',
                'workshop', 'meetup', 'party', 'gig', 'show tonight',
                'this weekend', 'upcoming'
            ],
        },
        videos: {
            name: 'videos',
            displayName: 'Videos',
            enrichmentHooks: ['youtube', 'vimeo'],
            identifierSpec: { channel: '...', url: '...' },
            temporalityDefault: 'evergreen',
            itemRenderer: 'video_card',
            exclusionCategories: ['channels', 'topics'],
            detectionKeywords: [
                'video', 'youtube', 'tutorial', 'clip', 'vlog', 'review',
                'how to', 'watch video', 'channel', 'subscribe', 'shorts'
            ],
        },
        articles: {
            name: 'articles',
            displayName: 'Articles & News',
            enrichmentHooks: ['newsapi', 'newsmesh'],
            identifierSpec: { source: '...', date: 'YYYY-MM-DD', url: '...' },
            temporalityDefault: 'current',
            itemRenderer: 'article_card',
            exclusionCategories: ['sources', 'topics'],
            detectionKeywords: [
                'article', 'news', 'read', 'story', 'report', 'breaking',
                'headline', 'blog', 'post', 'editorial', 'opinion',
                'latest news', 'current events'
            ],
        },
        general: {
            name: 'general',
            displayName: 'General Knowledge',
            enrichmentHooks: ['wikipedia'],
            identifierSpec: { wikipedia_title: '...' },
            temporalityDefault: 'evergreen',
            itemRenderer: 'generic_card',
            exclusionCategories: [],
            detectionKeywords: [],  // Fallback domain - no keywords
        },
    },
};
