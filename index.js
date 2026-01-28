require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
});

client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}!`);
});

client.login(process.env.DISCORD_TOKEN);

// Ping に応答する簡易テスト
client.on('messageCreate', (message) => {
  if (message.author.bot) return;
  if (message.content.toLowerCase() === 'ping') {
    message.reply('Pong!');
  }
});
