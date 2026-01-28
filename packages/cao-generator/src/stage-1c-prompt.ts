/**
 * Stage 1c Prompt: Personalization Pass
 * 
 * Takes verified candidates and generates personalization notes.
 * Runs in parallel with enrichment.
 */

import type { PersonalizationCapsule } from '@kalidasa/types';
import type { Stage1aCandidate } from './stage-1a-prompt.js';

/**
 * Build Stage 1c prompt - personalization for candidates
 */
export function buildStage1cPrompt(
    candidates: Stage1aCandidate[],
    capsule: PersonalizationCapsule,
    queryText: string
): string {
    const candidateNames = candidates.map(c => c.name).join(', ');
    const userName = capsule.members?.[0]?.name || 'user';
    const prefs = JSON.stringify(capsule.members?.[0]?.preferences || {});

    return `Query: "${queryText}"
User: ${userName}
Preferences: ${prefs}

For each item, write WHY it fits or doesn't fit ${userName}'s preferences.
- Be specific: reference actual preferences (cuisines, genres, vibes, etc.)
- Vary your phrasing: don't start every note the same way
- Include both strengths AND potential concerns when relevant
- Prioritize matches with rarer/niche interests - those are more valuable than common ones

Items: ${candidateNames}

Return ONLY JSON:
{
  "personalizations": {"ItemName": {"forUser": "specific fit/challenge for ${userName}"}},
  "answerBundle": {"headline": "${candidates.length} for ${userName}", "summary": "Brief synthesis"}
}`;
}

/**
 * Personalization result for a single candidate
 */
export interface CandidatePersonalization {
    forUser: string;
    summary?: string;
}

/**
 * Stage 1c response
 */
export interface Stage1cResponse {
    personalizations: Record<string, CandidatePersonalization>;
    answerBundle?: {
        headline: string;
        summary: string;
    };
}

/**
 * Parse Stage 1c response
 */
export function parseStage1cResponse(text: string): Stage1cResponse {
    try {
        // Try direct parse
        const parsed = JSON.parse(text);
        if (parsed.personalizations) {
            return parsed;
        }
    } catch {
        // Try to extract from markdown
        const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (match) {
            try {
                const parsed = JSON.parse(match[1].trim());
                if (parsed.personalizations) {
                    return parsed;
                }
            } catch {
                // Fall through
            }
        }

        // Try to find object in text
        const objectMatch = text.match(/\{[\s\S]*\}/);
        if (objectMatch) {
            try {
                const parsed = JSON.parse(objectMatch[0]);
                if (parsed.personalizations) {
                    return parsed;
                }
            } catch {
                // Fall through
            }
        }
    }

    console.error('[Stage1c] Failed to parse response:', text.substring(0, 200));
    return { personalizations: {} };
}
