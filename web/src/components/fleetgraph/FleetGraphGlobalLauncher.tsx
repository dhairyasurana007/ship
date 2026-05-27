import { useMemo, useState } from 'react';
import { apiPost } from '@/lib/api';

interface FleetGraphGlobalLauncherProps {
  documentId?: string;
  documentType?: string;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

export function FleetGraphGlobalLauncher({ documentId, documentType }: FleetGraphGlobalLauncherProps) {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);

  const hasContext = useMemo(() => Boolean(documentId && documentType), [documentId, documentType]);

  async function send(): Promise<void> {
    if (!hasContext || !prompt.trim()) return;
    const promptValue = prompt.trim();
    setMessages((prev) => [...prev, { role: 'user', text: promptValue }]);
    setPrompt('');
    setLoading(true);
    try {
      const res = await apiPost('/api/fleetgraph/chat', {
          documentType,
          documentId,
          prompt: promptValue,
          requiresMutationConfirm: false,
          explicitConfirm: false,
      });
      const data = await res.json();
      setMessages((prev) => [...prev, { role: 'assistant', text: String(data.response ?? 'No response') }]);
    } catch {
      setMessages((prev) => [...prev, { role: 'assistant', text: 'Request failed. Please retry.' }]);
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
          <div className="mt-2 h-56 overflow-y-auto rounded border border-border bg-muted/20 p-2 space-y-2">
            {messages.length === 0 && (
              <p className="text-xs text-muted">Ask about the current document context.</p>
            )}
            {messages.map((message, index) => (
              <div key={`${message.role}-${index}`} className={message.role === 'assistant' ? 'flex justify-start' : 'flex justify-end'}>
                <div
                  className={
                    message.role === 'assistant'
                      ? 'max-w-[85%] rounded-lg border border-border bg-background px-2 py-1 text-xs text-foreground whitespace-pre-wrap'
                      : 'max-w-[85%] rounded-lg bg-foreground px-2 py-1 text-xs text-background whitespace-pre-wrap'
                  }
                >
                  {message.text}
                </div>
              </div>
            ))}
          </div>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (!loading) void send();
              }
            }}
            placeholder={hasContext ? 'Type your message...' : 'Open a document first...'}
            className="mt-2 w-full min-h-20 rounded border border-border bg-background p-2 text-xs"
            disabled={!hasContext}
          />
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              aria-label="Send message"
              className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-foreground text-background disabled:opacity-50"
              disabled={!hasContext || loading || !prompt.trim()}
              onClick={() => void send()}
            >
              ↑
            </button>
          </div>
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
