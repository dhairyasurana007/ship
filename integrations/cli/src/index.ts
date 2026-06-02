#!/usr/bin/env node
import { Command } from 'commander';
import { FileTokenStore, ShipClient } from '@ship/sdk';

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
    if (!client) {
      return;
    }

    const result = await client.documents.list(cursor);
    for (const document of result.data) {
      console.log(document.title);
    }
  });

const main = async (): Promise<void> => {
  await program.parseAsync(process.argv);
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
