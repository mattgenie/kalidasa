/**
 * Logging Middleware
 * 
 * Logs requests and responses with timing.
 */

import type { Request, Response, NextFunction } from 'express';

export function loggingMiddleware(
    req: Request,
    res: Response,
    next: NextFunction
): void {
    const startTime = Date.now();
    const method = req.method;
    const url = req.url;

    // Log request
    console.log(`→ ${method} ${url}`);

    // Capture response
    const originalSend = res.send.bind(res);
    res.send = function (body: any): Response {
        const duration = Date.now() - startTime;
        const status = res.statusCode;

        const statusEmoji = status >= 400 ? '❌' : status >= 300 ? '↪️' : '✅';
        console.log(`← ${statusEmoji} ${method} ${url} ${status} (${duration}ms)`);

        return originalSend(body);
    };

    next();
}
