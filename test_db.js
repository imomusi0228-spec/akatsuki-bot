import { dbQuery } from './core/db.js';
import { TIERS } from './core/tiers.js';

async function check() {
    console.log('--- Shino Subscription ---');
    const res = await dbQuery("SELECT * FROM subscriptions WHERE user_id = '341304244801053902'");
    console.log(JSON.stringify(res.rows, null, 2));

    console.log('--- ALL ULTIMATE Subscriptions ---');
    const res2 = await dbQuery('SELECT * FROM subscriptions WHERE tier = 999');
    console.log(JSON.stringify(res2.rows, null, 2));
    process.exit(0);
}
check().catch(console.error);
