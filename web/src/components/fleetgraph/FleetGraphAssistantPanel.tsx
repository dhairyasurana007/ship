import { useState } from 'react';
import { apiPost } from '@/lib/api';

interface FleetGraphAssistantPanelProps {
  documentId: string;
  documentType: string;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

export function FleetGraphAssistantPanel({ documentId, documentType }: FleetGraphAssistantPanelProps) {
  const [prompt, setPrompt] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [requiresConfirm, setRequiresConfirm] = useState(false);
  const [loading, setLoading] = useState(false);

  async function send(options: { requiresMutationConfirm: boolean; explicitConfirm?: boolean }): Promise<void> {
    if (!prompt.trim()) return;
    const promptValue = prompt.trim();
    setMessages((prev) => [...prev, { role: 'user', text: promptValue }]);
    setPrompt('');
    setLoading(true);
    try {
      const res = await apiPost('/api/fleetgraph/chat', {
          documentType,
          documentId,
          prompt: promptValue,
          requiresMutationConfirm: options.requiresMutationConfirm,
          explicitConfirm: options.explicitConfirm === true,
      });
      const data = await res.json();
      setMessages((prev) => [...prev, { role: 'assistant', text: String(data.response ?? 'No response') }]);
      setRequiresConfirm(Boolean(data.requiresConfirm));
    } catch {
      setMessages((prev) => [...prev, { role: 'assistant', text: 'Request failed. Please retry.' }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="border-t border-border p-3 space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">FleetGraph</p>
      <div className="h-52 overflow-y-auto rounded border border-border bg-muted/20 p-2 space-y-2">
        {messages.length === 0 && (
          <p className="text-xs text-muted">Start a conversation about this document.</p>
        )}
        {messages.map((message, index) => (
          <div
            key={`${message.role}-${index}`}
            className={message.role === 'assistant' ? 'flex justify-start' : 'flex justify-end'}
          >
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
        placeholder="Type your message..."
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
    </div>
  );
}
