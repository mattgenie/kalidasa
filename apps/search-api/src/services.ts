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

// Register external dependency checks with core/enhancement classification.
// "core" → 503 on failure (App Runner restart).
// "enhancement" → degrade gracefully, report in /health, keep serving.
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
    }, 'core');  // Gemini is core — can't generate results without it
}

sharedHealthMonitor.registerExternalCheck('google_geocoding', async () => {
    const result = await geocodeAddress('Times Square, New York');
    return result !== null;
}, 'enhancement');  // Geocoding enriches location data but search works without it

// SerpAPI charges per search credit — check hourly instead of every 5 min.
// At 5-min intervals: 288 checks/day = ~100% of free tier in 8 hours.
// At 1-hour intervals: 24 checks/day = sustainable.
sharedHealthMonitor.setHookCheckInterval('serpapi_events', 3_600_000);

export const bootTime = Date.now();
