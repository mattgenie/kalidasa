/**
 * Shared Services
 *
 * Eagerly initializes the HookRegistry and HookHealthMonitor at import time.
 * This module is imported by both index.ts and handlers so it MUST NOT import
 * from index.ts to avoid circular dependencies.
 *
 * Import chain: index.ts → services.ts (this file)
 *               handlers/streaming-handler.ts → services.ts (this file)
 */

import { createHookRegistry, HookHealthMonitor, geocodeAddress } from '@kalidasa/enrichment';
import { GoogleGenerativeAI } from '@google/generative-ai';

// ── Eager initialization at boot, not on first request ──
export const sharedRegistry = createHookRegistry();
export const sharedHealthMonitor = new HookHealthMonitor();

// Start background health checks (every 5 minutes)
sharedHealthMonitor.start(sharedRegistry);

// Register external dependency checks
const geminiApiKey = process.env.GEMINI_API_KEY || '';
if (geminiApiKey) {
    const genAI = new GoogleGenerativeAI(geminiApiKey);
    sharedHealthMonitor.registerExternalCheck('gemini', async () => {
        try {
            const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
            const result = await model.generateContent('Say "ok"');
            return !!result.response.text();
        } catch {
            return false;
        }
    });
}

sharedHealthMonitor.registerExternalCheck('google_geocoding', async () => {
    const result = await geocodeAddress('Times Square, New York');
    return result !== null;
});

export const bootTime = Date.now();
