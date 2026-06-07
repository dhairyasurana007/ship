#!/usr/bin/env node
import { Command } from "commander";
import { FileTokenStore, ShipClient } from "@ship/sdk";

const program = new Command();
const tokenStore = new FileTokenStore();
const sleep = async (ms: number): Promise<void> => {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
};

const loadClient = async (): Promise<ShipClient | null> => {
  const token = await tokenStore.load();
  if (!token) {
    console.error("Not logged in. Run: ship login");
    process.exitCode = 1;
    return null;
  }

  return new ShipClient({ token });
};

program.name("ship").description("Ship command line interface");

program
  .command("login")
  .description("Start the device login flow")
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

const docsCommand = program.command("docs").description("Document commands");

docsCommand
  .command("ls [cursor]")
  .description("List documents")
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

docsCommand
  .command("get <id>")
  .description("Get a document by ID")
  .action(async (id: string) => {
    const client = await loadClient();
    if (!client) {
      return;
    }

    const document = await client.documents.get(id);
    console.log(JSON.stringify(document, null, 2));
  });

docsCommand
  .command("create")
  .description("Create a document")
  .requiredOption("--title <title>", "Document title")
  .option("--type <type>", "Document type", "wiki")
  .action(async (opts: { title: string; type: string }) => {
    const client = await loadClient();
    if (!client) return;

    const doc = await client.documents.create({
      title: opts.title,
      document_type: opts.type,
    });
    console.log(doc.id);
  });

const webhooksCommand = program
  .command("webhooks")
  .description("Webhook commands");

webhooksCommand
  .command("tail")
  .description("Tail webhook deliveries")
  .option("--poll-interval <ms>", "Polling interval in milliseconds", "5000")
  .action(async (options: { pollInterval: string }) => {
    const client = await loadClient();
    if (!client) {
      return;
    }

    const seen = new Set<string>();
    const pollInterval = Number.parseInt(options.pollInterval, 10);

    if (!Number.isFinite(pollInterval) || pollInterval <= 0) {
      throw new Error("Invalid poll interval");
    }

    while (true) {
      const result = await client.webhooks.deliveries();
      for (const delivery of result.data) {
        if (seen.has(delivery.id)) {
          continue;
        }

        seen.add(delivery.id);
        const status = delivery.dead_lettered_at
          ? "[dead-lettered]"
          : delivery.response_status &&
              delivery.response_status >= 200 &&
              delivery.response_status < 300
            ? "[verified]"
            : delivery.response_status
              ? `[status ${delivery.response_status}]`
              : "[pending]";

        console.log(
          `${status} ${delivery.event_type} ${delivery.idempotency_key} ${delivery.id}`,
        );
      }

      await sleep(pollInterval);
    }
  });

const main = async (): Promise<void> => {
  await program.parseAsync(process.argv);
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
