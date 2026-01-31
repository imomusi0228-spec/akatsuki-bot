// commands/ngword.js
import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";

function isUnknownInteraction(err) {
  return err?.code === 10062 || err?.rawError?.code === 10062;
}

export const data = new SlashCommandBuilder()
  .setName("ngword")
  .setDescription("NGワード管理")
  .addSubcommand((s) =>
    s
      .setName("add")
      .setDescription("NGワードを追加")
      .addStringOption((o) =>
        o
          .setName("word")
          .setDescription("追加するワード（例: ばか / /ばか|あほ/i）")
          .setRequired(true)
      )
  )
  .addSubcommand((s) =>
    s
      .setName("remove")
      .setDescription("NGワードを削除")
      .addStringOption((o) =>
        o
          .setName("word")
          .setDescription("削除するワード（登録形式のまま）")
          .setRequired(true)
      )
  )
  .addSubcommand((s) => s.setName("clear").setDescription("NGワードを全削除（管理者のみ）"))
  .addSubcommand((s) => s.setName("list").setDescription("NGワード一覧（管理者のみ）"))
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

function isAdminLike(interaction) {
  const p = interaction.memberPermissions;
  return (
    p?.has(PermissionFlagsBits.Administrator) ||
    p?.has(PermissionFlagsBits.ManageGuild)
  );
}

function parseNgInput(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return null;

  if (s.startsWith("/") && s.lastIndexOf("/") > 0) {
    const last = s.lastIndexOf("/");
    const pattern = s.slice(1, last);
    const flags = s.slice(last + 1) || "i";
    if (!pattern.trim()) return null;
    if (!/^[dgimsuvy]*$/.test(flags)) return null;
    try { new RegExp(pattern, flags); } catch { return null; }
    return { kind: "regex", word: pattern, flags };
  }

  return { kind: "literal", word: s, flags: "i" };
}

async function dbAdd(db, guildId, wordRaw) {
  const parsed = parseNgInput(wordRaw);
  if (!parsed) return { ok: false, error: "invalid_input" };

  await db.run(
    `INSERT OR IGNORE INTO ng_words (guild_id, kind, word, flags)
     VALUES (?, ?, ?, ?)`,
    guildId,
    parsed.kind,
    parsed.word,
    parsed.flags || "i"
  );
  return { ok: true, added: parsed };
}

async function dbRemove(db, guildId, wordRaw) {
  const parsed = parseNgInput(wordRaw);
  if (!parsed) return { ok: false, error: "invalid_input" };

  const r = await db.run(
    `DELETE FROM ng_words
     WHERE guild_id = ? AND kind = ? AND word = ?`,
    guildId,
    parsed.kind,
    parsed.word
  );
  return { ok: true, deleted: r?.changes ?? 0, target: parsed };
}

async function dbClear(db, guildId) {
  await db.run(`DELETE FROM ng_words WHERE guild_id = ?`, guildId);
  return { ok: true };
}

async function dbList(db, guildId) {
  const rows = await db.all(
    `SELECT kind, word, flags
       FROM ng_words
      WHERE guild_id = ?
      ORDER BY kind ASC, word ASC`,
    guildId
  );

  const words = (rows || [])
    .map((r) => {
      const kind = (r.kind || "literal").trim();
      const w = (r.word || "").trim();
      const flags = (r.flags || "i").trim();
      if (!w) return null;
      return kind === "regex" ? `/${w}/${flags}` : w;
    })
    .filter(Boolean);

  return { ok: true, words };
}

export async function execute(interaction, db) {
  // ✅ これがないと「応答しませんでした」が出る
  try {
    await interaction.deferReply({ ephemeral: true });
  } catch (e) {
    if (isUnknownInteraction(e)) return;
    throw e;
  }

  const sendPublic = interaction.publicSend
    ? interaction.publicSend.bind(interaction)
    : async (payload) => interaction.channel?.send(payload).catch(() => null);

  const finish = async (msg) => {
    // 返信UIは残さない（必要なら消す）
    try {
      await interaction.editReply(msg);
      setTimeout(() => interaction.deleteReply().catch(() => {}), 1500);
    } catch {}
  };

  try {
    if (!interaction.guildId) {
      await finish("❌ サーバー内で実行してください。");
      return;
    }
    if (!db) {
      await finish("❌ DBが初期化できていません（Renderログ確認）");
      return;
    }

    const sub = interaction.options.getSubcommand();

    // list/clear は管理者のみ（念のため二重チェック）
    if ((sub === "list" || sub === "clear") && !isAdminLike(interaction)) {
      await finish("❌ 管理者権限（ManageGuild/Administrator）が必要です。");
      return;
    }

    if (sub === "add") {
      const word = interaction.options.getString("word", true).trim();
      const r = await dbAdd(db, interaction.guildId, word);
      if (!r.ok) {
        await finish("❌ 形式が不正です。例: ばか / /ばか|あほ/i");
        return;
      }
      const shown = r.added.kind === "regex"
        ? `/${r.added.word}/${r.added.flags}`
        : r.added.word;

      // いつものチャンネルに出したいならこっち
      await sendPublic({ content: `✅ 追加しました：\`${shown}\`` });
      await finish("OK");
      return;
    }

    if (sub === "remove") {
      const word = interaction.options.getString("word", true).trim();
      const r = await dbRemove(db, interaction.guildId, word);
      if (!r.ok) {
        await finish("❌ 形式が不正です。登録した形式のまま指定してください。");
        return;
      }
      if ((r.deleted ?? 0) <= 0) {
        await sendPublic({ content: "⚠️ 見つかりませんでした（登録した形式のまま指定してください）" });
        await finish("OK");
        return;
      }
      const shown = r.target.kind === "regex"
        ? `/${r.target.word}/${r.target.flags}`
        : r.target.word;

      await sendPublic({ content: `✅ 削除しました：\`${shown}\`` });
      await finish("OK");
      return;
    }

    if (sub === "clear") {
      await dbClear(db, interaction.guildId);
      await sendPublic({ content: "✅ NGワードを全削除しました。" });
      await finish("OK");
      return;
    }

    if (sub === "list") {
      const r = await dbList(db, interaction.guildId);
      const words = r.words || [];
      if (!words.length) {
        await sendPublic({ content: "（空）NGワードは登録されていません。" });
        await finish("OK");
        return;
      }
      const body = words.map((w) => `- ${w}`).join("\n");
      await sendPublic({ content: `📌 NGワード一覧（${words.length}件）\n${body}` });
      await finish("OK");
      return;
    }

    await finish("❌ 不明なサブコマンドです。");
  } catch (e) {
    console.error("ngword command error:", e);
    await finish(`❌ エラー: ${e?.message ?? String(e)}`);
  }
}
