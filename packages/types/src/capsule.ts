/**
 * Personalization Capsule Types
 * 
 * Passed from the Chat Agent to describe who is searching
 * and their preferences.
 */

export interface PersonalizationCapsule {
    /** Solo user or group search */
    mode: 'solo' | 'group';

    /** Members with their preferences */
    members: CapsuleMember[];

    /** How to balance conflicting group preferences */
    groupPolicy?: string;
}

export interface CapsuleMember {
    /** Unique member identifier */
    id: string;

    /** Display name */
    name: string;

    /** Domain-specific preferences */
    preferences: MemberPreferences;
}

export interface MemberPreferences {
    places?: PlacesPreferences;
    movies?: MoviesPreferences;
    music?: MusicPreferences;
    events?: EventsPreferences;
}

export interface PlacesPreferences {
    favoriteCuisines?: string[];
    dietaryRestrictions?: string[];
    pricePreference?: '$' | '$$' | '$$$' | '$$$$';
    ambiance?: string[];
    dislikes?: string[];
}

export interface MoviesPreferences {
    favoriteGenres?: string[];
    favoriteActors?: string[];
    favoriteDirectors?: string[];
    platforms?: string[];
    contentRating?: string[];
    dislikes?: string[];
}

export interface MusicPreferences {
    favoriteGenres?: string[];
    favoriteArtists?: string[];
    platforms?: string[];
    dislikes?: string[];
}

export interface EventsPreferences {
    favoriteTypes?: string[];
    maxPrice?: number;
    preferIndoor?: boolean;
    preferOutdoor?: boolean;
}
