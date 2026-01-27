/**
 * Perspective Facets (Opinions & Debates)
 */

import type { Facet } from '@kalidasa/types';

export const perspectiveFacets: Facet[] = [
    {
        id: 'perspective.pro',
        label: 'Pro/Positive',
        signals: ['benefits', 'pros', 'advantages', 'positive', 'in favor'],
    },
    {
        id: 'perspective.con',
        label: 'Con/Negative',
        signals: ['downsides', 'cons', 'disadvantages', 'negative', 'against'],
    },
    {
        id: 'perspective.balanced',
        label: 'Balanced',
        signals: ['balanced', 'both sides', 'fair', 'objective', 'nuanced'],
    },
    {
        id: 'perspective.controversy',
        label: 'Controversy',
        signals: ['controversial', 'debate', 'disputed', 'polarizing'],
    },
    {
        id: 'perspective.mainstream',
        label: 'Mainstream View',
        signals: ['mainstream', 'conventional', 'common', 'popular opinion'],
    },
    {
        id: 'perspective.alternative',
        label: 'Alternative View',
        signals: ['alternative', 'unconventional', 'contrarian', 'minority opinion'],
    },
    {
        id: 'perspective.expert_consensus',
        label: 'Expert Consensus',
        signals: ['consensus', 'experts agree', 'scientific consensus', 'established'],
    },
    {
        id: 'perspective.emerging',
        label: 'Emerging View',
        signals: ['emerging', 'new thinking', 'evolving', 'cutting edge'],
    },
];
