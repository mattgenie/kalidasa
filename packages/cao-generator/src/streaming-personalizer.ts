/**
 * Streaming Personalizer
 * 
 * Generates personalization for single candidates as they arrive.
 * Uses a fast, minimal prompt for speed.
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
        capsule: PersonalizationCapsule
    ): Promise<CandidatePersonalization> {
        const userName = capsule.members?.[0]?.name || 'user';
        const prefs = JSON.stringify(capsule.members?.[0]?.preferences || {});

        const prompt = `Why is "${candidateName}" good for ${userName}?
Query: "${queryText}"
Preferences: ${prefs}

One sentence only:`;

        const model = this.genAI.getGenerativeModel({
            model: this.model,
            generationConfig: {
                temperature: 0.7,
                maxOutputTokens: 100,
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
