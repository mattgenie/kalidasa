/**
 * Places Facets
 * 
 * Facets for restaurants, bars, cafes, and other venues.
 */

import type { Facet } from '@kalidasa/types';

export const placesFacets: Facet[] = [
    // ========================================================================
    // Fit Facets - Practical match criteria
    // ========================================================================
    {
        id: 'fit.open_now',
        label: 'Currently Open',
        signals: ['open now', 'opening hours', 'current time', 'available now'],
        promptHint: 'Check real-time availability',
    },
    {
        id: 'fit.distance',
        label: 'Distance',
        signals: ['nearby', 'close', 'walking distance', 'within X miles', 'near me'],
        promptHint: 'Consider travel time and accessibility',
    },
    {
        id: 'fit.budget',
        label: 'Budget Match',
        signals: ['cheap', 'affordable', 'expensive', 'fine dining', '$', '$$', '$$$', '$$$$'],
        promptHint: 'Match price level to stated budget',
    },
    {
        id: 'fit.group_size',
        label: 'Group Capacity',
        signals: ['party of', 'group', 'large party', 'intimate', 'reservation', 'seating'],
        promptHint: 'Can accommodate the party size',
    },
    {
        id: 'fit.accessibility',
        label: 'Accessibility',
        signals: ['wheelchair', 'accessible', 'parking', 'transit', 'easy access'],
    },
    {
        id: 'fit.dietary',
        label: 'Dietary Options',
        signals: ['vegetarian', 'vegan', 'gluten-free', 'halal', 'kosher', 'allergy-friendly'],
        promptHint: 'Has menu options for dietary restrictions',
    },
    {
        id: 'fit.kid_friendly',
        label: 'Kid Friendly',
        signals: ['family', 'kids', 'children', 'high chair', 'kids menu'],
    },
    {
        id: 'fit.pet_friendly',
        label: 'Pet Friendly',
        signals: ['dog', 'pet', 'dog-friendly', 'pet-friendly'],
    },

    // ========================================================================
    // Experience Facets - Quality and atmosphere
    // ========================================================================
    {
        id: 'experience.vibe',
        label: 'Atmosphere',
        signals: ['cozy', 'trendy', 'romantic', 'casual', 'upscale', 'lively', 'quiet'],
        promptHint: 'Match the desired mood/ambiance',
    },
    {
        id: 'experience.noise',
        label: 'Noise Level',
        signals: ['quiet', 'loud', 'good for conversation', 'lively', 'energetic'],
    },
    {
        id: 'experience.service_speed',
        label: 'Service Speed',
        signals: ['quick', 'fast', 'leisurely', 'slow', 'rushed'],
    },
    {
        id: 'experience.food_quality',
        label: 'Food Quality',
        signals: ['best', 'authentic', 'delicious', 'highly rated', 'award-winning'],
        promptHint: 'Consider ratings and reviews',
    },
    {
        id: 'experience.views',
        label: 'Views/Scenery',
        signals: ['view', 'skyline', 'waterfront', 'scenic', 'rooftop'],
    },
    {
        id: 'experience.outdoor',
        label: 'Outdoor Seating',
        signals: ['outdoor', 'patio', 'terrace', 'garden', 'al fresco'],
    },

    // ========================================================================
    // Intent Facets - Purpose of the visit
    // ========================================================================
    {
        id: 'intent.date_night',
        label: 'Date Night',
        signals: ['romantic', 'date', 'anniversary', 'special', 'intimate'],
        promptHint: 'Romantic atmosphere, good for couples',
    },
    {
        id: 'intent.business',
        label: 'Business Meeting',
        signals: ['business', 'meeting', 'client', 'professional', 'work'],
        promptHint: 'Suitable for professional meetings',
    },
    {
        id: 'intent.work_session',
        label: 'Work Session',
        signals: ['wifi', 'laptop', 'work', 'study', 'outlets', 'coffee shop'],
        promptHint: 'Good for remote work or studying',
    },
    {
        id: 'intent.celebration',
        label: 'Celebration',
        signals: ['birthday', 'celebration', 'party', 'special occasion'],
    },
    {
        id: 'intent.hidden_gem',
        label: 'Hidden Gem',
        signals: ['hidden gem', 'local favorite', 'off the beaten path', 'undiscovered'],
        promptHint: 'Not touristy, authentic local experience',
    },
    {
        id: 'intent.tourist_must_do',
        label: 'Must Visit',
        signals: ['famous', 'iconic', 'must try', 'landmark', 'bucket list'],
        promptHint: 'Well-known, quintessential experience',
    },
    {
        id: 'intent.quick_bite',
        label: 'Quick Bite',
        signals: ['quick', 'grab and go', 'fast', 'takeout', 'lunch break'],
    },
    {
        id: 'intent.drinks_only',
        label: 'Drinks Only',
        signals: ['drinks', 'bar', 'cocktails', 'wine', 'beer', 'happy hour'],
    },

    // ========================================================================
    // Cuisine Facets
    // ========================================================================
    {
        id: 'cuisine.type',
        label: 'Cuisine Type',
        signals: ['italian', 'japanese', 'mexican', 'indian', 'french', 'thai', 'chinese', 'korean', 'mediterranean'],
    },
    {
        id: 'cuisine.authentic',
        label: 'Authenticity',
        signals: ['authentic', 'traditional', 'fusion', 'modern', 'classic'],
    },
];
