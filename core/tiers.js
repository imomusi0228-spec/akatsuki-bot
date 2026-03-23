export const TIERS = {
    FREE: 0,
    PRO_MONTHLY: 1,
    PRO_YEARLY: 2,
    PRO_PLUS_MONTHLY: 3,
    PRO_PLUS_YEARLY: 4,
    TRIAL_PRO_PLUS: 5,
    TRIAL_PRO: 6,
    ULTIMATE: 999,
};

export const MILESTONES = {
    M1_PROTECTION: 1, // v1.1.1
    M2_DEFENSE: 2, // v1.2.0
    M3_STRATEGY: 3, // v1.2.1
    M4_GOVERNANCE: 4, // v1.3.0
    M5_ULTIMATE: 5, // Pro+ Full
};

export const TIER_NAMES = {
    [TIERS.FREE]: "Free",
    [TIERS.PRO_MONTHLY]: "Pro",
    [TIERS.PRO_YEARLY]: "Pro",
    [TIERS.PRO_PLUS_MONTHLY]: "Pro+",
    [TIERS.PRO_PLUS_YEARLY]: "Pro+",
    [TIERS.TRIAL_PRO_PLUS]: "Trial Pro+",
    [TIERS.TRIAL_PRO]: "Trial Pro",
    [TIERS.ULTIMATE]: "ULTIMATE",
};

export const TIER_COLORS = {
    [TIERS.FREE]: "#8b9bb4",
    [TIERS.PRO_MONTHLY]: "#1d9bf0",
    [TIERS.PRO_YEARLY]: "#1d9bf0",
    [TIERS.PRO_PLUS_MONTHLY]: "#fbbf24",
    [TIERS.PRO_PLUS_YEARLY]: "#fbbf24",
    [TIERS.TRIAL_PRO_PLUS]: "#fbbf24",
    [TIERS.TRIAL_PRO]: "#1d9bf0",
    [TIERS.ULTIMATE]: "#bb9af7",
};

export const FEATURES = {
    [TIERS.FREE]: {
        maxNgWords: 10,
        maxGuilds: 1,
        ngLog: false,
        vcLog: true,
        dashboard: true,
        activity: true,
        autoRelease: true,
        antiraid: true,
        spamProtection: false,
        audit: false,
        introGate: false,
        longTermStats: false,
        aura: true,
        statsRetentionDays: 7,
    },
    [TIERS.PRO_MONTHLY]: {
        maxNgWords: 20,
        maxGuilds: 3,
        ngLog: true,
        vcLog: true,
        dashboard: true,
        activity: true,
        autoRelease: true,
        antiraid: true,
        spamProtection: true,
        audit: false,
        introGate: false,
        longTermStats: false,
        aura: true,
        statsRetentionDays: 30,
    },
    [TIERS.PRO_YEARLY]: {
        maxNgWords: 20,
        maxGuilds: 3,
        ngLog: true,
        vcLog: true,
        dashboard: true,
        activity: true,
        autoRelease: true,
        antiraid: true,
        spamProtection: true,
        audit: false,
        introGate: false,
        longTermStats: false,
        aura: true,
        statsRetentionDays: 30,
    },
    [TIERS.PRO_PLUS_MONTHLY]: {
        maxNgWords: 50,
        maxGuilds: 5,
        ngLog: true,
        vcLog: true,
        dashboard: true,
        activity: true,
        autoRelease: true,
        antiraid: true,
        spamProtection: true,
        audit: true,
        introGate: true,
        longTermStats: true,
        aura: true,
        statsRetentionDays: 180,
    },
    [TIERS.PRO_PLUS_YEARLY]: {
        maxNgWords: 50,
        maxGuilds: 5,
        ngLog: true,
        vcLog: true,
        dashboard: true,
        activity: true,
        autoRelease: true,
        antiraid: true,
        spamProtection: true,
        audit: true,
        introGate: true,
        longTermStats: true,
        aura: true,
        statsRetentionDays: 180,
    },
    [TIERS.TRIAL_PRO_PLUS]: {
        maxNgWords: 50,
        maxGuilds: 1,
        ngLog: true,
        vcLog: true,
        dashboard: true,
        activity: true,
        autoRelease: true,
        antiraid: true,
        spamProtection: true,
        audit: true,
        introGate: true,
        longTermStats: true,
        aura: true,
        statsRetentionDays: 7,
    },
    [TIERS.TRIAL_PRO]: {
        maxNgWords: 20,
        maxGuilds: 1,
        ngLog: true,
        vcLog: true,
        dashboard: true,
        activity: true,
        autoRelease: true,
        antiraid: true,
        spamProtection: true,
        audit: false,
        introGate: false,
        longTermStats: false,
        aura: true,
        statsRetentionDays: 7,
    },
    [TIERS.ULTIMATE]: {
        maxNgWords: 9999,
        maxGuilds: 10,
        ngLog: true,
        vcLog: true,
        dashboard: true,
        activity: true,
        autoRelease: true,
        antiraid: true,
        spamProtection: true,
        audit: true,
        introGate: true,
        longTermStats: true,
        aura: true,
        statsRetentionDays: 365,
    },
};

export function getFeatures(guildTier, guildId = null, userTier = null) {
    // Effective tier is the highest of guild tier or user's personal tier (Expert License)
    const effectiveTier = (userTier !== null && userTier > guildTier) ? userTier : guildTier;

    if (effectiveTier === TIERS.ULTIMATE) {
        return { ...FEATURES[TIERS.ULTIMATE], _milestone: 5 };
    }

    const baseFeatures = FEATURES[effectiveTier] || FEATURES[TIERS.FREE];
    const gated = { ...baseFeatures };

    // Milestone Gating Logic (Default to full access for now)
    gated._milestone = 5;

    return gated;
}
