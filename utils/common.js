export function isTierAtLeast(currentTier, requiredTier) {
    const levels = { "free": 0, "pro": 1, "pro_plus": 2 };
    const c = levels[currentTier] ?? 0;
    const r = levels[requiredTier] ?? 0;
    return c >= r;
}
