export const DICTIONARY = {
    ja: {
        // General
        title: "Akatsuki Bot",
        subtitle: "Discordサーバー管理の新しいスタンダード",
        login: "Discordでログイン",
        logout: "ログアウト",
        dashboard: "ダッシュボード",
        settings: "サーバー設定",
        activity: "アクティビティ",
        guide: "利用ガイド",
        language: "Language",
        view_features: "機能を見る",
        features_title: "機能とプラン",
        features_subtitle: "あなたのサーバーに最適なプランを選択してください",
        get_started: "今すぐ始める",

        // Plans
        plan_free: "Free",
        plan_pro: "Pro",
        plan_pro_plus: "Pro+",
        feature_max_guilds: "最大利用サーバー数",
        feature_ng_limit: "NGワード登録数",
        feature_logs: "削除ログ保存",
        feature_dashboard: "Webダッシュボード",
        feature_activity: "アクティビティ監視",
        feature_csv: "CSVエクスポート",
        limit_10: "5個",
        limit_50: "20個",
        limit_100: "50個",
        available: "⚪︎",
        unavailable: "×",
        plan_free_desc: "ボットの基本機能を無料で体験できます。小規模なサーバーや、導入テストを行う管理者に最適です。",
        plan_pro_desc: "大規模なサーバー運営に欠かせないログ保存機能や、より強力なNGワードフィルタリングを解放します。効率的な運営を求める管理者へ。",
        plan_pro_plus_desc: "Akatsuki Botの全機能を解放する最上位プランです。活動監査、CSV出力、最大3サーバーへの適用が可能。究極の統治を実現する、すべてのサーバー管理者に捧げます。",
        features_detail_security: "NGワードの自動削除と警告しきい値による自動タイムアウトで、サーバーの平和を鉄壁に守ります。",
        features_detail_audit: "ロールの所持、自己紹介の有無、VCの参加状況を統合し、幽霊部員を瞬時に特定します。",
        features_detail_log: "サーバー内で起きた重要なイベントを専用チャンネルに記録。何かあった時の追跡も容易です。",

        // Dashboard
        welcome: "ようこそ",
        summary: "サマリー",
        vc_joins: "VC参加頻度",
        leaves: "退出回数",
        timeouts: "タイムアウト実行",
        top_ng_users: "NG連発ランキング",
        recent_joins: "最近の参加者",
        quick_comparison: "プラン機能比較表",

        // Settings
        ng_words: "NGワードの管理",
        ng_add_placeholder: "禁止したい言葉を入力...",
        ng_add_btn: "追加",
        audit_role: "監査基準ロール",
        audit_role_desc: "サーバーの「正会員」として認めるロールを選択します。監査画面で所持状況を確認できます。",
        intro_channel: "自己紹介チャンネル",
        intro_channel_desc: "新規メンバーが自己紹介を書くべきチャンネルを指定します。",
        log_channel: "通知・ログ送信用チャンネル",
        log_channel_desc: "NGワード検知などの通知を送る場所を指定します。コマンド `/setlog` でも設定可能です。",
        config_general: "基本構成",
        threshold_label: "警告しきい値 (回数)",
        timeout_label: "自動タイムアウト時間",
        save_success: "設定を保存しました",
        save: "設定を保存",

        // Activity / Audit
        activity_desc: "ロール所持・自己紹介・VC活動の3点からメンバーの状態を監査します (Pro+限定)",
        scan_btn: "監査実行",
        last_vc: "最終VC利用",
        last_msg: "自己紹介",
        audit_status: "監査ステータス",
        days_ago: "{days}日前",
        has_intro: "済み",
        no_intro: "未記入",
        has_role: "保持",
        no_role: "未保持",

        // Errors / Notices
        upgrade_required: "プランのアップグレードが必要です",
        login_required: "ログインしてください",
    },
    en: {
        // General
        title: "Akatsuki Bot",
        subtitle: "The New Standard for Discord Management",
        login: "Login with Discord",
        logout: "Logout",
        dashboard: "Dashboard",
        settings: "Settings",
        activity: "Activity",
        guide: "Guide",
        language: "言語",
        view_features: "View Features",
        features_title: "Features & Pricing",
        features_subtitle: "Choose the perfect plan for your server",
        get_started: "Get Started",

        // Plans
        plan_free: "Free",
        plan_pro: "Pro",
        plan_pro_plus: "Pro+",
        feature_max_guilds: "Max Servers",
        feature_ng_limit: "NG Word Limit",
        feature_logs: "Deletion Logs",
        feature_dashboard: "Web Dashboard",
        feature_activity: "Activity Monitor",
        feature_csv: "CSV Export",
        limit_10: "5 Words",
        limit_50: "20 Words",
        limit_100: "50 Words",
        available: "Yes",
        unavailable: "No",
        plan_free_desc: "Experience the core features for free. Perfect for small servers or testing the waters.",
        plan_pro_desc: "Unlocks essential logging and stronger NG filtering. Best for servers seeking operational efficiency.",
        plan_pro_plus_desc: "The ultimate tier unlocking all features, including Activity Audit, CSV Export, and up to 3 servers. For the most demanding administrators.",
        features_detail_security: "Auto-delete messages and set warning thresholds to keep your server safe and orderly.",
        features_detail_audit: "Audit members based on roles, introductions, and VC activity to identify inactive members instantly.",
        features_detail_log: "Records important server events to a dedicated channel for easy tracking and moderation.",

        // Dashboard
        welcome: "Welcome",
        summary: "Summary",
        vc_joins: "VC Joins",
        leaves: "Leaves",
        timeouts: "Timeouts",
        ng_detect: "NG Detections",
        top_ng_users: "Top NG Users",
        recent_joins: "最近の参加者",
        quick_comparison: "プラン機能比較表",

        // Settings
        ng_words: "NG Words",
        ng_add_placeholder: "Enter word...",
        ng_add_btn: "Add",
        audit_role: "Audit Base Role",
        audit_role_desc: "Role to consider as a 'Proper Member'",
        intro_channel: "Intro Channel",
        intro_channel_desc: "Channel where members post introductions",
        log_channel: "Log Channel",
        save: "Save",

        // Activity / Audit
        activity_desc: "Audit members based on Roles, Intro, and VC Activity (Pro+ Only)",
        scan_btn: "Start Audit",
        last_vc: "Last VC",
        last_msg: "Intro",
        audit_status: "Audit Status",
        days_ago: "{days}d ago",
        has_intro: "Done",
        no_intro: "Missing",
        has_role: "Yes",
        no_role: "No",

        // Errors / Notices
        upgrade_required: "Plan Upgrade Required",
        login_required: "Please Login",
    }
};

export function t(key, lang = 'ja', params = {}) {
    const dict = DICTIONARY[lang] || DICTIONARY['ja'];
    let text = dict[key] || key;

    // Simple param replacement {days}
    Object.keys(params).forEach(p => {
        text = text.replace(`{${p}}`, params[p]);
    });

    return text;
}
