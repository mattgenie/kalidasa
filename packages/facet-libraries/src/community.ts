/**
 * Community Facets (Social Proof)
 */

import type { Facet } from '@kalidasa/types';

export const communityFacets: Facet[] = [
    {
        id: 'community.common_praise',
        label: 'Common Praise',
        signals: ['people love', 'praised for', 'known for', 'famous for'],
    },
    {
        id: 'community.common_criticism',
        label: 'Common Criticism',
        signals: ['criticized', 'complaints', 'issues with', 'problems'],
    },
    {
        id: 'community.gotchas',
        label: 'Gotchas',
        signals: ['watch out', 'be aware', 'gotcha', 'caveat', 'hidden'],
    },
    {
        id: 'community.tips',
        label: 'Tips',
        signals: ['tips', 'tricks', 'pro tip', 'advice', 'recommendation'],
    },
    {
        id: 'community.testimonials',
        label: 'Testimonials',
        signals: ['testimonial', 'case study', 'success story', 'experience'],
    },
    {
        id: 'community.endorsement',
        label: 'Endorsement',
        signals: ['endorsed', 'recommended by', 'backed by', 'supported by'],
    },
    {
        id: 'community.word_of_mouth',
        label: 'Word of Mouth',
        signals: ['word of mouth', 'friends recommend', 'heard about', 'buzz'],
    },
];
