import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from "discord.js";
import { addNgWord, removeNgWord, clearNgWords, getNgWords } from "../service/ng.js";

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
  return p?.has(PermissionFlagsBits.Administrator) || p?.has(PermissionFlagsBits.ManageGuild);
}



export async function execute(interaction, db) {
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  } catch (e) {
    if (isUnknownInteraction(e)) return;
    throw e;
  }

  const sendPublic = interaction.publicSend
    ? interaction.publicSend.bind(interaction)
    : async (payload) => interaction.channel?.send(payload).catch(() => null);

  const finish = async (msg) => {
    try {
      await interaction.editReply(msg);
      setTimeout(() => interaction.deleteReply().catch(() => { }), 1200);
    } catch { }
  };

  try {
    if (!interaction.guildId) return await finish("❌ サーバー内で実行してください。");
    if (!db) return await finish("❌ DBが初期化できていません（Renderログ確認）");

    const sub = interaction.options.getSubcommand();

    if ((sub === "list" || sub === "clear") && !isAdminLike(interaction)) {
      return await finish("❌ 管理者権限（ManageGuild/Administrator）が必要です。");
    }

    if (sub === "add") {
      const word = interaction.options.getString("word", true).trim();
      const r = await addNgWord(db, interaction.guildId, word);
      if (!r.ok) return await finish("❌ 形式が不正です。例: ばか / /ばか|あほ/i");

      const shown = r.added.kind === "regex" ? `/${r.added.word}/${r.added.flags}` : r.added.word;
      await sendPublic({ content: `✅ 追加しました：\`${shown}\`` });
      return await finish("OK");
    }

    if (sub === "remove") {
      const word = interaction.options.getString("word", true).trim();
      const r = await removeNgWord(db, interaction.guildId, word);
      // service/ng.js returns { changes, target }
      // If validation fails (invalid_input), r.ok false.
      if (!r.ok) return await finish("❌ 形式が不正、または削除に失敗しました。");

      if ((r.changes ?? 0) <= 0) {
        await sendPublic({ content: "⚠️ 見つかりませんでした（登録した形式のまま指定してください）" });
        return await finish("OK");
      }

      const shown = r.target.kind === "regex" ? `/${r.target.word}/${r.target.flags}` : r.target.word;
      await sendPublic({ content: `✅ 削除しました：\`${shown}\`` });
      return await finish("OK");
    }

    if (sub === "clear") {
      await clearNgWords(db, interaction.guildId);
      await sendPublic({ content: "✅ NGワードを全削除しました。" });
      return await finish("OK");
    }

    if (sub === "list") {
      // getNgWords returns array directly
      const words = await getNgWords(db, interaction.guildId);

      if (!words.length) {
        await sendPublic({ content: "（空）NGワードは登録されていません。" });
        return await finish("OK");
      }

      const body = words.map((r) => {
        return r.kind === "regex" ? `/${r.word}/${r.flags}` : r.word;
      }).join("\n");

      // 文字数オーバー対策
      if (body.length > 1900) {
        const truncated = body.slice(0, 1900) + "\n... (省略されました)";
        await sendPublic({ content: `📌 NGワード一覧（${words.length}件）\n${truncated}` });
      } else {
        await sendPublic({ content: `📌 NGワード一覧（${words.length}件）\n${body}` });
      }
      return await finish("OK");
    }

    return await finish("❌ 不明なサブコマンドです。");
  } catch (e) {
    console.error("ngword command error:", e);
    return await finish(`❌ エラー: ${e?.message ?? String(e)}`);
  }
}
