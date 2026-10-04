/** `pnpm discord-mock [port]`: Webhook-Empfänger für `pnpm dev:api` (DISCORD_MOCK_URL), zeigt jede Meldung. */
import { startDiscordMock } from './server';

const port = Number(process.argv[2] ?? 3399);
const mock = await startDiscordMock({
  port,
  onCall: (call) => {
    const body = call.body as {
      embeds?: { title?: string; fields?: { name: string; value: string }[] }[];
    };
    for (const e of body.embeds ?? []) {
      console.log(`▸ ${e.title ?? '(ohne Titel)'}`);
      for (const f of e.fields ?? [])
        console.log(`    ${f.name}: ${f.value.replace(/\n/g, ' | ')}`);
    }
  },
});
console.log(`discord-mock auf ${mock.url} – DISCORD_MOCK_URL=${mock.url} pnpm dev:api`);
