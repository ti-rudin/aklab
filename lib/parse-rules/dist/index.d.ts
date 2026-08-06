/**
 * @aklab/parse-rules — единый источник правды для ParseRules интерфейса,
 * buildParseRules() и pure user filter snapshot contract.
 */
export interface ParseRules {
    stopWords?: string[];
    priceFrom?: number;
    priceTo?: number;
    areaFrom?: number;
    areaTo?: number;
    cities?: string[];
}
export declare function buildParseRules(setting: any): ParseRules;
/** Runtime enum values shared by parser candidates and user profiles. */
export declare const Region: {
    readonly moscow: "moscow";
    readonly mo: "mo";
    readonly other: "other";
};
export type Region = (typeof Region)[keyof typeof Region];
export declare const PropertyType: {
    readonly office: "office";
    readonly warehouse: "warehouse";
    readonly retail: "retail";
    readonly production: "production";
    readonly free_purpose: "free_purpose";
    readonly apartment: "apartment";
    readonly land: "land";
    readonly other: "other";
};
export type PropertyType = (typeof PropertyType)[keyof typeof PropertyType];
export declare const REGION_VALUES: readonly Region[];
export declare const PROPERTY_TYPE_VALUES: readonly PropertyType[];
export interface UserParseProfile {
    userId: number;
    profileId: number;
    version: number;
    regions: Region[];
    propertyTypes: PropertyType[];
    priceFrom: number | null;
    priceTo: number | null;
    areaFrom: number | null;
    areaTo: number | null;
    stopWords: string[];
}
export interface UserFilterSnapshot {
    schemaVersion: 1;
    scope: 'all' | 'single';
    createdAt: string;
    profiles: UserParseProfile[];
    hash: string;
}
export type UserFilterSnapshotInput = Omit<UserFilterSnapshot, 'hash'> & Partial<Pick<UserFilterSnapshot, 'hash'>>;
export type FilterMatchPhase = 'scan' | 'details';
export type FilterMatchPhaseOption = FilterMatchPhase | {
    phase?: FilterMatchPhase;
    stage?: FilterMatchPhase;
};
/** Candidate fields understood by the pure matcher. Other fields are ignored. */
export interface FilterCandidate {
    region?: unknown;
    city?: unknown;
    propertyType?: unknown;
    property_type?: unknown;
    price?: unknown;
    minimum_price?: unknown;
    area?: unknown;
    area_sqm?: unknown;
    title?: unknown;
    description?: unknown;
    address?: unknown;
    excerpt?: unknown;
    text?: unknown;
    body?: unknown;
    content?: unknown;
    details?: unknown;
    [key: string]: unknown;
}
/** Normalize one profile into the exact allowlisted contract shape. */
export declare function normalizeUserParseProfile(input: UserParseProfile): UserParseProfile;
/** Normalize a snapshot and recompute its integrity hash. */
export declare function normalizeUserFilterSnapshot(input: UserFilterSnapshotInput): UserFilterSnapshot;
/** Stable JSON serialization: object keys are sorted recursively. */
export declare function canonicalJson(value: unknown): string;
/** Canonical pre-hash payload; hash itself is intentionally excluded to avoid a cycle. */
export declare function canonicalizeSnapshot(input: UserFilterSnapshotInput): string;
export declare function hashSnapshot(input: UserFilterSnapshotInput): string;
/** Build a snapshot from an allowlisted payload and a deterministic hash. */
export declare function createUserFilterSnapshot(input: UserFilterSnapshotInput): UserFilterSnapshot;
export declare const createFilterSnapshot: typeof createUserFilterSnapshot;
export declare const canonicalizeFilterSnapshot: typeof canonicalizeSnapshot;
export declare const hashUserFilterSnapshot: typeof hashSnapshot;
/** Match one whole profile. Every populated profile constraint is ANDed. */
export declare function matchesProfile(profile: UserParseProfile, candidate: FilterCandidate, phase?: FilterMatchPhaseOption): boolean;
/** Match the candidate against the OR of complete profiles, returning one boolean. */
export declare function matchesSnapshot(snapshot: UserFilterSnapshot, candidate: FilterCandidate, phase?: FilterMatchPhaseOption): boolean;
/** Candidate-first aliases for scan/details integrations. */
export declare function profileMatchesCandidate(candidate: FilterCandidate, profile: UserParseProfile, phase?: FilterMatchPhaseOption): boolean;
export declare function snapshotMatchesCandidate(candidate: FilterCandidate, snapshot: UserFilterSnapshot, phase?: FilterMatchPhaseOption): boolean;
export declare const matchesUserParseProfile: typeof matchesProfile;
export declare const matchesUserFilterSnapshot: typeof matchesSnapshot;
