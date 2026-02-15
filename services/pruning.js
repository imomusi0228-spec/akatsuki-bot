import { dbQuery } from "../core/db.js";

/**
 * データベースの古いレコードを削除する
 * @param {number} days 何日以上前のデータを削除するか (デフォルト30日)
 */
export async function runDataPruning(days = 30) {
    console.log(`🧹 [PRUNING] Starting data pruning (Older than ${days} days)...`);
    
    try {
        const interval = `${days} days`;
        
        // 1. 古いVCセッションの削除 (leave_time があるもののみ)
        const resVc = await dbQuery(
            "DELETE FROM vc_sessions WHERE leave_time < NOW() - $1::interval",
            [interval]
        );
        console.log(`   - Deleted ${resVc.rowCount} old VC sessions.`);

        // 2. 古いNGログの削除
        const resNg = await dbQuery(
            "DELETE FROM ng_logs WHERE created_at < NOW() - $1::interval",
            [interval]
        );
        console.log(`   - Deleted ${resNg.rowCount} old NG logs.`);

        // 3. 古いメンバーイベントの削除
        const resEvents = await dbQuery(
            "DELETE FROM member_events WHERE created_at < NOW() - $1::interval",
            [interval]
        );
        console.log(`   - Deleted ${resEvents.rowCount} old member events.`);

        console.log("✅ [PRUNING] Data pruning completed successfully.");
        return true;
    } catch (e) {
        console.error("❌ [PRUNING] Error during data pruning:", e.message);
        return false;
    }
}

// 直接実行された場合の処理
if (import.meta.url === `file://${process.argv[1]}`) {
    runDataPruning().then(() => process.exit(0));
}
