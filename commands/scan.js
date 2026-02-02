import { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } from "discord.js";
import { isTierAtLeast } from "../utils/common.js";

export const data = new SlashCommandBuilder()
  .setName("scan")
  .setDescription("ログチャンネルから過去データをスキャンして取り込みます")
  .addSubcommand((s) => s.setName("logs").setDescription("スレッドを探索してDBに取り込む"))
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

/* 
  Parsers for current log formats
  
  [VC IN]
  content: **Display** (@Username) が <#123> に入室しました
  
  [VC OUT]
  content: **Display** (@Username) が <#123> から退出しました (滞在: 1時間3分40秒)

  [VC MOVE]
  content: **Display** (@Username) が <#123> から <#456> に移動しました (滞在: 10分5秒)

  [NG DETECTED]
  embed author: name=Username, iconURL=...
  fields: Matched, ID(uid・time), Content
*/

function parseDuration(str) {
  // (滞在: 1時間3分40秒) -> ms
  if (!str) return 0;
  let ms = 0;
  const h = str.match(/(\d+)時間/);
  const m = str.match(/(\d+)分/);
  const s = str.match(/(\d+)秒/);
  if (h) ms += parseInt(h[1]) * 3600000;
  if (m) ms += parseInt(m[1]) * 60000;
  if (s) ms += parseInt(s[1]) * 1000;
  return ms;
}

function parseUserFromContent(content) {
  // **Display** (@Username) ...
  const m = content.match(/\(@(.+?)\)/); // match inside (@...)
  return m ? m[1] : null;
}

// Helper to look up ID by username (best effort)
async function findUserIdByName(guild, username) {
  if (!username) return null;
  // Try cache first
  const found = guild.members.cache.find(m => m.user.username === username);
  if (found) return found.id;

  // Fetch (expensive for all users, but maybe necessary)
  try {
    const res = await guild.searchMembers({ query: username, limit: 1 });
    if (res.size > 0) return res.first().id;
  } catch { }
  return null;
}

export async function execute(interaction, db) {
  if (!db) return interaction.reply({ content: "❌ データベースに接続できていません。", flags: MessageFlags.Ephemeral });

  // Check Tier: Pro+ required
  const tier = interaction.userTier || "free";
  if (!isTierAtLeast(tier, "pro_plus")) {
    return interaction.reply({ content: "🔒 この機能は **Pro+プラン** 以上で利用可能です。", flags: MessageFlags.Ephemeral });
  }

  await interaction.deferReply();
  const guild = interaction.guild;

  try {
    // 1. Get Log Channel
    const setting = await db.get("SELECT log_channel_id FROM settings WHERE guild_id=$1", guild.id);
    const logChId = setting?.log_channel_id;
    if (!logChId) {
      return interaction.editReply("❌ ログチャンネルが設定されていません (/setlog)");
    }

    const logCh = guild.channels.cache.get(logChId) || await guild.channels.fetch(logChId).catch(() => null);
    if (!logCh) {
      return interaction.editReply("❌ ログチャンネルが見つかりません");
    }

    await interaction.editReply(`🔄 スキャンを開始します... (Target: ${logCh.name})`);

    // 2. Scan Threads
    // We need Active and Archived threads
    const threads = [];

    // Active
    const active = await logCh.threads.fetchActive();
    threads.push(...active.threads.values());

    // Archived
    const archived = await logCh.threads.fetchArchived({ limit: 100 }); // limit?
    threads.push(...archived.threads.values());

    let count = 0;
    let skipped = 0;

    for (const th of threads) {
      // Filter by name? "log-202..." or "ng_log-202..."
      // Basic check
      // Filter by name (Relaxed)
      // Threads: "VC IN ...", "VC OUT ...", "NGワード ...", "SETTINGS ...", "LOG ..."
      const n = th.name;
      const isLogThread =
        n.startsWith("VC") ||
        n.startsWith("NG") ||
        n.startsWith("LO") ||
        n.startsWith("SE") ||
        n.includes("log");

      if (!isLogThread) continue;

      let lastId = null;
      while (true) {
        const msgs = await th.messages.fetch({ limit: 100, before: lastId });
        if (msgs.size === 0) break;

        for (const m of msgs.values()) {
          lastId = m.id;
          if (m.author.id !== interaction.client.user.id) continue; // Only bot msgs

          const ts = m.createdTimestamp;

          const exists = await db.get(
            "SELECT id FROM log_events WHERE guild_id=$1 AND ts=$2",
            guild.id, ts
          );
          if (exists) {
            skipped++;
            continue;
          }

          // --- Parse VC ---
          const content = m.content || "";

          if (content.includes("入室しました")) {
            const username = parseUserFromContent(content);
            const uid = await findUserIdByName(guild, username);
            if (uid) {
              await db.run(
                "INSERT INTO log_events (guild_id, type, user_id, ts, meta) VALUES ($1, 'vc_in', $2, $3, $4)",
                guild.id, uid, ts, JSON.stringify({ message_id: m.id })
              );
              count++;
            }
          } else if (content.includes("退出しました")) {
            const username = parseUserFromContent(content);
            const durMs = parseDuration(content);
            const uid = await findUserIdByName(guild, username);
            if (uid) {
              await db.run(
                "INSERT INTO log_events (guild_id, type, user_id, ts, duration_ms, meta) VALUES ($1, 'vc_out', $2, $3, $4, $5)",
                guild.id, uid, ts, durMs, JSON.stringify({ message_id: m.id })
              );
              count++;
            }
          } else if (content.includes("移動しました")) {
            const username = parseUserFromContent(content);
            const durMs = parseDuration(content);
            const uid = await findUserIdByName(guild, username);
            if (uid) {
              await db.run(
                "INSERT INTO log_events (guild_id, type, user_id, ts, duration_ms, meta) VALUES ($1, 'vc_move', $2, $3, $4, $5)",
                guild.id, uid, ts, durMs, JSON.stringify({ message_id: m.id })
              );
              count++;
            }
          }

          // --- Parse NG ---
          if (m.embeds.length > 0) {
            const emb = m.embeds[0];
            if (emb.description?.includes("NG word detected")) {
              const idField = emb.fields.find(f => f.name === "ID");
              let uid = null;
              if (idField) {
                uid = idField.value.split("・")[0];
              }
              const matchedField = emb.fields.find(f => f.name === "Matched");
              const matched = matchedField ? matchedField.value : "";

              if (uid) {
                await db.run(
                  "INSERT INTO log_events (guild_id, type, user_id, ts, meta) VALUES ($1, 'ng_detected', $2, $3, $4)",
                  guild.id, uid, ts, JSON.stringify({ message_id: m.id, matched: matched })
                );
                await db.run(
                  `INSERT INTO ng_hits (guild_id, user_id, count, updated_at) 
                   VALUES ($1, $2, 1, $3)
                   ON CONFLICT (guild_id, user_id) 
                   DO UPDATE SET count = count + 1, updated_at = $3`,
                  guild.id, uid, ts
                );
                count++;
              }
            } else if (emb.description?.includes("timeout applied")) {
              const idField = emb.fields.find(f => f.name === "ID");
              let uid = null;
              if (idField) uid = idField.value.split("・")[0];

              if (uid) {
                await db.run(
                  "INSERT INTO log_events (guild_id, type, user_id, ts, meta) VALUES ($1, 'timeout_applied', $2, $3, $4)",
                  guild.id, uid, ts, JSON.stringify({ message_id: m.id })
                );
                count++;
              }
            }
          }
        }
      }
    }

    await interaction.editReply(`✅ スキャン完了: ${count} 件インポート (スキップ: ${skipped} 件)`);

  } catch (e) {
    console.error(e);
    await interaction.editReply(`❌ エラー: ${e.message}`);
  }
}
