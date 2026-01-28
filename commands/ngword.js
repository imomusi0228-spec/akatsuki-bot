import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from "discord.js";

export const data = new SlashCommandBuilder()
  .setName("ngword")
  .setDescription("NGワードを管理します")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand((sub) =>
    sub
      .setName("add")
      .setDescription("NGワードを追加")
      .addStringOption((opt) =>
        opt.setName("word").setDescription("追加するワード").setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("remove")
      .setDescription("NGワードを削除")
      .addStringOption((opt) =>
        opt.setName("word").setDescription("削除するワード").setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub.setName("list").setDescription("NGワード一覧を表示（管理者だけ）")
  )
  .addSubcommand((sub) =>
    sub.setName("clear").setDescription("NGワードを全削除（注意）")
  );

function isUnknownInteraction(err) {
  return err?.code === 10062 || err?.rawError?.code === 10062;
}

export async function execute(interaction, db) {
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  } catch (e) {
    if (isUnknownInteraction(e)) return;
    throw e;
  }

  try {
    if (!interaction.guildId) {
      return await interaction.editReply("❌ サーバー内で実行してください。");
    }
    if (!db) {
      return await interaction.editReply("❌ DBが初期化できていません（Renderログ確認）");
    }

    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;

    if (sub === "add") {
      const word = interaction.options.getString("word", true).trim();
      if (!word) return await interaction.editReply("❌ ワードが空です。");

      await db.run(
        `INSERT OR IGNORE INTO ng_words (guild_id, word) VALUES (?, ?)`,
        guildId,
        word
      );
      return await interaction.editReply(`✅ 追加しました：\`${word}\``);
    }

    if (sub === "remove") {
      const word = interaction.options.getString("word", true).trim();
      await db.run(
        `DELETE FROM ng_words WHERE guild_id = ? AND word = ?`,
        guildId,
        word
      );
      return await interaction.editReply(`✅ 削除しました：\`${word}\``);
    }

    if (sub === "clear") {
      await db.run(`DELETE FROM ng_words WHERE guild_id = ?`, guildId);
      return await interaction.editReply("✅ NGワードを全削除しました。");
    }

    // list
    const rows = await db.all(
      `SELECT word FROM ng_words WHERE guild_id = ? ORDER BY word ASC`,
      guildId
    );
    if (!rows.length) {
      return await interaction.editReply("（空）NGワードは登録されていません。");
    }

    const words = rows.map((r) => r.word).filter(Boolean);

    // Discordの文字数制限対策：長すぎる場合は途中まで
    const joined = words.join("\n");
    const body = joined.length > 1800 ? joined.slice(0, 1800) + "\n...（省略）" : joined;

    return await interaction.editReply(
      `✅ NGワード一覧（${words.length}件）\n\`\`\`\n${body}\n\`\`\``
    );
  } catch (e) {
    if (isUnknownInteraction(e)) return;
    console.error("ngword error:", e);
    try {
      await interaction.editReply(`❌ エラー: ${e?.message ?? e}`);
    } catch {}
  }
}
