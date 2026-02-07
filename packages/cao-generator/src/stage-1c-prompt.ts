/**
 * Stage 1c Prompts: Summary + Personalization (Parallel)
 * 
 * Two independent LLM calls that run in parallel:
 * - Summary: What the result IS and how it fits the query (informative, third-person)
 * - ForUser: How it matches the user's personal preferences (conversational, second-person)
 */

import type { PersonalizationCapsule } from '@kalidasa/types';
import type { Stage1aCandidate } from './stage-1a-prompt.js';

// ============================================================================
// Domain Guidance
// ============================================================================

function getSummaryGuidance(domain: string): string {
    const guidance: Record<string, string> = {
        places: `Focus on: what you'd actually eat there, the vibe when you walk in, what regulars love about it.
Do NOT repeat the address — that's shown separately.`,
        movies: `Focus on: what the experience of watching it feels like, its mood, standout performances or directorial choices.`,
        music: `Focus on: what it sounds like, the feeling it evokes, where it sits in the artist's journey.`,
        events: `Focus on: what you'd actually experience there, the energy, what makes it worth showing up for.`,
        videos: `Focus on: what you'll learn or feel watching it, the creator's approach, what sticks with you after.`,
        articles: `Focus on: the core argument or revelation, why it matters now, the perspective it offers.`,
    };
    return guidance[domain] || guidance.places;
}

function getForUserGuidance(domain: string): string {
    const guidance: Record<string, string> = {
        places: `Connect to: their cuisine cravings, the vibe they're after, their budget sweet spot.
Flag honestly: noise level, long waits, dietary gaps, if it's more of a scene than a meal.`,
        movies: `Connect to: genres and directors they already love, themes that resonate with them.
Flag honestly: pacing, intensity, if it's a very different style from their usual picks.`,
        music: `Connect to: artists and sounds they already enjoy, the mood they're chasing.
Flag honestly: if it's a departure from their comfort zone, very experimental, or lyrically intense.`,
        events: `Connect to: the kind of fun they're looking for, energy level, social dynamics.
Flag honestly: timing, crowds, cost, if it's really more of a couples/solo thing.`,
        videos: `Connect to: topics they nerd out about, creator styles they gravitate toward.
Flag honestly: length, if it's too basic or too advanced for where they are.`,
        articles: `Connect to: topics they follow, intellectual curiosity, career relevance.
Flag honestly: reading time, paywall, if the perspective might challenge their views.`,
    };
    return guidance[domain] || guidance.places;
}

// ============================================================================
// Summary Prompt (informative, third-person)
// ============================================================================

/**
 * Build prompt for generating summaries of candidates.
 * These describe WHAT each result is and how it fits the search criteria.
 */
export function buildSummaryPrompt(
    candidates: Stage1aCandidate[],
    queryText: string,
    domain?: string
): string {
    const candidateNames = candidates.map(c => c.name).join(', ');
    const domainGuidance = getSummaryGuidance(domain || 'places');

    return `Query: "${queryText}"

For each item, write a brief summary that makes someone genuinely curious about it. Include one specific, non-obvious detail that someone wouldn't know just from the name. Be honest — if it's a great fit, say why; if it's a stretch, say that too.

${domainGuidance}

PERSONA: You're an enthusiast sharing a find, not a guide describing options. Think food blogger, film critic, music journalist — someone with genuine opinions and personality.

STYLE:
- 1-2 sentences max
- Write with genuine enthusiasm and personality — have an OPINION, take a STANCE
- Lead with the most interesting or distinctive thing about it
- Include at least one SPECIFIC detail (a standout dish, a particular scene, a unique feature)
- COMMIT to your take — say "this is incredible" or "this falls short" — not "this might be good"

BAD: "This restaurant offers Italian cuisine in a comfortable atmosphere, suitable for group dining."
BAD: "A well-regarded spot that could be a good fit for groups looking for Italian food."
GOOD: "The mafaldine with pink peppercorn is worth the trip alone — Lilia's buzzing energy on weekend nights makes it a blast for groups, though you'll want to book early."

BAD: "A cerebral sci-fi film that might appeal to thoughtful viewers."
GOOD: "A slow-burn sci-fi that gets under your skin — the final act is genuinely unsettling, and Natalie Portman's performance carries real weight."

BAD (advisor voice): "Taiwanese-American comfort food done incredibly well. The communal tables make it great for groups."
GOOD (enthusiast voice): "Win Son's mochi donuts are dangerously addictive, and the NT Chicken sandwich has a cult following — expect a wait on weekends but the energy is infectious."

Anti-patterns (NEVER do these):
- No hedging: no "might be", "could be", "it depends on", "suitable for", "may appeal to"
- No distancing: no "it is known for", "it is considered" — just state your take directly
- No catalog words: no "offers", "features", or "provides"
- No user names, UUIDs, or scoring mechanics
- No generic adjectives without specifics: not "interesting themes" but name the theme

Items: ${candidateNames}

Return ONLY JSON:
{
  "summaries": {"ItemName": "1-2 sentence summary"}
}`;
}

// ============================================================================
// ForUser Prompt (conversational, second-person)
// ============================================================================

/**
 * Build prompt for generating personalization notes.
 * These explain WHY each result matches the user's preferences.
 */
export function buildForUserPrompt(
    candidates: Stage1aCandidate[],
    capsule: PersonalizationCapsule,
    queryText: string,
    domain?: string
): string {
    const candidateNames = candidates.map(c => c.name).join(', ');
    const userName = capsule.members?.[0]?.name || 'you';
    const prefs = JSON.stringify(capsule.members?.[0]?.preferences || {});
    const domainGuidance = getForUserGuidance(domain || 'places');

    return `Query: "${queryText}"
User: ${userName}
Preferences: ${prefs}

For each item, tell ${userName} why they'd personally love it (or honestly, why it won't click for them). Ground every note in something SPECIFIC — a dish, a scene, a sound, a moment — not abstract preference-matching.

CRITICAL: Reference at least one SPECIFIC item from ${userName}'s preferences BY NAME. Not "your favorite genres" but the actual genre/artist/cuisine/director name. If they love Radiohead, say "Radiohead"; if they love Thai food, say "Thai"; if they hate horror, say "horror."

PRIORITY: Their most niche, specific interests trump broad categories. "Your love of bossa nova" beats "your music taste." "The noir influence" beats "your favorite genres."

${domainGuidance}

VOICE:
- You're a friend who's been there and is genuinely excited to share — not an advisor being helpful
- Warm and direct: "The cacio e pepe here is RIDICULOUS" not "This pasta dish is of high quality"
- COMMIT: say "you'll love this" or "skip this one" — never "might be" or "could work"
- 1-2 sentences, punchy but substantive
- Vary how you open each note — don't start the same way twice

BAD: "This aligns with your stated preference for Italian cuisine and fits your price range."
BAD: "This could be a good fit since you enjoy sci-fi movies."
GOOD: "The handmade pasta here is outstanding, and the lively Saturday night vibe is exactly your speed — just book ahead, it fills up fast."
GOOD: "If you loved Ex Machina, this is its weirder, more unsettling cousin — zero gore, so it dodges the horror you hate."

NICHE vs GENERIC:
BAD: "Great for your interest in Japanese food" (too broad)
BAD: "Fits your preference for upscale dining" (too generic)
GOOD: "Pure Edomae-style omakase — the kind of precise, ingredient-focused sushi that drew you in" (names the specific style)
GOOD: "Think Caetano Veloso meets ambient electronic — right in your wheelhouse" (names the artist)

Anti-patterns (NEVER do these):
- No hedging: "might be", "could be", "it depends on", "may appeal to"
- No "aligns with your preference" / "matches your profile" / "fits your criteria"
- No broad-category connections without specifics: not "your taste in music" but name the artist or genre
- No bro-speak: no "Dude", "Bro", "fam", or similar slang
- No UUIDs, member IDs, or scoring mechanics
- No "User 1", "User 2", or "the user"
- No "based on your" more than once across all items
- No "you mentioned" — just demonstrate you know, don't narrate it

Items: ${candidateNames}

Return ONLY JSON:
{
  "personalizations": {"ItemName": "1-2 sentence personal note for ${userName}"}
}`;
}

// ============================================================================
// Response Types
// ============================================================================

/**
 * Summary result from the summary pass
 */
export interface SummaryResponse {
    summaries: Record<string, string>;
}

/**
 * Personalization result from the forUser pass
 */
export interface ForUserResponse {
    personalizations: Record<string, string>;
}

/**
 * Combined Stage 1c response (for backward compatibility with TwoStageGenerator)
 */
export interface Stage1cResponse {
    personalizations: Record<string, CandidatePersonalization>;
    answerBundle?: {
        headline: string;
        summary: string;
    };
}

/**
 * Personalization result for a single candidate
 */
export interface CandidatePersonalization {
    forUser: string;
    summary?: string;
}

// ============================================================================
// Parsers
// ============================================================================

/**
 * Parse summary response
 */
export function parseSummaryResponse(text: string): SummaryResponse {
    const parsed = parseJsonFromText(text);
    if (parsed?.summaries && typeof parsed.summaries === 'object') {
        return { summaries: parsed.summaries };
    }
    console.error('[Stage1c-Summary] Failed to parse response:', text.substring(0, 200));
    return { summaries: {} };
}

/**
 * Parse forUser response
 */
export function parseForUserResponse(text: string): ForUserResponse {
    const parsed = parseJsonFromText(text);
    if (parsed?.personalizations && typeof parsed.personalizations === 'object') {
        return { personalizations: parsed.personalizations };
    }
    console.error('[Stage1c-ForUser] Failed to parse response:', text.substring(0, 200));
    return { personalizations: {} };
}

/**
 * Parse Stage 1c response (legacy compatibility)
 */
export function parseStage1cResponse(text: string): Stage1cResponse {
    const parsed = parseJsonFromText(text);
    if (parsed?.personalizations) {
        return parsed;
    }
    console.error('[Stage1c] Failed to parse response:', text.substring(0, 200));
    return { personalizations: {} };
}

/**
 * Robust JSON extraction from LLM text
 */
function parseJsonFromText(text: string): any {
    // Try direct parse
    try {
        return JSON.parse(text);
    } catch { /* continue */ }

    // Try markdown code block
    const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) {
        try {
            return JSON.parse(match[1].trim());
        } catch { /* continue */ }
    }

    // Try to find object in text
    const objectMatch = text.match(/\{[\s\S]*\}/);
    if (objectMatch) {
        try {
            return JSON.parse(objectMatch[0]);
        } catch { /* continue */ }
    }

    return null;
}

// ============================================================================
// Legacy Exports (kept for backward compatibility)
// ============================================================================

/**
 * Build Stage 1c prompt - legacy single-call version
 * @deprecated Use buildSummaryPrompt + buildForUserPrompt instead
 */
export function buildStage1cPrompt(
    candidates: Stage1aCandidate[],
    capsule: PersonalizationCapsule,
    queryText: string,
    domain?: string
): string {
    // Delegate to forUser prompt for backward compat
    return buildForUserPrompt(candidates, capsule, queryText, domain);
}
