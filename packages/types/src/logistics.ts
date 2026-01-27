/**
 * Logistics Context Types
 * 
 * When, where, and practical constraints for the search.
 */

export interface LogisticsContext {
    /** Time context */
    time?: TimeContext;

    /** Per-member location context (if different) */
    locations?: MemberLocation[];

    /** Primary location for the search */
    searchLocation?: SearchLocation;

    /** Party/group details */
    party?: PartyContext;

    /** Practical constraints */
    constraints?: ConstraintsContext;

    /** Occasion type */
    occasion?: string;
}

export interface TimeContext {
    /** Local time in HH:MM format */
    localTime?: string;
    /** IANA timezone identifier */
    timezone?: string;
    /** Date in YYYY-MM-DD format */
    date?: string;
    /** Time of day: morning, afternoon, evening, night */
    timeOfDay?: string;
    /** Flexibility: flexible, strict */
    flexibility?: string;
}

export interface MemberLocation {
    /** Member this location belongs to */
    memberId: string;
    city?: string;
    neighborhood?: string;
    coordinates?: Coordinates;
}

export interface SearchLocation {
    city?: string;
    neighborhood?: string;
    coordinates?: Coordinates;
    /** Search radius in meters */
    radius?: number;
}

export interface Coordinates {
    lat: number;
    lng: number;
}

export interface PartyContext {
    /** Number of people */
    size?: number;
    /** Description: "adults only", "with kids", etc */
    composition?: string;
    /** Age groups present */
    ageGroups?: string[];
    /** Has children in the group */
    hasChildren?: boolean;
}

export interface ConstraintsContext {
    /** Budget level */
    budget?: '$' | '$$' | '$$$' | '$$$$';
    /** Accessibility requirements */
    accessibility?: string[];
    /** Transportation mode: walking, driving, transit */
    transportation?: string;
    /** Maximum travel time in minutes */
    maxTravelTime?: number;
}
