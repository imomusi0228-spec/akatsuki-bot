import { Events, MessageFlags } from "discord.js";
import { client } from "../core/client.js";

export default {
    name: Events.InteractionCreate,
    async default(interaction) {
        if (!interaction.isChatInputCommand()) return;

        const command = client.commands.get(interaction.commandName);

        if (!command) {
            console.error(`No command matching ${interaction.commandName} was found.`);
            return;
        }

        try {
            await command.execute(interaction);
        } catch (error) {
            console.error(`Error executing ${interaction.commandName}:`, error);
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ content: 'コマンドの実行中にエラーが発生しました。', flags: [MessageFlags.Ephemeral] });
            } else {
                await interaction.reply({ content: `コマンドの実行中にエラーが発生しました。\n\`\`\`${error.message}\`\`\``, flags: [MessageFlags.Ephemeral] });
            }
        }
    },
};
