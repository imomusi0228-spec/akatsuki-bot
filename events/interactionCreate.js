import { Events, MessageFlags } from "discord.js";
import { client } from "../core/client.js";

export default {
    name: Events.InteractionCreate,
    async default(interaction) {
        if (!interaction.isChatInputCommand()) return;

        const command = client.commands.get(interaction.commandName);
        console.log(`[CMD DEBUG] Received command: ${interaction.commandName}, HandlerFound: ${!!command}`);

        if (!command) {
            console.error(`No command matching ${interaction.commandName} was found.`);
            return;
        }

        try {
            console.log(`[CMD DEBUG] Executing command: ${interaction.commandName}`);
            await command.execute(interaction);
            console.log(`[CMD DEBUG] Command executed successfully: ${interaction.commandName}`);
        } catch (error) {
            console.error(`[CMD DEBUG] Error executing ${interaction.commandName}:`, error);
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ content: 'There was an error while executing this command!', flags: [MessageFlags.Ephemeral] });
            } else {
                await interaction.reply({ content: `There was an error while executing this command!\n\`\`\`${error.message}\`\`\``, flags: [MessageFlags.Ephemeral] });
            }
        }
    },
};
