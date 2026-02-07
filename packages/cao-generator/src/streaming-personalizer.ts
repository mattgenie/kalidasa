/**
 * Streaming Personalizer
 * 
 * Generates personalization for single candidates as they arrive.
 * Uses domain-aware prompts for better results.
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
 * Get domain-specific context for personalization
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
        const prefs = JSON.stringify(capsule.members?.[0]?.preferences || {});
        const domainContext = getDomainContext(domain || 'places');

        const prompt = `${domainContext}

Why would "${candidateName}" be great for ${userName}?
Search: "${queryText}"
Preferences: ${prefs}

TONE (critical):
- Write like a friend recommending something
- Use "you" and "your", NEVER "${userName}'s preference" or "aligns with"  
- Be enthusiastic but honest about caveats
- One punchy sentence, max two

BAD: "This aligns with ${userName}'s preference for comedy"
GOOD: "Dry wit meets sharp writing - right up your alley"

Your recommendation:`;

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
}
