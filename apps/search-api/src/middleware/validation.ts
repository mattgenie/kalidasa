/**
 * Validation Middleware
 * 
 * Validates incoming search requests using Zod schemas.
 */

import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';

// Domain enum
const DomainSchema = z.enum(['places', 'movies', 'music', 'events', 'articles', 'general']);

// Query schema
const QuerySchema = z.object({
    text: z.string().min(1, 'Query text is required'),
    domain: DomainSchema,
    intent: z.string().optional(),
    excludes: z.array(z.string()).optional(),
});

// Member preferences schemas
const PlacesPreferencesSchema = z.object({
    favoriteCuisines: z.array(z.string()).optional(),
    dietaryRestrictions: z.array(z.string()).optional(),
    pricePreference: z.enum(['$', '$$', '$$$', '$$$$']).optional(),
    ambiance: z.array(z.string()).optional(),
    dislikes: z.array(z.string()).optional(),
}).optional();

const MoviesPreferencesSchema = z.object({
    favoriteGenres: z.array(z.string()).optional(),
    favoriteActors: z.array(z.string()).optional(),
    favoriteDirectors: z.array(z.string()).optional(),
    platforms: z.array(z.string()).optional(),
    dislikes: z.array(z.string()).optional(),
}).optional();

const MusicPreferencesSchema = z.object({
    favoriteGenres: z.array(z.string()).optional(),
    favoriteArtists: z.array(z.string()).optional(),
    platforms: z.array(z.string()).optional(),
    dislikes: z.array(z.string()).optional(),
}).optional();

const MemberPreferencesSchema = z.object({
    places: PlacesPreferencesSchema,
    movies: MoviesPreferencesSchema,
    music: MusicPreferencesSchema,
});

// Capsule member schema
const CapsuleMemberSchema = z.object({
    id: z.string(),
    name: z.string(),
    preferences: MemberPreferencesSchema,
});

// Capsule schema
const CapsuleSchema = z.object({
    mode: z.enum(['solo', 'group']),
    members: z.array(CapsuleMemberSchema).min(1),
    groupPolicy: z.string().optional(),
});

// Coordinates schema
const CoordinatesSchema = z.object({
    lat: z.number(),
    lng: z.number(),
});

// Time context schema
const TimeContextSchema = z.object({
    localTime: z.string().optional(),
    timezone: z.string().optional(),
    date: z.string().optional(),
    timeOfDay: z.string().optional(),
    flexibility: z.string().optional(),
}).optional();

// Search location schema
const SearchLocationSchema = z.object({
    city: z.string().optional(),
    neighborhood: z.string().optional(),
    coordinates: CoordinatesSchema.optional(),
    radius: z.number().optional(),
}).optional();

// Party context schema
const PartyContextSchema = z.object({
    size: z.number().optional(),
    composition: z.string().optional(),
    ageGroups: z.array(z.string()).optional(),
    hasChildren: z.boolean().optional(),
}).optional();

// Constraints schema
const ConstraintsContextSchema = z.object({
    budget: z.enum(['$', '$$', '$$$', '$$$$']).optional(),
    accessibility: z.array(z.string()).optional(),
    transportation: z.string().optional(),
    maxTravelTime: z.number().optional(),
}).optional();

// Logistics schema
const LogisticsSchema = z.object({
    time: TimeContextSchema,
    locations: z.array(z.object({
        memberId: z.string(),
        city: z.string().optional(),
        neighborhood: z.string().optional(),
        coordinates: CoordinatesSchema.optional(),
    })).optional(),
    searchLocation: SearchLocationSchema,
    party: PartyContextSchema,
    constraints: ConstraintsContextSchema,
    occasion: z.string().optional(),
});

// Conversation context schema
const ConversationContextSchema = z.object({
    recentMessages: z.array(z.object({
        speaker: z.string(),
        content: z.string(),
        isAgent: z.boolean(),
    })).optional(),
    previousSearches: z.array(z.string()).optional(),
    corrections: z.array(z.string()).optional(),
}).optional();

// Options schema
const OptionsSchema = z.object({
    maxResults: z.number().min(1).max(50).optional(),
    includeDebug: z.boolean().optional(),
    enrichmentTimeout: z.number().min(500).max(10000).optional(),
}).optional();

// Full request schema
const SearchRequestSchema = z.object({
    query: QuerySchema,
    capsule: CapsuleSchema,
    logistics: LogisticsSchema,
    conversation: ConversationContextSchema,
    options: OptionsSchema,
});

/**
 * Validate search request middleware
 */
export function validateSearchRequest(
    req: Request,
    res: Response,
    next: NextFunction
): void {
    try {
        const validated = SearchRequestSchema.parse(req.body);
        req.body = validated;
        next();
    } catch (error) {
        if (error instanceof z.ZodError) {
            res.status(400).json({
                error: 'Validation failed',
                details: error.errors.map(e => ({
                    path: e.path.join('.'),
                    message: e.message,
                })),
            });
            return;
        }

        res.status(400).json({
            error: 'Invalid request body',
        });
    }
}
