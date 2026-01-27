/**
 * Articles Facets
 */

import type { Facet } from '@kalidasa/types';

export const articlesFacets: Facet[] = [
    // Quality
    {
        id: 'quality.authority',
        label: 'Authority',
        signals: ['reputable', 'trusted', 'authoritative', 'established'],
    },
    {
        id: 'quality.depth',
        label: 'Depth',
        signals: ['in-depth', 'comprehensive', 'detailed', 'thorough', 'quick read'],
    },
    {
        id: 'quality.original_reporting',
        label: 'Original Reporting',
        signals: ['original', 'exclusive', 'investigation', 'primary source'],
    },

    // Fit
    {
        id: 'fit.reading_time',
        label: 'Reading Time',
        signals: ['quick read', 'long read', '5 minute', '10 minute', 'brief'],
    },
    {
        id: 'fit.reading_level',
        label: 'Reading Level',
        signals: ['beginner', 'advanced', 'technical', 'accessible', 'easy to understand'],
    },

    // Type
    {
        id: 'type.news',
        label: 'News',
        signals: ['news', 'breaking', 'current events', 'latest'],
    },
    {
        id: 'type.opinion',
        label: 'Opinion',
        signals: ['opinion', 'editorial', 'perspective', 'commentary'],
    },
    {
        id: 'type.analysis',
        label: 'Analysis',
        signals: ['analysis', 'deep dive', 'explainer', 'breakdown'],
    },
    {
        id: 'type.review',
        label: 'Review',
        signals: ['review', 'rating', 'verdict', 'recommendation'],
    },

    // Source
    {
        id: 'source.mainstream',
        label: 'Mainstream',
        signals: ['major outlet', 'mainstream', 'well-known'],
    },
    {
        id: 'source.niche',
        label: 'Niche/Specialist',
        signals: ['specialist', 'niche', 'industry', 'trade publication'],
    },

    // Recency
    {
        id: 'recency.recent',
        label: 'Recent',
        signals: ['today', 'this week', 'recent', 'latest', 'new'],
    },
];
