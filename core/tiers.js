export const TIERS = {
    FREE: 0,
    PRO_MONTHLY: 1,
    PRO_YEARLY: 2,
    PRO_PLUS_MONTHLY: 3,
    PRO_PLUS_YEARLY: 4
};

export const TIER_NAMES = {
    [TIERS.FREE]: "Free",
    [TIERS.PRO_MONTHLY]: "Pro (Monthly)",
    [TIERS.PRO_YEARLY]: "Pro (Yearly)",
    [TIERS.PRO_PLUS_MONTHLY]: "Pro+ (Monthly)",
    [TIERS.PRO_PLUS_YEARLY]: "Pro+ (Yearly)"
};

export const FEATURES = {
    [TIERS.FREE]: {
        maxNgWords: 5,
        maxGuilds: 1,
        ngLog: false,
        vcLog: true,
        dashboard: false,
        activity: false,
        autoRelease: false
    },
    [TIERS.PRO_MONTHLY]: {
        maxNgWords: 20,
        maxGuilds: 1,
        ngLog: true,
        vcLog: true,
        dashboard: true,
        activity: false,
        autoRelease: true
    },
    [TIERS.PRO_YEARLY]: {
        maxNgWords: 20,
        maxGuilds: 1,
        ngLog: true,
        vcLog: true,
        dashboard: true,
        activity: false,
        autoRelease: true
    },
    [TIERS.PRO_PLUS_MONTHLY]: {
        maxNgWords: 50,
        maxGuilds: 3,
        ngLog: true,
        vcLog: true,
        dashboard: true,
        activity: true,
        autoRelease: true
    },
    [TIERS.PRO_PLUS_YEARLY]: {
        maxNgWords: 50,
        maxGuilds: 3,
        ngLog: true,
        vcLog: true,
        dashboard: true,
        activity: true,
        autoRelease: true
    }
};

export function getFeatures(tier) {
    return FEATURES[tier] || FEATURES[TIERS.FREE];
}
