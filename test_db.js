import { dbQuery } from './core/db.js';
import { TIERS } from './core/tiers.js';

async function check() {
    console.log('--- ALL ULTIMATE Subscriptions ---');
    const res = await dbQuery('SELECT * FROM subscriptions WHERE tier = 999');
    console.log(JSON.stringify(res.rows, null, 2));
    process.exit(0);
}
check().catch(console.error);
