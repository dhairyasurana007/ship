import { useMemo, useRef, useState } from 'react';
import { apiGet, apiPost } from '@/lib/api';
import { MarkdownMessage } from './MarkdownMessage';

interface FleetGraphGlobalLauncherProps {
  documentId?: string;
  documentType?: string;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

interface FleetGraphOutput {
  id: string;
  title: string;
  message: string;
  condition_type: string;
}

interface FleetGraphApproval {
  id: string;
  mutation_type: string;
  status: string;
  mutation_payload?: Record<string, unknown>;
}

interface FleetGraphChatResponse {
  response?: string;
  degraded?: boolean;
  degradedReason?: string | null;
}

type RecommendedApprovalAction = 'reject' | 'execute' | null;

function readRecommendedApprovalAction(approval: FleetGraphApproval): RecommendedApprovalAction {
  const payload = approval.mutation_payload ?? {};
  const fromCamel = payload.recommendedAction;
  const fromSnake = payload.recommended_action;
  const raw = typeof fromCamel === 'string' ? fromCamel : typeof fromSnake === 'string' ? fromSnake : null;
  if (raw === 'reject' || raw === 'execute') return raw;
  return null;
}

export function FleetGraphGlobalLauncher({ documentId, documentType }: FleetGraphGlobalLauncherProps) {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [thinkingStep, setThinkingStep] = useState<string | null>(null);
  const [outputs, setOutputs] = useState<FleetGraphOutput[]>([]);
  const [approvals, setApprovals] = useState<FleetGraphApproval[]>([]);
  const [degradedNotice, setDegradedNotice] = useState<string | null>(null);
  const [windowPos, setWindowPos] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const thinkingTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const dragOffsetRef = useRef({ x: 0, y: 0 });

  const hasDocumentContext = useMemo(() => Boolean(documentId && documentType), [documentId, documentType]);

  async function loadOutputs(): Promise<void> {
    try {
      const res = await apiGet('/api/fleetgraph/outputs');
      if (!res.ok) return;
      const data = await res.json() as { outputs?: FleetGraphOutput[] };
      setOutputs(Array.isArray(data.outputs) ? data.outputs.slice(0, 5) : []);
    } catch {
      // silent fallback
    }
  }

  async function loadApprovals(): Promise<void> {
    try {
      const res = await apiGet('/api/fleetgraph/approvals/pending');
      if (!res.ok) return;
      const data = await res.json() as { approvals?: FleetGraphApproval[] };
      setApprovals(Array.isArray(data.approvals) ? data.approvals.slice(0, 5) : []);
    } catch {
      // silent fallback
    }
  }

  async function approvalAction(id: string, action: 'approve' | 'reject' | 'execute'): Promise<void> {
    try {
      await apiPost(`/api/fleetgraph/approvals/${id}/${action}`, {});
      await loadApprovals();
    } catch {
      // silent fallback
    }
  }

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
    setDegradedNotice(null);
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
      const data = await res.json() as FleetGraphChatResponse;
      setMessages((prev) => [...prev, { role: 'assistant', text: String(data.response ?? 'No response') }]);
      if (data.degraded) {
        setDegradedNotice(
          data.degradedReason
            ? `FleetGraph used degraded context: ${data.degradedReason}`
            : 'FleetGraph used degraded context for this response.'
        );
      }
    } catch {
      setMessages((prev) => [...prev, { role: 'assistant', text: 'Request failed. Please retry.' }]);
    } finally {
      stopThinkingUpdates();
      setLoading(false);
    }
  }

  function beginDrag(e: React.MouseEvent<HTMLDivElement>): void {
    const panel = e.currentTarget.closest('[data-fleetgraph-panel]');
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    dragOffsetRef.current = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
    setDragging(true);
  }

  function onDrag(e: React.MouseEvent<HTMLDivElement>): void {
    if (!dragging) return;
    setWindowPos({
      x: e.clientX - dragOffsetRef.current.x,
      y: e.clientY - dragOffsetRef.current.y,
    });
  }

  function endDrag(): void {
    if (dragging) setDragging(false);
  }

  return (
    <div className="fixed bottom-4 right-4 z-50" onMouseMove={onDrag} onMouseUp={endDrag} onMouseLeave={endDrag}>
      {open && (
        <div
          data-fleetgraph-panel
          style={{
            position: 'fixed',
            left: windowPos.x ? `${windowPos.x}px` : undefined,
            top: windowPos.y ? `${windowPos.y}px` : undefined,
            right: windowPos.x ? undefined : '1rem',
            bottom: windowPos.y ? undefined : '4.5rem',
          }}
          className="w-80 rounded-lg border border-border bg-background p-3 shadow-lg"
        >
          <div className="flex items-center justify-between cursor-move select-none" onMouseDown={beginDrag}>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">FleetGraph Assistant</p>
            <button
              type="button"
              aria-label="Minimize FleetGraph assistant"
              className="inline-flex h-6 w-6 items-center justify-center rounded border border-border text-xs text-muted hover:bg-muted"
              onClick={() => setOpen(false)}
            >
              -
            </button>
          </div>
          <p className="mt-2 text-xs text-muted">Context scope: workspace-level (current workspace only).</p>
          {degradedNotice && (
            <p className="mt-2 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-900">
              {degradedNotice}
            </p>
          )}
          <div className="mt-2 h-56 space-y-2 overflow-y-auto rounded border border-border bg-muted/20 p-2">
            {messages.length === 0 && <p className="text-xs text-muted">Ask about the current document context.</p>}
            {messages.map((message, index) => (
              <div key={`${message.role}-${index}`} className={message.role === 'assistant' ? 'flex justify-start' : 'flex justify-end'}>
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
                <div className="max-w-[85%] animate-pulse whitespace-pre-wrap rounded-lg border border-border bg-background px-2 py-1 text-xs text-muted">
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
            placeholder="Type your message..."
            className="mt-2 min-h-20 w-full rounded border border-border bg-background p-2 text-xs"
          />
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              aria-label="Send message"
              className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-foreground text-background disabled:opacity-50"
              disabled={loading || !prompt.trim()}
              onClick={() => void send()}
            >
              ?
            </button>
          </div>
        </div>
      )}

      <button
        type="button"
        className="inline-flex h-12 items-center gap-2 rounded-full border border-sky-300 bg-sky-50 px-5 text-sm font-semibold text-sky-800 shadow-sm transition-colors hover:bg-sky-100"
        onClick={() => {
          setOpen((v) => {
            const next = !v;
            if (next) {
              void loadOutputs();
              void loadApprovals();
            }
            return next;
          });
        }}
        aria-label="Open FleetGraph assistant window"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H7l-4 3v-5.5A8.5 8.5 0 1 1 21 11.5Z" />
          <path d="M8.5 10.5h7" />
          <path d="M8.5 14h5" />
        </svg>
        Help
      </button>
      {open && outputs.length > 0 && (
        <div className="mt-2 w-80 rounded border border-border bg-background p-2 text-xs">
          <p className="mb-1 font-semibold text-muted">Recent FleetGraph alerts</p>
          <div className="space-y-1">
            {outputs.map((o) => (
              <div key={o.id} className="rounded border border-border bg-muted/20 p-1">
                <p className="font-medium text-foreground">{o.title}</p>
                <p className="text-muted">{o.message}</p>
              </div>
            ))}
          </div>
        </div>
      )}
      {open && approvals.length > 0 && (
        <div className="mt-2 w-80 rounded border border-border bg-background p-2 text-xs">
          <p className="mb-1 font-semibold text-muted">Pending approvals</p>
          <div className="space-y-1">
            {approvals.map((a) => (
              <div key={a.id} className="rounded border border-border bg-muted/20 p-1">
                <p className="font-medium text-foreground">{a.mutation_type}</p>
                <p className="text-muted">Status: {a.status}</p>
                <div className="mt-1 flex gap-1">
                  <button type="button" className="rounded border px-1" onClick={() => void approvalAction(a.id, 'approve')}>Approve</button>
                  {readRecommendedApprovalAction(a) === 'reject' && (
                    <button type="button" className="rounded border px-1" onClick={() => void approvalAction(a.id, 'reject')}>Reject</button>
                  )}
                  {readRecommendedApprovalAction(a) === 'execute' && (
                    <button type="button" className="rounded border px-1" onClick={() => void approvalAction(a.id, 'execute')}>Execute</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
