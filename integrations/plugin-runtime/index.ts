import { Worker } from "node:worker_threads";

export interface PluginRuntimeOptions {
  timeoutMs?: number;
  maxMemoryMb?: number;
}

export interface DocumentBeforeCreateHook {
  beforeCreate?(document: Record<string, unknown>): unknown | Promise<unknown>;
}

export interface ShipPlugin {
  document?: DocumentBeforeCreateHook;
}

const DEFAULT_TIMEOUT_MS = 1000;
const DEFAULT_MAX_MEMORY_MB = 64;

const workerSource = `
const { parentPort, workerData } = require('node:worker_threads');
const vm = require('node:vm');

let registeredPlugin = null;

const sandbox = {
  registerPlugin(plugin) {
    registeredPlugin = plugin;
  },
  console,
  setTimeout,
  clearTimeout,
  Promise,
  JSON,
  Math,
  Date,
};

vm.createContext(sandbox);

try {
  const script = new vm.Script(workerData.source, { filename: workerData.filename ?? 'plugin.js' });
  script.runInContext(sandbox, { timeout: workerData.timeoutMs });
  if (!registeredPlugin) {
    throw new Error('Plugin did not call registerPlugin()');
  }
  const hook = registeredPlugin?.document?.beforeCreate;
  if (typeof hook !== 'function') {
    throw new Error('Plugin does not define document.beforeCreate');
  }
  Promise.resolve(hook(workerData.document)).then(
    (result) => parentPort.postMessage({ ok: true, result }),
    (error) => parentPort.postMessage({ ok: false, error: error?.message ?? String(error) }),
  );
} catch (error) {
  parentPort.postMessage({ ok: false, error: error?.message ?? String(error) });
}
`;

function runWorker(
  source: string,
  document: Record<string, unknown>,
  options: PluginRuntimeOptions = {},
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxMemoryMb = options.maxMemoryMb ?? DEFAULT_MAX_MEMORY_MB;
    const worker = new Worker(workerSource, {
      eval: true,
      workerData: {
        source,
        document,
        timeoutMs,
        filename: "ship-plugin.js",
      },
      resourceLimits: {
        maxOldGenerationSizeMb: maxMemoryMb,
      },
    });

    const timeout = setTimeout(() => {
      worker.terminate().catch(() => undefined);
      reject(new Error(`Plugin timed out after ${timeoutMs}ms`));
    }, timeoutMs + 50);

    worker.once(
      "message",
      (message: { ok: boolean; result?: unknown; error?: string }) => {
        clearTimeout(timeout);
        worker.terminate().catch(() => undefined);
        if (message.ok) {
          resolve(message.result);
        } else {
          reject(new Error(message.error ?? "Plugin execution failed"));
        }
      },
    );

    worker.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    worker.once("exit", (code) => {
      if (code !== 0) {
        clearTimeout(timeout);
      }
    });
  });
}

export async function runDocumentBeforeCreate(
  source: string,
  document: Record<string, unknown>,
  options: PluginRuntimeOptions = {},
): Promise<unknown> {
  return runWorker(source, document, options);
}

export async function runPluginSource(
  source: string,
  document: Record<string, unknown>,
  options: PluginRuntimeOptions = {},
): Promise<unknown> {
  return runWorker(source, document, options);
}
