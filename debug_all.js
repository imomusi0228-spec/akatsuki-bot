
import { client } from './core/client.js';
import { dbQuery } from './core/db.js';

async function check() {
  await new Promise(r => setTimeout(r, 2000)); // Wait for client login
  try {
    const guilds = client.guilds.cache.map(g => ({ id: g.id, name: g.name }));
    console.log("Joined Guilds:", guilds);

    const categories = await dbQuery("SELECT * FROM ticket_categories WHERE guild_id = $1", ['1467338822051430572']);
    console.log("Categories for Support Guild Count:", categories.rowCount);
    categories.rows.forEach(cat => {
      console.log(`- ID: ${cat.id}, Name: ${cat.name}, Emoji: [${cat.emoji}]`);
    });

  } catch (e) {
    console.error(e);
  }
  process.exit();
}

check();
