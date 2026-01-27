/**
 * Products Facets
 */

import type { Facet } from '@kalidasa/types';

export const productsFacets: Facet[] = [
    {
        id: 'product.ease_of_use',
        label: 'Ease of Use',
        signals: ['easy', 'simple', 'user-friendly', 'intuitive', 'beginner-friendly'],
    },
    {
        id: 'product.total_cost',
        label: 'Total Cost',
        signals: ['price', 'cost', 'budget', 'expensive', 'cheap', 'free'],
    },
    {
        id: 'product.quality',
        label: 'Quality',
        signals: ['quality', 'durable', 'well-made', 'premium', 'reliable'],
    },
    {
        id: 'product.features',
        label: 'Features',
        signals: ['features', 'capabilities', 'functionality', 'what can it do'],
    },
    {
        id: 'product.support',
        label: 'Support',
        signals: ['support', 'customer service', 'documentation', 'community'],
    },
    {
        id: 'product.integration',
        label: 'Integration',
        signals: ['integration', 'compatible', 'works with', 'connects to'],
    },
    {
        id: 'product.reviews',
        label: 'Reviews',
        signals: ['reviews', 'ratings', 'what people say', 'user feedback'],
    },
    {
        id: 'product.alternatives',
        label: 'Alternatives',
        signals: ['alternative', 'similar to', 'instead of', 'competitor'],
    },
    {
        id: 'product.new_vs_established',
        label: 'New vs Established',
        signals: ['new', 'established', 'startup', 'mature', 'proven'],
    },
    {
        id: 'product.open_source',
        label: 'Open Source',
        signals: ['open source', 'free', 'proprietary', 'self-hosted'],
    },
];
