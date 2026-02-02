
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;
const connectionString = process.env.DATABASE_URL;

console.log('--- Config ---');
// パスワードを隠して表示
console.log('ConnectionString:', connectionString.replace(/:([^:@]+)@/, ':***@'));

const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false }, // Supabase用
    connectionTimeoutMillis: 5000,
});

async function testConnection() {
    console.log('Connecting to PostgreSQL...');
    let client;
    try {
        client = await pool.connect();
        console.log('✅ Connected successfully!');

        const res = await client.query('SELECT NOW() as now');
        console.log('Server Time:', res.rows[0].now);

        // テーブル一覧取得テスト
        const resTables = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `);
        console.log('Tables:', resTables.rows.map(r => r.table_name));

    } catch (err) {
        console.error('❌ Connection failed:', err);
    } finally {
        if (client) client.release();
        await pool.end();
    }
}

testConnection();
