[1mdiff --git a/commands/vc.js b/commands/vc.js[m
[1mindex 4726733..8db87de 100644[m
[1m--- a/commands/vc.js[m
[1m+++ b/commands/vc.js[m
[36m@@ -5,15 +5,13 @@[m [mimport {[m
   EmbedBuilder,[m
 } from "discord.js";[m
 [m
[31m-const TIMEZONE = "Asia/Tokyo";[m
[31m-[m
 function isUnknownInteraction(err) {[m
   return err?.code === 10062 || err?.rawError?.code === 10062;[m
 }[m
 [m
[31m-function monthKeyTokyo(date = new Date()) {[m
[32m+[m[32mfunction ymTokyo(date = new Date()) {[m
   const dtf = new Intl.DateTimeFormat("sv-SE", {[m
[31m-    timeZone: TIMEZONE,[m
[32m+[m[32m    timeZone: "Asia/Tokyo",[m
     year: "numeric",[m
     month: "2-digit",[m
   });[m
[36m@@ -30,14 +28,6 @@[m [mfunction msToHuman(ms) {[m
   return `${ss}秒`;[m
 }[m
 [m
[31m-function safeJsonParse(str) {[m
[31m-  try {[m
[31m-    return JSON.parse(str);[m
[31m-  } catch {[m
[31m-    return null;[m
[31m-  }[m
[31m-}[m
[31m-[m
 export const data = new SlashCommandBuilder()[m
   .setName("vc")[m
   .setDescription("VCログ/統計")[m
[36m@@ -45,7 +35,7 @@[m [mexport const data = new SlashCommandBuilder()[m
   .addSubcommand((sub) =>[m
     sub[m
       .setName("recent")[m
[31m-      .setDescription("直近のVCログを表示")[m
[32m+[m[32m      .setDescription("直近のVCログを表示（log_events から）")[m
       .addIntegerOption((opt) =>[m
         opt[m
           .setName("limit")[m
[36m@@ -55,7 +45,9 @@[m [mexport const data = new SlashCommandBuilder()[m
       )[m
   )[m
   .addSubcommand((sub) =>[m
[31m-    sub.setName("top").setDescription("今月のVC滞在時間Topを表示（上位10）")[m
[32m+[m[32m    sub[m
[32m+[m[32m      .setName("top")[m
[32m+[m[32m      .setDescription("今月のVC滞在時間Topを表示（上位10）")[m
   )[m
   .addSubcommand((sub) =>[m
     sub[m
[36m@@ -89,7 +81,6 @@[m [mexport async function execute(interaction, db) {[m
     if (sub === "recent") {[m
       const limit = interaction.options.getInteger("limit") ?? 10;[m
 [m
[31m-      // index.js の log_events にVCイベントが入ってる前提[m
       const rows = await db.all([m
         `SELECT type, user_id, meta, ts[m
            FROM log_events[m
[36m@@ -106,25 +97,22 @@[m [mexport async function execute(interaction, db) {[m
       }[m
 [m
       const lines = rows.map((r) => {[m
[31m-        const t = `<t:${Math.floor(r.ts / 1000)}:R>`;[m
[31m-        const meta = safeJsonParse(r.meta) || {};[m
[32m+[m[32m        const t = `<t:${Math.floor(Number(r.ts) / 1000)}:R>`;[m
[32m+[m[32m        let meta = null;[m
[32m+[m[32m        try { meta = r.meta ? JSON.parse(r.meta) : null; } catch { meta = null; }[m
 [m
         if (r.type === "vc_join") {[m
[31m-          const vcName = meta.channelName || (meta.channelId ? `#${meta.channelId}` : "?");[m
[31m-          return `${t} 🟦 IN  <@${r.user_id}> → **${vcName}**`;[m
[32m+[m[32m          const name = meta?.channelName || meta?.channelId || "?";[m
[32m+[m[32m          return `${t} 🟦 IN  <@${r.user_id}> → **${name}**`;[m
         }[m
[31m-[m
[31m-        if (r.type === "vc_move_merged") {[m
[31m-          const route = meta.route || "?";[m
[31m-          return `${t} 🔁 MOVE <@${r.user_id}> **${route}**`;[m
[32m+[m[32m        if (r.type === "vc_session_end") {[m
[32m+[m[32m          const name = meta?.channelName || meta?.channelId || "?";[m
[32m+[m[32m          const dur = meta?.durationMs != null ? `（${msToHuman(meta.durationMs)}）` : "";[m
[32m+[m[32m          return `${t} 🟦 OUT <@${r.user_id}> ← **${name}** ${dur}`;[m
         }[m
[31m-[m
[31m-        // vc_session_end[m
[31m-        const vcName =[m
[31m-          meta.channelName ||[m
[31m-          (meta.channelId ? `#${meta.channelId}` : "?");[m
[31m-        const dur = meta.durationMs != null ? `（${msToHuman(meta.durationMs)}）` : "";[m
[31m-        return `${t} 🟦 OUT <@${r.user_id}> ← **${vcName}** ${dur}`;[m
[32m+[m[32m        // vc_move_merged[m
[32m+[m[32m        const route = meta?.route || "?";[m
[32m+[m[32m        return `${t} 🔁 MOVE <@${r.user_id}> **${route}**`;[m
       });[m
 [m
       const embed = new EmbedBuilder()[m
[36m@@ -138,10 +126,10 @@[m [mexport async function execute(interaction, db) {[m
 [m
     // /vc top[m
     if (sub === "top") {[m
[31m-      const ym = monthKeyTokyo();[m
[32m+[m[32m      const ym = ymTokyo();[m
 [m
       const rows = await db.all([m
[31m-        `SELECT user_id, total_ms[m
[32m+[m[32m        `SELECT user_id, total_ms, joins[m
            FROM vc_stats_month[m
           WHERE guild_id = ? AND month_key = ?[m
           ORDER BY total_ms DESC[m
[36m@@ -155,7 +143,8 @@[m [mexport async function execute(interaction, db) {[m
       }[m
 [m
       const lines = rows.map([m
[31m-        (r, i) => `**${i + 1}.** <@${r.user_id}>  —  ${msToHuman(Number(r.total_ms ?? 0))}`[m
[32m+[m[32m        (r, i) =>[m
[32m+[m[32m          `**${i + 1}.** <@${r.user_id}>  —  ${msToHuman(Number(r.total_ms ?? 0))}（${r.joins ?? 0}回）`[m
       );[m
 [m
       const embed = new EmbedBuilder()[m
[36m@@ -170,33 +159,36 @@[m [mexport async function execute(interaction, db) {[m
     // /vc user[m
     if (sub === "user") {[m
       const user = interaction.options.getUser("target", true);[m
[31m-      const ym = monthKeyTokyo();[m
[32m+[m[32m      const ym = ymTokyo();[m
 [m
       const m = await db.get([m
[31m-        `SELECT joins, total_ms[m
[32m+[m[32m        `SELECT total_ms, joins[m
            FROM vc_stats_month[m
[31m-          WHERE guild_id = ? AND month_key = ? AND user_id = ?`,[m
[32m+[m[32m          WHERE guild_id = ? AND user_id = ? AND month_key = ?`,[m
         guildId,[m
[31m-        ym,[m
[31m-        user.id[m
[32m+[m[32m        user.id,[m
[32m+[m[32m        ym[m
       );[m
 [m
       const t = await db.get([m
[31m-        `SELECT joins, total_ms[m
[32m+[m[32m        `SELECT total_ms, joins[m
            FROM vc_stats_total[m
           WHERE guild_id = ? AND user_id = ?`,[m
         guildId,[m
         user.id[m
       );[m
 [m
[32m+[m[32m      const thisMonthMs = Number(m?.total_ms ?? 0);[m
[32m+[m[32m      const thisMonthJoins = Number(m?.joins ?? 0);[m
[32m+[m[32m      const totalMs = Number(t?.total_ms ?? 0);[m
[32m+[m[32m      const totalJoins = Number(t?.joins ?? 0);[m
[32m+[m
       const embed = new EmbedBuilder()[m
         .setTitle(`👤 VC統計：${user.tag}`)[m
         .setColor(0x3498db)[m
         .addFields([m
[31m-          { name: `今月（${ym}）参加回数`, value: `${Number(m?.joins ?? 0)}回`, inline: true },[m
[31m-          { name: `今月（${ym}）合計`, value: msToHuman(Number(m?.total_ms ?? 0)), inline: true },[m
[31m-          { name: "累計 参加回数", value: `${Number(t?.joins ?? 0)}回`, inline: true },[m
[31m-          { name: "累計 合計", value: msToHuman(Number(t?.total_ms ?? 0)), inline: true }[m
[32m+[m[32m          { name: `今月（${ym}）`, value: `${msToHuman(thisMonthMs)} / ${thisMonthJoins}回`, inline: true },[m
[32m+[m[32m          { name: "累計", value: `${msToHuman(totalMs)} / ${totalJoins}回`, inline: true }[m
         )[m
         .setTimestamp(new Date());[m
 [m
