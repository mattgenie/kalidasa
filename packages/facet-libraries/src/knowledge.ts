/**
 * Knowledge Facets
 */

import type { Facet } from '@kalidasa/types';

export const knowledgeFacets: Facet[] = [
    // Intent
    {
        id: 'intent.explain',
        label: 'Explain',
        signals: ['what is', 'explain', 'how does', 'help me understand'],
    },
    {
        id: 'intent.compare',
        label: 'Compare',
        signals: ['vs', 'versus', 'compare', 'difference between', 'which is better'],
    },
    {
        id: 'intent.how_to',
        label: 'How To',
        signals: ['how to', 'steps to', 'guide', 'tutorial', 'instructions'],
    },
    {
        id: 'intent.troubleshoot',
        label: 'Troubleshoot',
        signals: ['not working', 'error', 'fix', 'problem', 'issue'],
    },
    {
        id: 'intent.recommend',
        label: 'Recommend',
        signals: ['best', 'recommend', 'should I', 'which one'],
    },

    // Style
    {
        id: 'style.depth',
        label: 'Depth',
        signals: ['beginner', 'advanced', 'in-depth', 'overview', 'comprehensive', 'quick'],
    },
    {
        id: 'style.technical',
        label: 'Technical Level',
        signals: ['technical', 'non-technical', 'layman', 'expert', 'ELI5'],
    },
    {
        id: 'style.format',
        label: 'Format',
        signals: ['list', 'summary', 'detailed', 'bullet points', 'step by step'],
    },

    // Source
    {
        id: 'source.official',
        label: 'Official Source',
        signals: ['official', 'documentation', 'from the source', 'authoritative'],
    },
    {
        id: 'source.community',
        label: 'Community Source',
        signals: ['community', 'forum', 'reddit', 'stack overflow', 'user experience'],
    },
    {
        id: 'source.academic',
        label: 'Academic Source',
        signals: ['research', 'study', 'paper', 'academic', 'peer-reviewed'],
    },

    // Recency
    {
        id: 'recency.current',
        label: 'Current',
        signals: ['latest', 'current', 'up to date', '2024', '2025', '2026'],
    },
    {
        id: 'recency.historical',
        label: 'Historical',
        signals: ['history', 'origin', 'background', 'evolution'],
    },

    // Scope
    {
        id: 'scope.specific',
        label: 'Specific',
        signals: ['specifically', 'exactly', 'particular', 'this specific'],
    },
    {
        id: 'scope.broad',
        label: 'Broad',
        signals: ['generally', 'overall', 'in general', 'broadly'],
    },
];
