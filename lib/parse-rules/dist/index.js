"use strict";
/**
 * @aklab/parse-rules — единый источник правды для ParseRules интерфейса,
 * buildParseRules() и pure user filter snapshot contract.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.matchesUserFilterSnapshot = exports.matchesUserParseProfile = exports.hashUserFilterSnapshot = exports.canonicalizeFilterSnapshot = exports.createFilterSnapshot = exports.PROPERTY_TYPE_VALUES = exports.REGION_VALUES = exports.PropertyType = exports.Region = void 0;
exports.buildParseRules = buildParseRules;
exports.normalizeUserParseProfile = normalizeUserParseProfile;
exports.normalizeUserFilterSnapshot = normalizeUserFilterSnapshot;
exports.canonicalJson = canonicalJson;
exports.canonicalizeSnapshot = canonicalizeSnapshot;
exports.hashSnapshot = hashSnapshot;
exports.createUserFilterSnapshot = createUserFilterSnapshot;
exports.matchesProfile = matchesProfile;
exports.matchesSnapshot = matchesSnapshot;
exports.profileMatchesCandidate = profileMatchesCandidate;
exports.snapshotMatchesCandidate = snapshotMatchesCandidate;
function buildParseRules(setting) {
    return {
        stopWords: setting?.stop_words || undefined,
        priceFrom: setting?.price_from != null ? Number(setting.price_from) : undefined,
        priceTo: setting?.price_to != null ? Number(setting.price_to) : undefined,
        areaFrom: setting?.area_from != null ? Number(setting.area_from) : undefined,
        areaTo: setting?.area_to != null ? Number(setting.area_to) : undefined,
        cities: setting?.monitored_regions?.length ? setting.monitored_regions : undefined,
    };
}
/** Runtime enum values shared by parser candidates and user profiles. */
exports.Region = {
    moscow: 'moscow',
    mo: 'mo',
    other: 'other',
};
exports.PropertyType = {
    office: 'office',
    warehouse: 'warehouse',
    retail: 'retail',
    production: 'production',
    free_purpose: 'free_purpose',
    apartment: 'apartment',
    land: 'land',
    other: 'other',
};
exports.REGION_VALUES = Object.values(exports.Region);
exports.PROPERTY_TYPE_VALUES = Object.values(exports.PropertyType);
const TEXT_KEYS = ['title', 'description', 'address', 'excerpt', 'text', 'body', 'content', 'details'];
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function normalizeId(value, field) {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
        throw new TypeError(`${field} must be a positive safe integer`);
    }
    return value;
}
function normalizeVersion(value) {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
        throw new TypeError('version must be a positive safe integer');
    }
    return value;
}
function normalizeNullableNumber(value, field) {
    if (value === undefined || value === null)
        return null;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        throw new TypeError(`${field} must be a finite non-negative number or null`);
    }
    return value;
}
function normalizeStringArray(value, field) {
    if (value === undefined || value === null)
        return [];
    if (!Array.isArray(value))
        throw new TypeError(`${field} must be an array`);
    return [...new Set(value.map(item => {
            if (typeof item !== 'string')
                throw new TypeError(`${field} must contain strings`);
            return item.trim().toLowerCase();
        }).filter(Boolean))].sort();
}
function normalizeEnumArray(value, field, allowed) {
    const normalized = normalizeStringArray(value, field);
    for (const item of normalized) {
        if (!allowed.includes(item))
            throw new TypeError(`${field} contains unsupported value: ${item}`);
    }
    return normalized;
}
function profilePayload(input) {
    if (!isRecord(input))
        throw new TypeError('profile must be an object');
    // Read only the allowlisted contract fields. PII and arbitrary fields never enter the payload.
    const payload = {
        userId: normalizeId(input.userId, 'userId'),
        profileId: normalizeId(input.profileId, 'profileId'),
        version: normalizeVersion(input.version),
        regions: normalizeEnumArray(input.regions, 'regions', exports.REGION_VALUES),
        propertyTypes: normalizeEnumArray(input.propertyTypes, 'propertyTypes', exports.PROPERTY_TYPE_VALUES),
        priceFrom: normalizeNullableNumber(input.priceFrom, 'priceFrom'),
        priceTo: normalizeNullableNumber(input.priceTo, 'priceTo'),
        areaFrom: normalizeNullableNumber(input.areaFrom, 'areaFrom'),
        areaTo: normalizeNullableNumber(input.areaTo, 'areaTo'),
        stopWords: normalizeStringArray(input.stopWords, 'stopWords'),
    };
    if (payload.priceFrom !== null && payload.priceTo !== null && payload.priceFrom > payload.priceTo) {
        throw new RangeError('priceFrom must be less than or equal to priceTo');
    }
    if (payload.areaFrom !== null && payload.areaTo !== null && payload.areaFrom > payload.areaTo) {
        throw new RangeError('areaFrom must be less than or equal to areaTo');
    }
    return payload;
}
/** Normalize one profile into the exact allowlisted contract shape. */
function normalizeUserParseProfile(input) {
    return profilePayload(input);
}
function snapshotPayload(input) {
    if (!isRecord(input))
        throw new TypeError('snapshot must be an object');
    if (input.schemaVersion !== 1)
        throw new TypeError('snapshot schemaVersion must be 1');
    if (input.scope !== 'all' && input.scope !== 'single')
        throw new TypeError('snapshot scope is invalid');
    if (!isIsoDateTime(input.createdAt)) {
        throw new TypeError('snapshot createdAt must be a valid ISO datetime string');
    }
    if (!isIsoDateTime(input.windowEndAt)) {
        throw new TypeError('snapshot windowEndAt must be a valid ISO datetime string');
    }
    if (!Array.isArray(input.profiles))
        throw new TypeError('snapshot profiles must be an array');
    const profiles = input.profiles.map(profilePayload);
    if (input.scope === 'single' && profiles.length !== 1) {
        throw new RangeError('single snapshot scope requires exactly one profile');
    }
    const userIds = new Set();
    const profileIds = new Set();
    for (const profile of profiles) {
        if (userIds.has(profile.userId))
            throw new TypeError('snapshot contains duplicate userId');
        if (profileIds.has(profile.profileId))
            throw new TypeError('snapshot contains duplicate profileId');
        userIds.add(profile.userId);
        profileIds.add(profile.profileId);
    }
    profiles.sort((left, right) => (left.userId - right.userId ||
        left.profileId - right.profileId ||
        left.version - right.version));
    return {
        schemaVersion: 1,
        scope: input.scope,
        createdAt: input.createdAt,
        windowEndAt: input.windowEndAt,
        profiles,
    };
}
const ISO_DATETIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/;
function isIsoDateTime(value) {
    if (typeof value !== 'string')
        return false;
    const match = ISO_DATETIME_PATTERN.exec(value);
    if (!match)
        return false;
    const [, yearText, monthText, dayText, hourText, minuteText, secondText, fractionText, zone] = match;
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    const hour = Number(hourText);
    const minute = Number(minuteText);
    const second = Number(secondText);
    const milliseconds = Number((fractionText || '').slice(0, 3).padEnd(3, '0') || 0);
    const offsetHour = zone === 'Z' ? 0 : Number(zone.slice(1, 3));
    const offsetMinute = zone === 'Z' ? 0 : Number(zone.slice(4, 6));
    if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59)
        return false;
    if (zone !== 'Z' && (offsetHour > 23 || offsetMinute > 59))
        return false;
    const utcDate = new Date(0);
    utcDate.setUTCFullYear(year, month - 1, day);
    utcDate.setUTCHours(hour, minute, second, milliseconds);
    if (utcDate.getUTCFullYear() !== year ||
        utcDate.getUTCMonth() !== month - 1 ||
        utcDate.getUTCDate() !== day ||
        utcDate.getUTCHours() !== hour ||
        utcDate.getUTCMinutes() !== minute ||
        utcDate.getUTCSeconds() !== second ||
        utcDate.getUTCMilliseconds() !== milliseconds)
        return false;
    const offset = (offsetHour * 60 + offsetMinute) * (zone === 'Z' || zone[0] === '+' ? 1 : -1);
    return Date.parse(value) === utcDate.getTime() - offset * 60000;
}
/** Normalize a snapshot and recompute its integrity hash. */
function normalizeUserFilterSnapshot(input) {
    const payload = snapshotPayload(input);
    return { ...payload, hash: sha256(canonicalJson(payload)) };
}
function canonicalValue(value) {
    if (Array.isArray(value))
        return value.map(canonicalValue);
    if (isRecord(value)) {
        return Object.keys(value).sort().reduce((sorted, key) => {
            sorted[key] = canonicalValue(value[key]);
            return sorted;
        }, {});
    }
    return value;
}
/** Stable JSON serialization: object keys are sorted recursively. */
function canonicalJson(value) {
    return JSON.stringify(canonicalValue(value));
}
/** Canonical pre-hash payload; hash itself is intentionally excluded to avoid a cycle. */
function canonicalizeSnapshot(input) {
    return canonicalJson(snapshotPayload(input));
}
function hashSnapshot(input) {
    return sha256(canonicalizeSnapshot(input));
}
function sha256(value) {
    // Keep the package dependency-free and compatible with the existing Node workspace.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createHash } = require('crypto');
    return createHash('sha256').update(value).digest('hex');
}
/** Build a snapshot from an allowlisted payload and a deterministic hash. */
function createUserFilterSnapshot(input) {
    return normalizeUserFilterSnapshot(input);
}
exports.createFilterSnapshot = createUserFilterSnapshot;
exports.canonicalizeFilterSnapshot = canonicalizeSnapshot;
exports.hashUserFilterSnapshot = hashSnapshot;
function matchPhase(option) {
    if (typeof option === 'string')
        return option;
    return option?.phase || option?.stage || 'details';
}
function candidateValue(candidate, keys) {
    for (const key of keys) {
        if (candidate[key] !== undefined)
            return { present: true, value: candidate[key] };
    }
    return { present: false, value: undefined };
}
function matchesEnum(profileValues, candidate, keys) {
    if (profileValues.length === 0)
        return false;
    const candidateField = candidateValue(candidate, keys);
    if (!candidateField.present)
        return true;
    if (typeof candidateField.value !== 'string')
        return false;
    return profileValues.includes(candidateField.value.trim().toLowerCase());
}
function matchesRange(from, to, candidate, keys) {
    const candidateField = candidateValue(candidate, keys);
    if (!candidateField.present)
        return true;
    if (typeof candidateField.value !== 'number' || !Number.isFinite(candidateField.value) || candidateField.value < 0)
        return false;
    if (from === null && to === null)
        return true;
    if (from !== null && candidateField.value < from)
        return false;
    if (to !== null && candidateField.value > to)
        return false;
    return true;
}
function matchesStopWords(stopWords, candidate) {
    const textValues = TEXT_KEYS
        .filter(key => candidate[key] !== undefined)
        .map(key => candidate[key]);
    if (textValues.some(value => typeof value !== 'string'))
        return false;
    if (stopWords.length === 0)
        return true;
    const availableText = textValues.join(' ').toLowerCase();
    return !stopWords.some(stopWord => availableText.includes(stopWord));
}
/** Match one whole profile. Every populated profile constraint is ANDed. */
function matchesProfile(profile, candidate, phase) {
    try {
        const normalized = profilePayload(profile);
        if (!isRecord(candidate))
            return false;
        return matchesEnum(normalized.regions, candidate, ['region', 'city'])
            && matchesEnum(normalized.propertyTypes, candidate, ['propertyType', 'property_type'])
            && matchesRange(normalized.priceFrom, normalized.priceTo, candidate, ['price', 'minimum_price'])
            && matchesRange(normalized.areaFrom, normalized.areaTo, candidate, ['area_sqm', 'area'])
            && matchesStopWords(normalized.stopWords, candidate);
    }
    catch {
        // Invalid persisted input must never widen a user scope.
        return false;
    }
}
/** Match the candidate against the OR of complete profiles, returning one boolean. */
function matchesSnapshot(snapshot, candidate, phase) {
    try {
        if (!isRecord(snapshot) || typeof snapshot.hash !== 'string' || !/^[0-9a-f]{64}$/i.test(snapshot.hash)) {
            return false;
        }
        const payload = snapshotPayload(snapshot);
        const computedHash = sha256(canonicalJson(payload));
        if (snapshot.hash.toLowerCase() !== computedHash)
            return false;
        return payload.profiles.some(profile => matchesProfile(profile, candidate, phase));
    }
    catch {
        return false;
    }
}
/** Candidate-first aliases for scan/details integrations. */
function profileMatchesCandidate(candidate, profile, phase) {
    return matchesProfile(profile, candidate, phase);
}
function snapshotMatchesCandidate(candidate, snapshot, phase) {
    return matchesSnapshot(snapshot, candidate, phase);
}
exports.matchesUserParseProfile = matchesProfile;
exports.matchesUserFilterSnapshot = matchesSnapshot;
