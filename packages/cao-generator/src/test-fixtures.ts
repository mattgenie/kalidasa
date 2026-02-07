/**
 * Test Fixtures for Stage 1c Evaluation
 * 
 * Realistic test queries with capsule data for evaluating
 * summary and forUser quality.
 */

import type { PersonalizationCapsule } from '@kalidasa/types';
import type { Stage1aCandidate } from './stage-1a-prompt.js';

export interface EvalFixture {
    name: string;
    domain: string;
    queryText: string;
    capsule: PersonalizationCapsule;
    candidates: Stage1aCandidate[];
}

// ============================================================================
// Capsules (reusable across fixtures)
// ============================================================================

const groupCapsule: PersonalizationCapsule = {
    mode: 'group',
    members: [
        {
            id: 'matt',
            name: 'Matt',
            preferences: {
                places: {
                    favoriteCuisines: ['Japanese', 'Italian', 'Thai'],
                    dietaryRestrictions: ['none'],
                    pricePreference: '$$$',
                    ambiance: ['cozy', 'intimate', 'lively'],
                },
                movies: {
                    favoriteGenres: ['sci-fi', 'thriller', 'dark comedy'],
                    dislikes: ['romantic comedies', 'horror'],
                },
                music: {
                    favoriteGenres: ['indie rock', 'electronic', 'jazz'],
                    favoriteArtists: ['Radiohead', 'Bon Iver', 'Tame Impala'],
                },
            },
        },
        {
            id: 'sarah',
            name: 'Sarah',
            preferences: {
                places: {
                    favoriteCuisines: ['Mexican', 'Mediterranean', 'Vietnamese'],
                    dietaryRestrictions: ['vegetarian'],
                    pricePreference: '$$',
                    ambiance: ['casual', 'outdoor seating'],
                },
                movies: {
                    favoriteGenres: ['drama', 'documentary', 'indie'],
                    dislikes: ['action', 'superhero'],
                },
            },
        },
    ],
};

const soloCapsule: PersonalizationCapsule = {
    mode: 'solo',
    members: [
        {
            id: 'joao',
            name: 'João',
            preferences: {
                places: {
                    favoriteCuisines: ['Brazilian', 'Portuguese', 'sushi'],
                    dietaryRestrictions: ['none'],
                    pricePreference: '$$$',
                    ambiance: ['upscale', 'date night'],
                },
                movies: {
                    favoriteGenres: ['drama', 'foreign film', 'noir'],
                    dislikes: ['animation'],
                },
                music: {
                    favoriteGenres: ['bossa nova', 'MPB', 'jazz'],
                    favoriteArtists: ['Tom Jobim', 'Caetano Veloso'],
                },
            },
        },
    ],
};

// ============================================================================
// Fixtures
// ============================================================================

export const fixtures: EvalFixture[] = [
    // --- PLACES ---
    {
        name: 'Group dinner in Brooklyn',
        domain: 'places',
        queryText: 'great dinner spots in Brooklyn for a group',
        capsule: groupCapsule,
        candidates: [
            { name: 'Lilia', identifiers: { address: '567 Union Ave', city: 'Brooklyn' }, enrichment_hooks: ['google_places'] },
            { name: 'Win Son', identifiers: { address: '159 Graham Ave', city: 'Brooklyn' }, enrichment_hooks: ['google_places'] },
            { name: 'Di Fara Pizza', identifiers: { address: '1424 Ave J', city: 'Brooklyn' }, enrichment_hooks: ['google_places'] },
            { name: 'Olmsted', identifiers: { address: '659 Vanderbilt Ave', city: 'Brooklyn' }, enrichment_hooks: ['google_places'] },
            { name: 'Rolo\'s', identifiers: { address: '484 Halsey St', city: 'Brooklyn' }, enrichment_hooks: ['google_places'] },
        ],
    },
    {
        name: 'Date night sushi in Manhattan',
        domain: 'places',
        queryText: 'best sushi for a special occasion in Manhattan',
        capsule: soloCapsule,
        candidates: [
            { name: 'Sushi Nakazawa', identifiers: { address: '23 Commerce St', city: 'Manhattan' }, enrichment_hooks: ['google_places'] },
            { name: 'Shuko', identifiers: { address: '47 E 12th St', city: 'Manhattan' }, enrichment_hooks: ['google_places'] },
            { name: 'Sushi Yasuda', identifiers: { address: '204 E 43rd St', city: 'Manhattan' }, enrichment_hooks: ['google_places'] },
            { name: 'Kanoyama', identifiers: { address: '175 2nd Ave', city: 'Manhattan' }, enrichment_hooks: ['google_places'] },
        ],
    },
    {
        name: 'Casual brunch in Austin',
        domain: 'places',
        queryText: 'best brunch spots in Austin with outdoor seating',
        capsule: groupCapsule,
        candidates: [
            { name: 'Jacoby\'s Restaurant & Mercantile', identifiers: { address: '3235 E Cesar Chavez St', city: 'Austin' }, enrichment_hooks: ['google_places'] },
            { name: 'Paperboy', identifiers: { address: '1203 E 11th St', city: 'Austin' }, enrichment_hooks: ['google_places'] },
            { name: 'Dai Due', identifiers: { address: '2406 Manor Rd', city: 'Austin' }, enrichment_hooks: ['google_places'] },
        ],
    },

    // --- MOVIES ---
    {
        name: 'Cerebral sci-fi movies',
        domain: 'movies',
        queryText: 'cerebral sci-fi movies like Arrival and Ex Machina',
        capsule: groupCapsule,
        candidates: [
            { name: 'Annihilation', identifiers: { year: 2018, director: 'Alex Garland' }, enrichment_hooks: ['tmdb'] },
            { name: 'Interstellar', identifiers: { year: 2014, director: 'Christopher Nolan' }, enrichment_hooks: ['tmdb'] },
            { name: 'Under the Skin', identifiers: { year: 2013, director: 'Jonathan Glazer' }, enrichment_hooks: ['tmdb'] },
            { name: 'Coherence', identifiers: { year: 2013, director: 'James Ward Byrkit' }, enrichment_hooks: ['tmdb'] },
        ],
    },

    // --- MUSIC ---
    {
        name: 'Chill weekend playlist',
        domain: 'music',
        queryText: 'chill music for a lazy Sunday morning',
        capsule: soloCapsule,
        candidates: [
            { name: 'Águas de Março', identifiers: { artist: 'Tom Jobim', album: 'Elis & Tom' }, enrichment_hooks: ['apple_music'] },
            { name: 'Holocene', identifiers: { artist: 'Bon Iver', album: 'Bon Iver, Bon Iver' }, enrichment_hooks: ['apple_music'] },
            { name: 'Flume', identifiers: { artist: 'Bon Iver', album: 'For Emma, Forever Ago' }, enrichment_hooks: ['apple_music'] },
        ],
    },

    // --- EVENTS ---
    {
        name: 'Weekend events for a group in NYC',
        domain: 'events',
        queryText: 'fun things to do this weekend in NYC for a group of friends',
        capsule: groupCapsule,
        candidates: [
            { name: 'Sleep No More', identifiers: { venue: 'The McKittrick Hotel', date: '2026-02-07' }, enrichment_hooks: ['ticketmaster'] },
            { name: 'Smorgasburg Williamsburg', identifiers: { venue: 'East River State Park', date: '2026-02-08' }, enrichment_hooks: ['eventbrite'] },
            { name: 'Brooklyn Brewery Tour', identifiers: { venue: 'Brooklyn Brewery', date: '2026-02-08' }, enrichment_hooks: ['eventbrite'] },
            { name: 'Comedy Cellar Show', identifiers: { venue: 'Comedy Cellar', date: '2026-02-07' }, enrichment_hooks: ['ticketmaster'] },
        ],
    },

    // --- VIDEOS ---
    {
        name: 'Learn about architecture',
        domain: 'videos',
        queryText: 'best YouTube videos about modern architecture and design',
        capsule: soloCapsule,
        candidates: [
            { name: 'Why City Design is Important', identifiers: { youtube_id: 'example1', channel: 'Vox' }, enrichment_hooks: ['youtube'] },
            { name: 'The Genius of Japanese Carpentry', identifiers: { youtube_id: 'example2', channel: 'Insider' }, enrichment_hooks: ['youtube'] },
            { name: 'How Singapore Built the Future', identifiers: { youtube_id: 'example3', channel: 'B1M' }, enrichment_hooks: ['youtube'] },
        ],
    },

    // --- ARTICLES ---
    {
        name: 'Tech strategy reads',
        domain: 'articles',
        queryText: 'best articles about AI strategy and product development',
        capsule: groupCapsule,
        candidates: [
            { name: 'The AI Landscape in 2026', identifiers: { source: 'Stratechery', date: '2026-01-15' }, enrichment_hooks: ['newsapi'] },
            { name: 'Why Most AI Products Fail', identifiers: { source: 'Harvard Business Review', date: '2025-11-20' }, enrichment_hooks: ['newsapi'] },
            { name: 'Building LLM-First Applications', identifiers: { source: 'a16z', date: '2025-12-01' }, enrichment_hooks: ['newsapi'] },
        ],
    },

    // --- GENERAL ---
    {
        name: 'Gift ideas for a foodie',
        domain: 'general',
        queryText: 'unique gift ideas for someone who loves cooking and food',
        capsule: soloCapsule,
        candidates: [
            { name: 'Ooni Koda Pizza Oven', identifiers: { category: 'kitchen appliance' }, enrichment_hooks: ['wikipedia'] },
            { name: 'Salt Fat Acid Heat by Samin Nosrat', identifiers: { category: 'cookbook' }, enrichment_hooks: ['wikipedia'] },
            { name: 'Tokyo Food Tour Experience', identifiers: { category: 'experience' }, enrichment_hooks: ['wikipedia'] },
        ],
    },
];
