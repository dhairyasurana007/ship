import { useRef, useState } from 'react';
import { apiPost } from '@/lib/api';
import { MarkdownMessage } from './MarkdownMessage';

interface FleetGraphAssistantPanelProps {
  documentId: string;
  documentType: string;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

type AccessMode = 'ask_permission' | 'full_access';

interface FleetGraphChatResponse {
  response?: string;
  requiresConfirm?: boolean;
}

function mayRequireMutation(prompt: string): boolean {
  const lower = prompt.toLowerCase();
  return /(move|reassign|assign|change state|close|cancel|reopen|update|edit|modify|delete)/.test(lower);
}

export function FleetGraphAssistantPanel({ documentId, documentType }: FleetGraphAssistantPanelProps) {
  const [prompt, setPrompt] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [thinkingStep, setThinkingStep] = useState<string | null>(null);
  const [accessMode, setAccessMode] = useState<AccessMode>('ask_permission');
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const thinkingTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  function startThinkingUpdates(): void {
    setThinkingStep('Gathering context...');
    const t1 = setTimeout(() => setThinkingStep('Reasoning over project data...'), 450);
    const t2 = setTimeout(() => setThinkingStep('Drafting response...'), 1000);
    thinkingTimersRef.current = [t1, t2];
  }

  function stopThinkingUpdates(): void {
    for (const timer of thinkingTimersRef.current) clearTimeout(timer);
    thinkingTimersRef.current = [];
    setThinkingStep(null);
  }

  async function send(explicitPrompt?: string, explicitConfirm = false): Promise<void> {
    const promptValue = (explicitPrompt ?? prompt).trim();
    if (!promptValue) return;
    if (!explicitPrompt) {
      setMessages((prev) => [...prev, { role: 'user', text: promptValue }]);
      setPrompt('');
    }
    setLoading(true);
    startThinkingUpdates();
    try {
      const requiresMutationConfirm = accessMode === 'ask_permission' && mayRequireMutation(promptValue);
      const res = await apiPost('/api/fleetgraph/chat', {
          contextScope: 'document',
          documentType,
          documentId,
          prompt: promptValue,
          requiresMutationConfirm,
          explicitConfirm,
      });
      const data = await res.json() as FleetGraphChatResponse;
      if (data.requiresConfirm && !explicitConfirm) {
        setPendingPrompt(promptValue);
      } else {
        setPendingPrompt(null);
      }
      setMessages((prev) => [...prev, { role: 'assistant', text: String(data.response ?? 'No response') }]);
    } catch {
      setMessages((prev) => [...prev, { role: 'assistant', text: 'Request failed. Please retry.' }]);
    } finally {
      stopThinkingUpdates();
      setLoading(false);
    }
  }

  return (
    <div className="border-t border-border p-3 space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">FleetGraph</p>
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-muted">Agent Access</p>
        <select
          aria-label="Agent access mode"
          className="rounded border border-border bg-background px-2 py-1 text-[11px]"
          value={accessMode}
          onChange={(e) => setAccessMode(e.target.value as AccessMode)}
        >
          <option value="ask_permission">Ask Permission</option>
          <option value="full_access">Full Access</option>
        </select>
      </div>
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
              {message.role === 'assistant' ? <MarkdownMessage content={message.text} /> : message.text}
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
        {pendingPrompt && !loading && (
          <div className="flex justify-start">
            <div className="max-w-[85%] rounded border border-border bg-background p-2 text-xs">
              <p className="text-foreground">Approve this requested action?</p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  className="rounded border px-2 py-1"
                  onClick={() => void send(pendingPrompt, true)}
                >
                  Approve
                </button>
                <button
                  type="button"
                  className="rounded border px-2 py-1"
                  onClick={() => {
                    setPendingPrompt(null);
                    setMessages((prev) => [...prev, { role: 'assistant', text: 'Action rejected. No mutation will be executed.' }]);
                  }}
                >
                  Reject
                </button>
              </div>
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
