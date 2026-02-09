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
                forUser: `Recommended for ${userName}`,
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

Why would "${candidateName}" be great for ${userName}?
Search: "${queryText}"
Preferences: ${prefs}

TONE (critical):
- Write like a friend recommending something
- Use "you" and "your", NEVER "${userName}'s preference" or "aligns with"
- Reference SPECIFIC items from their preferences by name
- Be enthusiastic but honest about caveats
- One punchy sentence, max two

BAD: "This aligns with ${userName}'s preference for comedy"
GOOD: "Dry wit meets sharp writing - right up your alley"

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

RULES:
- One punchy sentence, max two
- Be specific and concrete — "the window seats have the best view" not "nice atmosphere"
- Only name specific items (dishes, songs, etc.) if you're CONFIDENT they're real
- Do NOT invent or assume user preferences — you have NO preference data
- Do NOT say "right up your alley" or "perfect for your taste" — you don't know their taste

BAD: "This aligns with your interest in live music." (inventing preferences)
BAD: "A popular spot that many enjoy." (generic, useless)
GOOD: "Go on a weeknight — crowds thin out and you'll actually hear the performers."
GOOD: "Fair warning: the line wraps around the block, but the brisket is the best in the city."

Your insider tip:`;
    }
}
