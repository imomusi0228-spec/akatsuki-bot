import { TIERS, TIER_NAMES } from './core/tiers.js';

console.log('TIERS:', TIERS);
console.log('TIER_NAMES keys:', Object.keys(TIER_NAMES));
console.log('Lookup 0:', TIER_NAMES[0]);
console.log('Lookup 1:', TIER_NAMES[1]);
console.log('Lookup "0":', TIER_NAMES['0']);
console.log('Lookup "1":', TIER_NAMES['1']);
