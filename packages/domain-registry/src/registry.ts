/**
 * Domain Registry
 * 
 * Central registry of all supported search domains.
 * Add new domains here to enable them across Kalidasa and Chat Agent.
 * 
 * IMPORTANT: This is the SINGLE SOURCE OF TRUTH for domain definitions.
 * Types like DomainName, SingularType, and ItemRendererType are derived
 * from this object at compile time. When you add a domain here, the
 * TypeScript compiler will guide you to every place that needs updating.
 */

import type { DomainDefinition } from './types.js';

export const REGISTRY_VERSION = '1.1.0';

export const DOMAIN_REGISTRY = {
    version: REGISTRY_VERSION,
    domains: {
        places: {
            name: 'places',
            singularType: 'place',
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
            singularType: 'movie',
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
            singularType: 'music',
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
            singularType: 'event',
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
            singularType: 'video',
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
        books: {
            name: 'books',
            singularType: 'book',
            displayName: 'Books',
            enrichmentHooks: ['books_composite'],
            identifierSpec: { author: '...', publisher: '...', year: '2024' },
            temporalityDefault: 'evergreen',
            itemRenderer: 'book_card',
            exclusionCategories: ['genres', 'topics'],
            detectionKeywords: [
                'book', 'books', 'read', 'reading', 'novel', 'nonfiction',
                'non-fiction', 'author', 'memoir', 'biography', 'autobiography',
                'textbook', 'bestseller', 'paperback', 'hardcover',
            ],
        },
        articles: {
            name: 'articles',
            singularType: 'article',
            displayName: 'Articles & Essays',
            enrichmentHooks: ['articles_composite'],
            identifierSpec: { author: '...', source: '...', url: '...' },
            temporalityDefault: 'evergreen',
            itemRenderer: 'article_card',
            exclusionCategories: ['sources', 'topics'],
            detectionKeywords: [
                'article', 'essay', 'blog', 'longform', 'post', 'editorial',
                'opinion', 'paper', 'thesis', 'report', 'journal',
                'magazine', 'column', 'piece',
            ],
        },
        news: {
            name: 'news',
            singularType: 'news',
            displayName: 'News',
            enrichmentHooks: ['newsapi'],
            identifierSpec: { source: '...', date: 'YYYY-MM-DD', url: '...' },
            temporalityDefault: 'current',
            itemRenderer: 'news_card',
            exclusionCategories: ['sources', 'topics'],
            detectionKeywords: [
                'news', 'breaking', 'headline', 'latest', 'current events',
                'today', 'yesterday', 'this week', 'recent',
            ],
        },
        general: {
            name: 'general',
            singularType: 'general',
            displayName: 'General Knowledge',
            enrichmentHooks: ['wikipedia'],
            identifierSpec: { wikipedia_title: '...' },
            temporalityDefault: 'evergreen',
            itemRenderer: 'generic_card',
            exclusionCategories: [],
            detectionKeywords: [],  // Fallback domain - no keywords
        },
    },
} as const satisfies { version: string; domains: Record<string, DomainDefinition> };
