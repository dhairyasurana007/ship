import { useState } from 'react';
import { apiPost } from '@/lib/api';

interface FleetGraphAssistantPanelProps {
  documentId: string;
  documentType: string;
}

export function FleetGraphAssistantPanel({ documentId, documentType }: FleetGraphAssistantPanelProps) {
  const [prompt, setPrompt] = useState('');
  const [response, setResponse] = useState('');
  const [requiresConfirm, setRequiresConfirm] = useState(false);
  const [loading, setLoading] = useState(false);

  async function send(options: { requiresMutationConfirm: boolean; explicitConfirm?: boolean }): Promise<void> {
    if (!prompt.trim()) return;
    setLoading(true);
    try {
      const res = await apiPost('/api/fleetgraph/chat', {
          documentType,
          documentId,
          prompt,
          requiresMutationConfirm: options.requiresMutationConfirm,
          explicitConfirm: options.explicitConfirm === true,
      });
      const data = await res.json();
      setResponse(String(data.response ?? 'No response'));
      setRequiresConfirm(Boolean(data.requiresConfirm));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="border-t border-border p-3 space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">FleetGraph</p>
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="Ask about this document context..."
        className="w-full min-h-20 rounded border border-border bg-background p-2 text-xs"
      />
      <div className="flex gap-2">
        <button type="button" onClick={() => send({ requiresMutationConfirm: false })} className="px-2 py-1 text-xs rounded bg-foreground text-background" disabled={loading}>
          Ask
        </button>
        {requiresConfirm && (
          <>
            <button type="button" onClick={() => send({ requiresMutationConfirm: true, explicitConfirm: true })} className="px-2 py-1 text-xs rounded border border-border" disabled={loading}>
              Approve
            </button>
            <button type="button" onClick={() => setRequiresConfirm(false)} className="px-2 py-1 text-xs rounded border border-border" disabled={loading}>
              Reject
            </button>
          </>
        )}
      </div>
      {response && <p className="text-xs text-foreground whitespace-pre-wrap">{response}</p>}
    </div>
  );
}
