/**
 * Signals Facets (Data & Quantitative)
 */

import type { Facet } from '@kalidasa/types';

export const signalsFacets: Facet[] = [
    {
        id: 'signals.adoption',
        label: 'Adoption Rate',
        signals: ['popular', 'widely used', 'adoption', 'market share', 'users'],
    },
    {
        id: 'signals.growth',
        label: 'Growth',
        signals: ['growing', 'trending up', 'increasing', 'momentum'],
    },
    {
        id: 'signals.sentiment',
        label: 'Sentiment',
        signals: ['sentiment', 'how people feel', 'reception', 'reaction'],
    },
    {
        id: 'signals.rating',
        label: 'Rating',
        signals: ['rating', 'score', 'stars', 'grade', 'rank'],
    },
    {
        id: 'signals.engagement',
        label: 'Engagement',
        signals: ['engagement', 'views', 'likes', 'shares', 'comments'],
    },
    {
        id: 'signals.price_performance',
        label: 'Price Performance',
        signals: ['value', 'price performance', 'roi', 'worth it'],
    },
    {
        id: 'signals.reliability',
        label: 'Reliability',
        signals: ['reliability', 'uptime', 'stability', 'consistent'],
    },
    {
        id: 'signals.benchmark',
        label: 'Benchmark',
        signals: ['benchmark', 'comparison', 'vs industry', 'standard'],
    },
];
