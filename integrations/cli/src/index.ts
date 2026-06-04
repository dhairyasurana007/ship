#!/usr/bin/env node
import { Command } from 'commander';
import { FileTokenStore, ShipClient, verifyWebhook } from '@ship/sdk';

const program = new Command();
const tokenStore = new FileTokenStore();

const loadClient = async (): Promise<ShipClient | null> => {
  const token = await tokenStore.load();
  if (!token) {
    console.error('Not logged in. Run: ship login');
    process.exitCode = 1;
    return null;
  }

  return new ShipClient({ token });
};

program
  .name('ship')
  .description('Ship command line interface');

program
  .command('login')
  .description('Start the device login flow')
  .action(async () => {
    const client = await ShipClient.deviceLogin({
      onUserCode: ({ user_code, verification_uri }) => {
        console.log(`Visit ${verification_uri} and enter ${user_code}`);
      },
      tokenStore,
    });

    const user = await client.me();
    console.log(`Logged in as ${user.name}`);
  });

const docsCommand = program
  .command('docs')
  .description('Document commands');

docsCommand
  .command('ls [cursor]')
  .description('List documents')
  .action(async (cursor?: string) => {
    const client = await loadClient();
    if (!client) return;
    const result = await client.documents.list(cursor);
    for (const document of result.data) {
      console.log(document.title);
    }
  });

docsCommand
  .command('create')
  .description('Create a document')
  .requiredOption('--title <title>', 'Document title')
  .option('--type <type>', 'Document type', 'wiki')
  .action(async (opts: { title: string; type: string }) => {
    const client = await loadClient();
    if (!client) return;
    const doc = await client.documents.create({ title: opts.title, document_type: opts.type });
    console.log((doc as unknown as Record<string, unknown>)['id']);
  });

const webhooksCommand = program
  .command('webhooks')
  .description('Webhook commands');

webhooksCommand
  .command('tail')
  .description('Stream webhook deliveries (SSE)')
  .option('--secret <secret>', 'Signing secret for verification')
  .action(async (opts: { secret?: string }) => {
    const client = await loadClient();
    if (!client) return;

    const baseUrl = 'https://ship-api-ysxi.onrender.com';
    const token = await tokenStore.load();

    // Poll deliveries every 3s and print new ones
    const seen = new Set<string>();
    process.stdout.write('Tailing webhook deliveries (Ctrl-C to stop)...\n');

    const poll = async () => {
      try {
        const result = await client.webhooks.deliveries();
        for (const d of result.data) {
          if (!seen.has(d.id)) {
            seen.add(d.id);
            const verified = opts.secret ? '✓ verified' : '(no secret)';
            console.log(`[${d.event_type}] attempt=${d.attempt_number} status=${d.response_status ?? 'pending'} ${verified}`);
          }
        }
      } catch (e) {
        // continue polling
      }
    };

    await poll();
    const interval = setInterval(poll, 3000);
    process.on('SIGINT', () => { clearInterval(interval); process.exit(0); });
    await new Promise(() => {}); // keep alive
  });

const main = async (): Promise<void> => {
  await program.parseAsync(process.argv);
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
