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
        feature_ng_limit: "NGワード登録数",
        feature_logs: "削除ログ保存",
        feature_dashboard: "Webダッシュボード",
        feature_activity: "アクティビティ監視",
        feature_csv: "CSVエクスポート",
        limit_10: "10個",
        limit_50: "50個",
        limit_100: "100個",
        available: "⚪︎",
        unavailable: "×",

        // Dashboard
        welcome: "ようこそ",
        summary: "サマリー",
        vc_joins: "VC参加頻度",
        leaves: "退出回数",
        timeouts: "タイムアウト実行",
        ng_detect: "検知回数",
        top_ng_users: "NG連発ランキング",
        recent_joins: "最近の参加者",

        // Settings
        ng_words: "NGワードの管理",
        ng_add_placeholder: "禁止したい言葉を入力...",
        ng_add_btn: "追加",
        autorole: "自動参加ロール",
        autorole_desc: "サーバーに参加した直後のメンバーに、自動で付与するロールを選択します。",
        log_channel: "通知・ログ送信用チャンネル",
        log_channel_desc: "NGワード検知などの通知を送る場所を指定します。コマンド `/setlog` でも設定可能です。",
        config_general: "基本構成",
        threshold_label: "警告しきい値 (回数)",
        timeout_label: "自動タイムアウト時間",
        save_success: "設定を保存しました",
        save: "設定を保存",

        // Activity
        activity_desc: "メンバーの最終活動日をスキャンします (Pro+限定機能)",
        scan_btn: "スキャン開始",
        last_vc: "最後のVC利用",
        last_msg: "最後の発言",
        days_ago: "{days}日前",

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
        feature_ng_limit: "NG Word Limit",
        feature_logs: "Deletion Logs",
        feature_dashboard: "Web Dashboard",
        feature_activity: "Activity Monitor",
        feature_csv: "CSV Export",
        limit_10: "10 Words",
        limit_50: "50 Words",
        limit_100: "100 Words",
        available: "Yes",
        unavailable: "No",

        // Dashboard
        welcome: "Welcome",
        summary: "Summary",
        vc_joins: "VC Joins",
        leaves: "Leaves",
        timeouts: "Timeouts",
        ng_detect: "NG Detections",
        top_ng_users: "Top NG Users",
        recent_joins: "Recent Joins",

        // Settings
        ng_words: "NG Words",
        ng_add_placeholder: "Enter word...",
        ng_add_btn: "Add",
        autorole: "Auto Role",
        autorole_desc: "Role ID assigned on join",
        log_channel: "Log Channel",
        save: "Save",

        // Activity
        activity_desc: "Check member inactivity (Pro+ Only)",
        scan_btn: "Scan Now",
        last_vc: "Last VC",
        last_msg: "Last Msg",
        days_ago: "{days}d ago",

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
