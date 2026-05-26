import { useMemo, useState } from 'react';
import { apiPost } from '@/lib/api';

interface FleetGraphGlobalLauncherProps {
  documentId?: string;
  documentType?: string;
}

export function FleetGraphGlobalLauncher({ documentId, documentType }: FleetGraphGlobalLauncherProps) {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [response, setResponse] = useState('');
  const [loading, setLoading] = useState(false);

  const hasContext = useMemo(() => Boolean(documentId && documentType), [documentId, documentType]);

  async function send(explicitConfirm = false): Promise<void> {
    if (!hasContext || !prompt.trim()) return;
    setLoading(true);
    try {
      const res = await apiPost('/api/fleetgraph/chat', {
          documentType,
          documentId,
          prompt,
          requiresMutationConfirm: true,
          explicitConfirm,
      });
      const data = await res.json();
      setResponse(String(data.response ?? 'No response'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed bottom-4 right-4 z-50">
      {open && (
        <div className="mb-2 w-80 rounded-lg border border-border bg-background p-3 shadow-lg">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">FleetGraph Assistant</p>
          {!hasContext && (
            <p className="mt-2 text-xs text-muted">Open a document to use context-aware FleetGraph chat.</p>
          )}
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={hasContext ? 'Ask about the current document...' : 'Open a document first...'}
            className="mt-2 w-full min-h-20 rounded border border-border bg-background p-2 text-xs"
            disabled={!hasContext}
          />
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              className="rounded bg-foreground px-2 py-1 text-xs text-background disabled:opacity-50"
              disabled={!hasContext || loading || !prompt.trim()}
              onClick={() => send(false)}
            >
              Ask
            </button>
            <button
              type="button"
              className="rounded border border-border px-2 py-1 text-xs disabled:opacity-50"
              disabled={!hasContext || loading || !prompt.trim()}
              onClick={() => send(true)}
            >
              Confirm
            </button>
          </div>
          {response && <p className="mt-2 whitespace-pre-wrap text-xs text-foreground">{response}</p>}
        </div>
      )}

      <button
        type="button"
        className="rounded-full bg-foreground px-4 py-2 text-xs font-medium text-background shadow"
        onClick={() => setOpen((v) => !v)}
        aria-label="Open FleetGraph assistant"
      >
        FleetGraph
      </button>
    </div>
  );
}
