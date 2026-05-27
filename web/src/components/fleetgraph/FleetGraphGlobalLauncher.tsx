import { useMemo, useRef, useState } from 'react';
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
  const [thinkingStep, setThinkingStep] = useState<string | null>(null);
  const thinkingTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const hasDocumentContext = useMemo(() => Boolean(documentId && documentType), [documentId, documentType]);

  function startThinkingUpdates(): void {
    setThinkingStep('Gathering workspace context...');
    const t1 = setTimeout(() => setThinkingStep('Reasoning over workspace health...'), 450);
    const t2 = setTimeout(() => setThinkingStep('Drafting response...'), 1000);
    thinkingTimersRef.current = [t1, t2];
  }

  function stopThinkingUpdates(): void {
    for (const timer of thinkingTimersRef.current) clearTimeout(timer);
    thinkingTimersRef.current = [];
    setThinkingStep(null);
  }

  async function send(): Promise<void> {
    if (!prompt.trim()) return;
    const promptValue = prompt.trim();
    setMessages((prev) => [...prev, { role: 'user', text: promptValue }]);
    setPrompt('');
    setLoading(true);
    startThinkingUpdates();
    try {
      const res = await apiPost('/api/fleetgraph/chat', {
          contextScope: 'workspace',
          documentType: hasDocumentContext ? documentType : undefined,
          documentId: hasDocumentContext ? documentId : undefined,
          prompt: promptValue,
          requiresMutationConfirm: false,
          explicitConfirm: false,
      });
      const data = await res.json();
      setMessages((prev) => [...prev, { role: 'assistant', text: String(data.response ?? 'No response') }]);
    } catch {
      setMessages((prev) => [...prev, { role: 'assistant', text: 'Request failed. Please retry.' }]);
    } finally {
      stopThinkingUpdates();
      setLoading(false);
    }
  }

  return (
    <div className="fixed bottom-4 right-4 z-50">
      {open && (
        <div className="mb-2 w-80 rounded-lg border border-border bg-background p-3 shadow-lg">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">FleetGraph Assistant</p>
            <button
              type="button"
              aria-label="Minimize FleetGraph assistant"
              className="inline-flex h-6 w-6 items-center justify-center rounded border border-border text-xs text-muted hover:bg-muted"
              onClick={() => setOpen(false)}
            >
              −
            </button>
          </div>
          <p className="mt-2 text-xs text-muted">
            Context: entire workspace account for your current user.
          </p>
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
            {loading && thinkingStep && (
              <div className="flex justify-start">
                <div className="max-w-[85%] rounded-lg border border-border bg-background px-2 py-1 text-xs text-muted whitespace-pre-wrap animate-pulse">
                  FleetGraph is thinking: {thinkingStep}
                </div>
              </div>
            )}
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
            placeholder='Type your message...'
            className="mt-2 w-full min-h-20 rounded border border-border bg-background p-2 text-xs"
          />
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              aria-label="Send message"
              className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-foreground text-background disabled:opacity-50"
              disabled={loading || !prompt.trim()}
              onClick={() => void send()}
            >
              ↑
            </button>
          </div>
        </div>
      )}

      <button
        type="button"
        className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-border bg-background text-foreground shadow-sm transition-colors hover:bg-muted"
        onClick={() => setOpen((v) => !v)}
        aria-label="Open FleetGraph assistant window"
      >
        ↗
      </button>
    </div>
  );
}
