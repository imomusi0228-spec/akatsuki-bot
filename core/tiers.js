export const TIERS = {
    FREE: 0,
    PRO_MONTHLY: 1,
    PRO_YEARLY: 2,
    PRO_PLUS_MONTHLY: 3,
    PRO_PLUS_YEARLY: 4,
    TRIAL_PRO_PLUS: 5,
    TRIAL_PRO: 6
};

export const MILESTONES = {
    M1_PROTECTION: 1, // v1.1.1
    M2_DEFENSE: 2,    // v1.2.0
    M3_STRATEGY: 3,   // v1.2.1
    M4_GOVERNANCE: 4, // v1.3.0
    M5_ULTIMATE: 5    // Pro+ Full
};

export const TIER_NAMES = {
    [TIERS.FREE]: "Free",
    [TIERS.PRO_MONTHLY]: "Pro",
    [TIERS.PRO_YEARLY]: "Pro",
    [TIERS.PRO_PLUS_MONTHLY]: "Pro+",
    [TIERS.PRO_PLUS_YEARLY]: "Pro+",
    [TIERS.TRIAL_PRO_PLUS]: "Trial Pro+",
    [TIERS.TRIAL_PRO]: "Trial Pro"
};

export const FEATURES = {
    [TIERS.FREE]: {
        maxNgWords: 10,
        maxGuilds: 1,
        ngLog: false,
        vcLog: true,
        dashboard: false,
        activity: true, // Activity stats (basic)
        autoRelease: false,
        antiraid: true, // Alerts only
        spamProtection: false,
        audit: false,
        introGate: false,
        longTermStats: false
    },
    [TIERS.PRO_MONTHLY]: {
        maxNgWords: 20,
        maxGuilds: 1,
        ngLog: true,
        vcLog: true,
        dashboard: true,
        activity: true, // Limited to 7 days
        autoRelease: true,
        antiraid: true, // Full
        spamProtection: true,
        audit: false,
        introGate: false,
        longTermStats: false
    },
    [TIERS.PRO_YEARLY]: {
        maxNgWords: 20,
        maxGuilds: 1,
        ngLog: true,
        vcLog: true,
        dashboard: true,
        activity: true, // Limited to 7 days
        autoRelease: true,
        antiraid: true, // Full
        spamProtection: true,
        audit: false,
        introGate: false,
        longTermStats: false
    },
    [TIERS.PRO_PLUS_MONTHLY]: {
        maxNgWords: 50,
        maxGuilds: 3,
        ngLog: true,
        vcLog: true,
        dashboard: true,
        activity: true,
        autoRelease: true,
        antiraid: true,
        spamProtection: true,
        audit: true,
        introGate: true,
        longTermStats: true
    },
    [TIERS.PRO_PLUS_YEARLY]: {
        maxNgWords: 50,
        maxGuilds: 3,
        ngLog: true,
        vcLog: true,
        dashboard: true,
        activity: true,
        autoRelease: true,
        antiraid: true,
        spamProtection: true,
        audit: true,
        introGate: true,
        longTermStats: true
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
        longTermStats: true
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
        longTermStats: false
    }
};

export function getFeatures(tier, milestone = 5) {
    const baseFeatures = FEATURES[tier] || FEATURES[TIERS.FREE];

    // If milestone is 5 (Ultimate) or it's Pro+ with no gating needed for simplicity, 
    // but the user wants "Coming Soon", so we apply gating to all tiers if milestone < 5.

    const gated = { ...baseFeatures };

    // Milestone Gating Logic
    if (milestone < MILESTONES.M2_DEFENSE) {
        gated.antiraid = false;
        gated.self_intro = false;
        gated.mention_protection = false;
    }
    if (milestone < MILESTONES.M3_STRATEGY) {
        gated.activity_detailed = false;
        gated.trends = false;
    }
    if (milestone < MILESTONES.M4_GOVERNANCE) {
        gated.vc_report = false;
        gated.vc_auto_roles = false;
        gated.vc_context_menu = false;
    }

    // Add metadata for UI
    gated._milestone = milestone;

    return gated;
}
