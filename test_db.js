import { dbQuery } from './core/db.js';
import { TIERS } from './core/tiers.js';

async function check() {
    const userId = '341304244801053902';
    console.log('--- Subscriptions for User: ' + userId + ' ---');
    const res = await dbQuery('SELECT * FROM subscriptions WHERE TRIM(user_id) = $1', [userId]);
    console.log(JSON.stringify(res.rows, null, 2));
    
    console.log('\n--- Effective Tier Check ---');
    const res2 = await dbQuery(
        "SELECT tier FROM subscriptions WHERE TRIM(user_id) = $1 AND (valid_until IS NULL OR valid_until > NOW()) ORDER BY tier DESC LIMIT 1",
        [userId]
    );
    console.log('Result:', JSON.stringify(res2.rows, null, 2));
    process.exit(0);
}
check().catch(console.error);
