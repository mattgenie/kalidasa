/**
 * Streaming Personalizer
 * 
 * Generates personalization for single candidates as they arrive.
 * Uses domain-aware prompts for better results.
 * 
 * DUAL MODE: When user has real preferences, personalizes against them.
 * When preferences are empty, switches to review-grounded insider tips
 * to avoid hallucinating preferences the user never stated.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import type { PersonalizationCapsule } from '@kalidasa/types';

export interface CandidatePersonalization {
    forUser: string;
}

export interface StreamingPersonalizerOptions {
    apiKey?: string;
    model?: string;
}

/**
 * Get domain-specific context for personalized mode
 */
function getDomainContext(domain: string): string {
    const contexts: Record<string, string> = {
        movies: 'For this movie, think about: genre fit, director/cast, themes, and heads up on runtime or intensity',
        places: 'For this spot, think about: cuisine, vibe, price comfort, and heads up on noise or wait',
        music: 'For this track/artist, think about: sound style, similar artists, and heads up on explicit content',
        events: 'For this event, think about: interest alignment, energy, and heads up on timing or cost',
        videos: 'For this video, think about: topic relevance, creator style, and heads up on length',
        articles: 'For this article, think about: topic match, expertise level, and heads up on paywall or length',
    };
    return contexts[domain] || contexts.places;
}

/**
 * Get domain-specific guidance for insider-take mode (no preferences)
 */
function getInsiderContext(domain: string): string {
    const contexts: Record<string, string> = {
        places: 'Think like a food critic or local regular. What dish is the star? What\'s the vibe? Is it worth the wait or overhyped?',
        movies: 'Think like a film buff friend. What\'s the standout performance? Is it a crowd-pleaser or divisive? What mood should you be in?',
        music: 'Think like a music journalist. What\'s the signature sound? Is this an entry point or deep-cut territory?',
        events: 'Think like a local who\'s been before. What\'s the energy like? What should you not miss? Pro tips?',
        videos: 'Think like a regular viewer of this creator. What makes this one special? Accessible for newcomers or for fans?',
        articles: 'Think like a well-read friend. What\'s the key insight? Is it accessible or niche?',
    };
    return contexts[domain] || contexts.places;
}

/**
 * Check if preferences have meaningful content.
 */
function hasRealPreferences(capsule: PersonalizationCapsule): boolean {
    const prefs = capsule.members?.[0]?.preferences;
    if (!prefs) return false;

    for (const domainPrefs of Object.values(prefs)) {
        if (typeof domainPrefs !== 'object' || domainPrefs === null) continue;
        for (const val of Object.values(domainPrefs)) {
            if (Array.isArray(val) && val.length > 0) return true;
            if (typeof val === 'string' && val.length > 0) return true;
            if (typeof val === 'number') return true;
            if (typeof val === 'boolean') return true;
        }
    }
    return false;
}

export class StreamingPersonalizer {
    private genAI: GoogleGenerativeAI;
    private model: string;

    constructor(options: StreamingPersonalizerOptions = {}) {
        const apiKey = options.apiKey || process.env.GEMINI_API_KEY || '';
        if (!apiKey) {
            throw new Error('GEMINI_API_KEY is required');
        }

        this.genAI = new GoogleGenerativeAI(apiKey);
        this.model = options.model || 'gemini-2.0-flash';
    }

    /**
     * Generate personalization for a single candidate
     */
    async personalizeOne(
        candidateName: string,
        queryText: string,
        capsule: PersonalizationCapsule,
        domain?: string
    ): Promise<CandidatePersonalization> {
        const userName = capsule.members?.[0]?.name || 'you';
        const d = domain || 'places';

        const prompt = hasRealPreferences(capsule)
            ? this.buildPersonalizedPrompt(candidateName, queryText, capsule, d, userName)
            : this.buildInsiderPrompt(candidateName, queryText, d, userName);

        const model = this.genAI.getGenerativeModel({
            model: this.model,
            generationConfig: {
                temperature: 0.7,
                maxOutputTokens: 150,
            },
        });

        try {
            const result = await model.generateContent(prompt);
            const text = result.response.text().trim();

            return {
                forUser: text || `Great match for ${userName}`,
            };
        } catch (error) {
            console.error(`[StreamPersonalizer] Error for ${candidateName}:`, error);
            return {
                forUser: `Worth checking out — see the summary for details`,
            };
        }
    }

    /**
     * When user HAS preferences: reference them specifically.
     */
    private buildPersonalizedPrompt(
        candidateName: string,
        queryText: string,
        capsule: PersonalizationCapsule,
        domain: string,
        userName: string
    ): string {
        const prefs = JSON.stringify(capsule.members?.[0]?.preferences || {});
        const domainContext = getDomainContext(domain);

        return `${domainContext}

Tell ${userName} what's great about "${candidateName}" and flag anything that might not be a fit. Every result was curated for a reason — lead with what's great, then add honest caveats. Ground your note in something SPECIFIC — a scene, a sound, a dish, a moment — not abstract preference-matching.
Search: "${queryText}"
Preferences: ${prefs}

PREFERENCE ACCURACY (CRITICAL):
- ONLY reference preferences that LITERALLY APPEAR in the Preferences JSON above.
- NEVER infer, guess, or hallucinate additional preferences beyond what is in the JSON.
- If the Preferences JSON is sparse, focus on the item's specific qualities rather than inventing connections.

TONE:
- Write like a friend who's been there, not an algorithm
- Be enthusiastic but honest about caveats
- One punchy sentence, max two
- EVERY result was already curated — always lead with what's genuinely great, then flag caveats
- NEVER say "skip this" or "hard pass" — if something has drawbacks, frame them as context: "it's loud and buzzy, so more of a fun night out than a quiet date" NOT "skip this if you want quiet"

EXAMPLES OF GREAT NOTES (notice: they lead with the item, not the user):
- "The hand-drawn animation is jaw-dropping, and the themes of loss hit way harder than you'd expect from the poster."
- "If the jazz in your library had a visual equivalent, it'd be this — moody, improvisational, completely absorbing."
- "It's a slow burn and the first hour drags, but the payoff in the last 20 minutes is devastating — worth the patience."
- "The director shoots every conversation like a heist scene — tight cuts, no wasted frames. You'll tear through it."
- "The wood-fired crust here is otherworldly, and if you're into natural wine, the list is curated by someone who actually knows what they're doing."

Your recommendation:`;
    }

    /**
     * When user has NO preferences: give review-grounded insider tip.
     */
    private buildInsiderPrompt(
        candidateName: string,
        queryText: string,
        domain: string,
        userName: string
    ): string {
        const insiderContext = getInsiderContext(domain);

        return `${insiderContext}

What should ${userName} know about "${candidateName}"?
Search: "${queryText}"

Give an insider tip — the kind of thing a well-connected local friend would share.
Focus on what makes it special, what to actually do there, or what most people miss.
You have NO preference data for this user — tell them what ANYONE would want to know.

RULES:
- One punchy sentence, max two
- Be specific and concrete — lead with the THING, not the person
- Only name specific items (dishes, songs, etc.) if you're CONFIDENT they're real

EXAMPLES OF GREAT INSIDER TIPS:
- "Go on a weeknight — crowds thin out and you'll actually hear the performers."
- "Fair warning: the line wraps around the block, but the brisket is the best in the city."
- "The tasting menu is a splurge, but the wine pairings are where they really flex."
- "Skip the main room — the back garden is where locals hide, and the cocktails are better there too."
- "Sound design alone makes this worth it — headphones, lights off, full attention."

Your insider tip:`;
    }
}
