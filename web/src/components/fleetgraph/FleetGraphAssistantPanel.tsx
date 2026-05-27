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
  const [loading, setLoading] = useState(false);

  async function send(): Promise<void> {
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
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (!loading) void send();
          }
        }}
        placeholder="Type your message..."
        className="w-full min-h-20 rounded border border-border bg-background p-2 text-xs"
      />
      <div className="flex justify-end">
        <button
          type="button"
          aria-label="Send message"
          onClick={() => void send()}
          className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-foreground text-background disabled:opacity-50"
          disabled={loading || !prompt.trim()}
        >
          ↑
        </button>
      </div>
    </div>
  );
}
