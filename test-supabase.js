
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config()

const supabaseUrl = process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SECRET_KEY

console.log('--- Config ---');
console.log('URL:', supabaseUrl);
// console.log('Key:', supabaseKey); // Don't log secret

const supabase = createClient(supabaseUrl, supabaseKey)

async function testConnection() {
  console.log('Testing connection...');
  try {
    // リスト取得テスト（auth.users は管理権限が必要）
    // もしくは適当なテーブルアクセス
    const { data, error } = await supabase.from('settings').select('*').limit(1);
    
    if (error) {
        console.error('Error fetching settings:', error);
        // テーブルが存在しない場合のエラーもありうるので、接続自体は成功している可能性がある
        if (error.code === '42P01') { // undefined_table
            console.log('Connection successful, but table "settings" does not exist (expected).');
            return true;
        }
    } else {
        console.log('Connection successful. Data:', data);
    }
    
    // Auth admin check
    const { data: { users }, error: authError } = await supabase.auth.admin.listUsers()
    if (authError) {
        console.error('Auth admin error:', authError);
    } else {
        console.log('Auth admin success. User count:', users.length);
    }

  } catch (err) {
    console.error('Unexpected error:', err);
  }
}

testConnection();
