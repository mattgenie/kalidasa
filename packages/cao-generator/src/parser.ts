/**
 * CAO Parser
 * 
 * Parses and validates CAO JSON from Gemini responses.
 */

import type { RawCAO, RawCAOCandidate } from '@kalidasa/types';

/**
 * Parse CAO JSON from Gemini response text
 */
export function parseCAO(text: string): RawCAO {
    try {
        // Try to parse directly
        const parsed = JSON.parse(text);
        return validateAndNormalize(parsed);
    } catch (error) {
        // Try to extract JSON from markdown code block
        const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonMatch) {
            try {
                const parsed = JSON.parse(jsonMatch[1].trim());
                return validateAndNormalize(parsed);
            } catch {
                // Fall through to error
            }
        }

        // Try to find JSON object in text
        const objectMatch = text.match(/\{[\s\S]*\}/);
        if (objectMatch) {
            try {
                const parsed = JSON.parse(objectMatch[0]);
                return validateAndNormalize(parsed);
            } catch {
                // Fall through to error
            }
        }

        console.error('[CAOParser] Failed to parse CAO from text:', text.substring(0, 200));
        throw new Error('Failed to parse CAO from Gemini response');
    }
}

/**
 * Validate and normalize parsed CAO
 */
function validateAndNormalize(parsed: any): RawCAO {
    // Ensure candidates array exists
    const candidates: RawCAOCandidate[] = [];

    if (Array.isArray(parsed.candidates)) {
        for (const candidate of parsed.candidates) {
            const normalized = normalizeCandidate(candidate);
            if (normalized) {
                candidates.push(normalized);
            }
        }
    }

    return {
        candidates,
        answerBundle: parsed.answerBundle
            ? {
                headline: parsed.answerBundle.headline || 'Search Results',
                summary: parsed.answerBundle.summary || '',
                facetsApplied: parsed.answerBundle.facetsApplied || [],
            }
            : undefined,
        renderHints: parsed.renderHints
            ? {
                componentType: parsed.renderHints.componentType || 'search_grid',
                itemRenderer: parsed.renderHints.itemRenderer || 'generic_card',
            }
            : undefined,
    };
}

/**
 * Normalize a single candidate
 */
function normalizeCandidate(candidate: any): RawCAOCandidate | null {
    // Must have a name
    if (!candidate.name || typeof candidate.name !== 'string') {
        return null;
    }

    return {
        name: candidate.name.trim(),
        type: candidate.type || 'entity',
        summary: candidate.summary || '',
        reasoning: {
            whyRecommended: candidate.reasoning?.whyRecommended || '',
            pros: Array.isArray(candidate.reasoning?.pros) ? candidate.reasoning.pros : [],
            cons: Array.isArray(candidate.reasoning?.cons) ? candidate.reasoning.cons : [],
        },
        personalization: candidate.personalization
            ? {
                forUser: candidate.personalization.forUser,
                forGroup: candidate.personalization.forGroup,
                groupNotes: candidate.personalization.groupNotes,
            }
            : undefined,
        enrichment_hooks: Array.isArray(candidate.enrichment_hooks)
            ? candidate.enrichment_hooks
            : [],
        search_hint: candidate.search_hint,
        facetScores: candidate.facetScores,
    };
}
