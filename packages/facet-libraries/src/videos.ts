/**
 * Videos Facets
 */

import type { Facet } from '@kalidasa/types';

export const videosFacets: Facet[] = [
    // Quality
    {
        id: 'quality.production',
        label: 'Production Quality',
        signals: ['professional', 'high quality', 'well produced', 'polished'],
    },
    {
        id: 'quality.credibility',
        label: 'Credibility',
        signals: ['credible', 'expert', 'trusted creator', 'verified'],
    },

    // Fit
    {
        id: 'fit.length',
        label: 'Length',
        signals: ['short', 'long', 'quick', 'comprehensive', 'under 5 minutes', 'deep dive'],
    },
    {
        id: 'fit.format',
        label: 'Format',
        signals: ['tutorial', 'vlog', 'documentary', 'review', 'interview', 'lecture'],
    },

    // Clip/Content
    {
        id: 'clip.topic_coverage',
        label: 'Topic Coverage',
        signals: ['covers', 'explains', 'shows', 'demonstrates', 'discusses'],
    },
    {
        id: 'clip.visual_style',
        label: 'Visual Style',
        signals: ['animated', 'live action', 'screen recording', 'talking head'],
    },

    // Platform
    {
        id: 'platform.youtube',
        label: 'YouTube',
        signals: ['youtube', 'yt'],
    },
    {
        id: 'platform.vimeo',
        label: 'Vimeo',
        signals: ['vimeo'],
    },

    // Engagement
    {
        id: 'engagement.popular',
        label: 'Popular',
        signals: ['viral', 'popular', 'trending', 'millions of views'],
    },
    {
        id: 'engagement.recent',
        label: 'Recent',
        signals: ['recent', 'new', 'latest', 'just uploaded'],
    },
];
