import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";

export const data = new SlashCommandBuilder()
  .setName("ngword")
  .setDescription("不適切ワードの管理")
  .addSubcommand((s) =>
    s
      .setName("add")
      .setDescription("NGワードを追加")
      .addStringOption((o) =>
        o.setName("word").setDescription("追加するワード").setRequired(true)
      )
  )
  .addSubcommand((s) =>
    s
      .setName("remove")
      .setDescription("NGワードを削除")
      .addStringOption((o) =>
        o.setName("word").setDescription("削除するワード").setRequired(true)
      )
  )
  .addSubcommand((s) => s.setName("list").setDescription("NGワード一覧"))
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction, db) {
  // まず3秒以内に受付を返す（これが「応答しない」対策の本体）
  await interaction.deferReply({ ephemeral: true });

  try {
    // テーブル作成（無ければ）
    await db.exec(`
      CREATE TABLE IF NOT EXISTS ng_words (
        guild_id TEXT,
        word TEXT,
        PRIMARY KEY (guild_id, word)
      );
    `);

    const sub = interaction.options.getSubcommand();

    if (sub === "add") {
      const word = interaction.options.getString("word", true).trim();
      if (!word) {
        return interaction.editReply("❌ ワードが空です");
      }

      await db.run(
        `INSERT OR IGNORE INTO ng_words (guild_id, word) VALUES (?, ?)`,
        interaction.guildId,
        word
      );
      return interaction.editReply(`✅ 追加しました: ${word}`);
    }

    if (sub === "remove") {
      const word = interaction.options.getString("word", true).trim();
      await db.run(
        `DELETE FROM ng_words WHERE guild_id = ? AND word = ?`,
        interaction.guildId,
        word
      );
      return interaction.editReply(`✅ 削除しました: ${word}`);
    }

    if (sub === "list") {
      const rows = await db.all(
        `SELECT word FROM ng_words WHERE guild_id = ? ORDER BY word ASC`,
        interaction.guildId
      );
      const text = rows.length ? rows.map((r) => `・${r.word}`).join("\n") : "（なし）";
      return interaction.editReply(`📄 NGワード一覧\n${text}`);
    }

    return interaction.editReply("❌ 未対応のサブコマンドです");
  } catch (e) {
    console.error(e);
    return interaction.editReply(`❌ エラー: ${e?.message ?? e}`);
  }
}
