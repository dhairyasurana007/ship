import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { apiDelete, apiGet, apiPost } from '@/lib/api';
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
  run_id?: string;
  condition_type: string;
  output_kind?: string;
  entity_id?: string;
  entity_type?: string;
  recipient_user_id?: string;
  title: string;
  message: string;
  metadata?: Record<string, unknown>;
  created_at?: string;
}

interface FleetGraphApproval {
  id: string;
  run_id?: string;
  entity_id?: string;
  mutation_type: string;
  status: string;
  requested_by?: string;
  expires_at?: string;
  created_at?: string;
  mutation_payload?: Record<string, unknown>;
}

interface FleetGraphChatResponse {
  response?: string;
  requiresConfirm?: boolean;
  degraded?: boolean;
  degradedReason?: string | null;
  toolResult?: {
    ok?: boolean;
  };
}
type AccessMode = 'ask_permission' | 'full_access';

function approvalSummary(a: FleetGraphApproval): string {
  const p = a.mutation_payload ?? {};
  switch (a.mutation_type) {
    case 'reassign_issue':
      return `Reassign issue${p.issueTitle ? ` "${String(p.issueTitle)}"` : ''} to ${String(p.assigneeName ?? p.assignee_id ?? 'new assignee')}`;
    case 'move_issue_sprint':
      return `Move issue${p.issueTitle ? ` "${String(p.issueTitle)}"` : ''} to sprint ${String(p.sprintTitle ?? p.sprint_id ?? 'new sprint')}`;
    case 'change_issue_state':
      return `Change issue${p.issueTitle ? ` "${String(p.issueTitle)}"` : ''} state to "${String(p.newState ?? p.new_state ?? 'unknown')}"`;
    default:
      return a.mutation_type.replace(/_/g, ' ');
  }
}

export function FleetGraphGlobalLauncher({ documentId, documentType }: FleetGraphGlobalLauncherProps) {
  const WELCOME_MESSAGE = 'Hello! How can I assist you today!';
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [alertsMinimized, setAlertsMinimized] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [thinkingStep, setThinkingStep] = useState<string | null>(null);
  const [outputs, setOutputs] = useState<FleetGraphOutput[]>([]);
  const [approvals, setApprovals] = useState<FleetGraphApproval[]>([]);
  const [degradedNotice, setDegradedNotice] = useState<string | null>(null);
  const [accessMode, setAccessMode] = useState<AccessMode>('ask_permission');
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const [selectedApproval, setSelectedApproval] = useState<FleetGraphApproval | null>(null);
  const [selectedOutput, setSelectedOutput] = useState<FleetGraphOutput | null>(null);
  const [windowPos, setWindowPos] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const thinkingTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  // Debounce ref so rapid DB mutations don't spam search_entities
  const dbUpdateDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);
  const dragOffsetRef = useRef({ x: 0, y: 0 });

  const hasDocumentContext = useMemo(() => Boolean(documentId && documentType), [documentId, documentType]);

  function invalidateDocumentCaches(): void {
    void queryClient.invalidateQueries({ queryKey: ['documents'], refetchType: 'active' });
    void queryClient.invalidateQueries({ queryKey: ['document'], refetchType: 'active' });
    void queryClient.invalidateQueries({ queryKey: ['issues'], refetchType: 'active' });
    void queryClient.invalidateQueries({ queryKey: ['projects'], refetchType: 'active' });
    void queryClient.invalidateQueries({ queryKey: ['programs'], refetchType: 'active' });
    // Refresh workspace context if FleetGraph is open — data just changed
    if (open) {
      if (dbUpdateDebounceRef.current) clearTimeout(dbUpdateDebounceRef.current);
      dbUpdateDebounceRef.current = setTimeout(() => {
        setMessages((prev) => [...prev, { role: 'assistant', text: '🔄 Data was updated — calling search_entities to refresh workspace context…' }]);
        void send('search_entities');
      }, 1000);
    }
  }

  function mayRequireMutation(promptText: string): boolean {
    const lower = promptText.toLowerCase();
    return /(create|add|new|move|reassign|assign|change state|close|cancel|reopen|update|edit|modify|delete|remove)/.test(lower);
  }

  useEffect(() => {
    const t = setTimeout(() => {
      void loadOutputs().then(() => void loadApprovals());
    }, 300);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function handleOpen() {
      setOpen(true);
      setMessages([
        { role: 'assistant', text: WELCOME_MESSAGE },
        { role: 'assistant', text: '⏳ Calling search_entities to load workspace context… (session start)' },
      ]);
      void send('search_entities');
      void loadOutputs();
      void loadApprovals();
    }
    window.addEventListener('fleetgraph:open', handleOpen);
    return () => window.removeEventListener('fleetgraph:open', handleOpen);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  async function dismissOutput(id: string): Promise<void> {
    try {
      await apiDelete(`/api/fleetgraph/outputs/${id}`);
      setOutputs((prev) => prev.filter((o) => o.id !== id));
    } catch { /* silent */ }
  }

  async function dismissAllOutputs(): Promise<void> {
    try {
      await apiDelete('/api/fleetgraph/outputs');
      setOutputs([]);
    } catch { /* silent */ }
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

  async function approvalAction(id: string, action: 'approve' | 'reject'): Promise<void> {
    try {
      await apiPost(`/api/fleetgraph/approvals/${id}/${action}`, {});
      if (action === 'approve') {
        // approve then immediately execute
        await apiPost(`/api/fleetgraph/approvals/${id}/execute`, {});
      }
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

  async function send(explicitPrompt?: string, explicitConfirm = false): Promise<void> {
    const promptValue = (explicitPrompt ?? prompt).trim();
    if (!promptValue) return;
    if (!explicitPrompt) {
      // Real user message — mark session as active
      userHasSentRef.current = true;
      setMessages((prev) => [...prev, { role: 'user', text: promptValue }]);
      setPrompt('');
    }
    setLoading(true);
    setDegradedNotice(null);
    setThinkingStep('Selecting tool...');
    try {
      const contextScope = hasDocumentContext ? 'document' : 'workspace';
      const requiresMutationConfirm = accessMode === 'ask_permission' && mayRequireMutation(promptValue);
      const res = await apiPost('/api/fleetgraph/chat', {
        accessMode,
        contextScope,
        documentType: hasDocumentContext ? documentType : undefined,
        documentId: hasDocumentContext ? documentId : undefined,
        prompt: promptValue,
        requiresMutationConfirm,
        explicitConfirm,
        currentPath: window.location.pathname, // sent to API for page-awareness
        history: messages.slice(-10).map((m) => ({ role: m.role, content: m.text })),
      });
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let data: FleetGraphChatResponse | null = null;
      let serverError: string | null = null;
      if (reader) {
        let buf = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';
          for (const line of lines) {
            if (line.startsWith(':')) continue; // SSE heartbeat comment, ignore
            if (!line.startsWith('data: ')) continue;
            const event = JSON.parse(line.slice(6)) as { type: string; message?: string } & FleetGraphChatResponse;
            if (event.type === 'tool_selected') {
              setThinkingStep(`⚙ ${(event as unknown as { tool: string }).tool}`);
            } else if (event.type === 'done') {
              data = event;
            } else if (event.type === 'error') {
              serverError = event.message ?? 'An error occurred. Please retry.';
            }
          }
        }
      }
      if (data?.requiresConfirm && !explicitConfirm) {
        setPendingPrompt(promptValue);
      } else {
        setPendingPrompt(null);
      }
      if (data?.toolResult?.ok) invalidateDocumentCaches();
      const responseText = serverError ?? String(data?.response ?? 'No response');
      setMessages((prev) => {
        if (explicitPrompt) {
          // Replace the placeholder inserted by the auto-call on open
          let idx = -1;
          for (let i = prev.length - 1; i >= 0; i--) {
            if (prev[i]!.role === 'assistant' && prev[i]!.text.startsWith('⏳')) { idx = i; break; }
          }
          if (idx !== -1) {
            const next = [...prev];
            next[idx] = { role: 'assistant', text: responseText };
            return next;
          }
        }
        return [...prev, { role: 'assistant', text: responseText }];
      });
      if (data?.degraded) {
        setDegradedNotice(data.degradedReason
          ? `FleetGraph used degraded context: ${data.degradedReason}`
          : 'FleetGraph used degraded context for this response.');
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
    <div className="relative" onMouseMove={onDrag} onMouseUp={endDrag} onMouseLeave={endDrag}>
      {open && (
        <div
          data-fleetgraph-panel
          style={{
            position: 'fixed',
            left: windowPos.x ? `${windowPos.x}px` : '4rem',
            top: windowPos.y ? `${windowPos.y}px` : undefined,
            bottom: windowPos.y ? undefined : '3rem',
          }}
          className="z-50 w-80 rounded-lg border border-border bg-background p-3 shadow-lg"
        >
          <div className="flex items-center justify-between cursor-move select-none" onMouseDown={beginDrag}>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">FleetGraph Assistant</p>
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label="Reset chat"
                title="Reset chat"
                className="inline-flex h-6 w-6 items-center justify-center rounded border border-border text-xs text-muted hover:bg-muted"
                onClick={(e) => {
                  e.stopPropagation();
                  setMessages([
                    { role: 'assistant', text: WELCOME_MESSAGE },
                    { role: 'assistant', text: '⏳ Calling search_entities to refresh workspace context… (session reset)' },
                  ]);
                  setPrompt('');
                  setPendingPrompt(null);
                  setDegradedNotice(null);
                  setThinkingStep(null);
                  void send('search_entities');
                }}
              >
                ↺
              </button>
              <button
                type="button"
                aria-label="Minimize FleetGraph assistant"
                className="inline-flex h-6 w-6 items-center justify-center rounded border border-border text-xs text-muted hover:bg-muted"
                onClick={() => setOpen(false)}
              >
                -
              </button>
            </div>
          </div>
          <p className="mt-2 text-xs text-muted" data-scope={hasDocumentContext ? 'document' : 'workspace'}>
            Context scope: {hasDocumentContext ? 'document-level.' : 'workspace-level.'}
          </p>
          {degradedNotice && (
            <p className="mt-2 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-900">
              {degradedNotice}
            </p>
          )}
          <div className="mt-2 h-56 space-y-2 overflow-y-auto rounded border border-border bg-muted/20 p-2">
            {messages.length === 0 && (
              <div className="space-y-1">
                <p className="text-xs text-muted">Suggested:</p>
                {(documentType === 'sprint'
                  ? ['What issues are at risk in this sprint?', 'Show scope changes since sprint start', 'Who is over capacity?']
                  : documentType === 'issue'
                  ? ['Is this issue blocked?', 'Summarize recent activity on this issue', 'Who should own this?']
                  : documentType === 'project'
                  ? ['What is the health of this project?', 'Which sprints are behind?', 'Are there any orphaned issues?']
                  : ['What should I focus on today?', 'Which sprints are at risk?', 'Show me all unassigned issues']
                ).map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    className="block w-full rounded border border-border bg-background px-2 py-1 text-left text-xs text-muted hover:text-foreground hover:bg-muted/40 transition-colors"
                    onClick={() => { setPrompt(suggestion); }}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
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
            <div ref={messagesEndRef} />
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
          <div className="mt-2 flex items-end justify-between">
            <div className="flex items-center gap-2">
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
        className={`relative flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${open ? 'bg-border text-foreground' : 'text-muted hover:bg-border/50 hover:text-foreground'}`}
        onClick={() => {
          setOpen((v) => {
            const next = !v;
            if (next) {
              setMessages((prev) => (
                prev.length === 0
                  ? [{ role: 'assistant', text: WELCOME_MESSAGE }]
                  : prev
              ));
              void loadOutputs();
              void loadApprovals();
            }
            return next;
          });
        }}
        aria-label="FleetGraph Assistant"
        title="FleetGraph Assistant"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H7l-4 3v-5.5A8.5 8.5 0 1 1 21 11.5Z" />
          <path d="M8.5 10.5h7" />
          <path d="M8.5 14h5" />
        </svg>
        {approvals.length > 0 && (
          <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-orange-500" />
        )}
      </button>

      {/* Alerts & approvals — fixed bottom-right, independent of button position */}
      {(outputs.length > 0 || approvals.length > 0) && (
        <div className="fixed z-50 flex w-72 flex-col gap-2 bottom-4 right-4">
          {outputs.length > 0 && (
            <div className="rounded border border-border bg-background text-xs shadow-lg">
              {/* Header — always visible, click to toggle */}
              <div
                className="flex cursor-pointer items-center justify-between px-2 py-1.5 hover:bg-muted/30 transition-colors"
                onClick={() => setAlertsMinimized((v) => !v)}
              >
                <p className="font-semibold text-muted">
                  FleetGraph alerts ({outputs.length})
                </p>
                <div className="flex items-center gap-2">
                  <div
                    className="group relative"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-muted hover:text-foreground transition-colors cursor-default" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10" />
                      <path d="M12 16v-4M12 8h.01" />
                    </svg>
                    <div className="pointer-events-none absolute bottom-full right-0 mb-2 w-64 rounded border border-border bg-background p-2.5 text-xs text-muted shadow-lg opacity-0 group-hover:opacity-100 transition-opacity z-10">
                      <p className="font-semibold text-foreground mb-1">FleetGraph alerts vs. Ship alerts</p>
                      <p className="mb-1"><span className="font-medium text-foreground">Ship alerts</span> (red banner) — your personal workflow obligations: weekly plans, retros, and action items you need to complete.</p>
                      <p><span className="font-medium text-foreground">FleetGraph alerts</span> — AI-detected project health signals: stale issues, blockers, orphaned work, and capacity gaps across your team.</p>
                    </div>
                  </div>
                  <span className="text-muted">{alertsMinimized ? '▲' : '▼'}</span>
                </div>
              </div>
              {/* Expandable body */}
              {!alertsMinimized && (
                <div className="space-y-1 border-t border-border p-2">
                  {outputs.map((o) => (
                    <div
                      key={o.id}
                      className="cursor-pointer rounded border border-border bg-muted/20 p-2 hover:bg-muted/40 transition-colors"
                      onClick={() => setSelectedOutput(o)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-medium text-foreground">{o.title}</p>
                        <button
                          type="button"
                          className="shrink-0 text-muted hover:text-foreground transition-colors"
                          onClick={(e) => { e.stopPropagation(); void dismissOutput(o.id); }}
                          aria-label="Clear alert"
                        >
                          ✕
                        </button>
                      </div>
                      <p className="mt-0.5 text-muted line-clamp-1">{o.message}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {approvals.length > 0 && (
            <div className="rounded border border-border bg-background p-2 text-xs shadow-lg">
              <p className="mb-1 font-semibold text-muted">Pending approvals</p>
              <div className="space-y-1">
                {approvals.map((a) => (
                  <div
                    key={a.id}
                    className="cursor-pointer rounded border border-border bg-muted/20 p-2 hover:bg-muted/40 transition-colors"
                    onClick={() => setSelectedApproval(a)}
                  >
                    <p className="font-medium text-foreground">{approvalSummary(a)}</p>
                    <p className="mt-0.5 text-muted">Click to review · {a.expires_at ? `Expires ${new Date(a.expires_at).toLocaleDateString()}` : 'Pending'}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Alert detail modal */}
      {selectedOutput && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40" onClick={() => setSelectedOutput(null)}>
          <div className="w-96 rounded-lg border border-border bg-background p-4 shadow-xl text-sm" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-3">
              <h3 className="font-semibold text-foreground">Alert Detail</h3>
              <button type="button" className="text-muted hover:text-foreground" onClick={() => setSelectedOutput(null)}>✕</button>
            </div>

            <p className="text-foreground font-medium mb-3">{selectedOutput.title}</p>
            <p className="text-muted text-xs mb-4">{selectedOutput.message}</p>

            <div className="space-y-2 text-xs text-muted mb-4">
              {selectedOutput.condition_type && (
                <div className="flex gap-2"><span className="w-24 shrink-0 font-medium text-foreground/70">Condition</span><span>{selectedOutput.condition_type.replace(/_/g, ' ')}</span></div>
              )}
              {selectedOutput.output_kind && (
                <div className="flex gap-2"><span className="w-24 shrink-0 font-medium text-foreground/70">Kind</span><span>{selectedOutput.output_kind.replace(/_/g, ' ')}</span></div>
              )}
              {selectedOutput.entity_id && (
                <div className="flex gap-2"><span className="w-24 shrink-0 font-medium text-foreground/70">Affected</span><span>{selectedOutput.entity_id}</span></div>
              )}
              {selectedOutput.created_at && (
                <div className="flex gap-2"><span className="w-24 shrink-0 font-medium text-foreground/70">Created</span><span>{new Date(selectedOutput.created_at).toLocaleString()}</span></div>
              )}
              {selectedOutput.metadata && Object.keys(selectedOutput.metadata).length > 0 && (
                <div className="mt-2">
                  <p className="font-medium text-foreground/70 mb-1">Details</p>
                  <pre className="rounded bg-muted/30 p-2 text-[11px] overflow-auto max-h-32 whitespace-pre-wrap">{JSON.stringify(selectedOutput.metadata, null, 2)}</pre>
                </div>
              )}
            </div>

            <div className="flex justify-between items-center">
              {selectedOutput.entity_id && (
                <button
                  type="button"
                  className="text-xs text-blue-500 hover:underline"
                  onClick={() => { setSelectedOutput(null); navigate(`/documents/${selectedOutput.entity_id}`); }}
                >
                  View →
                </button>
              )}
              <button
                type="button"
                className="rounded border border-border px-3 py-1.5 text-xs hover:bg-muted transition-colors ml-auto"
                onClick={() => { void dismissOutput(selectedOutput.id); setSelectedOutput(null); }}
              >
                Clear alert
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Approval detail modal */}
      {selectedApproval && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40" onClick={() => setSelectedApproval(null)}>
          <div className="w-96 rounded-lg border border-border bg-background p-4 shadow-xl text-sm" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-3">
              <h3 className="font-semibold text-foreground">Approval Request</h3>
              <button type="button" className="text-muted hover:text-foreground" onClick={() => setSelectedApproval(null)}>✕</button>
            </div>

            <p className="text-foreground font-medium mb-3">{approvalSummary(selectedApproval)}</p>

            <div className="space-y-2 text-xs text-muted mb-4">
              {selectedApproval.entity_id && (
                <div className="flex gap-2"><span className="w-24 shrink-0 font-medium text-foreground/70">Affected</span><span>{selectedApproval.entity_id}</span></div>
              )}
              {selectedApproval.requested_by && (
                <div className="flex gap-2"><span className="w-24 shrink-0 font-medium text-foreground/70">Requested by</span><span>{selectedApproval.requested_by}</span></div>
              )}
              {selectedApproval.created_at && (
                <div className="flex gap-2"><span className="w-24 shrink-0 font-medium text-foreground/70">Created</span><span>{new Date(selectedApproval.created_at).toLocaleString()}</span></div>
              )}
              {selectedApproval.expires_at && (
                <div className="flex gap-2"><span className="w-24 shrink-0 font-medium text-foreground/70">Expires</span><span>{new Date(selectedApproval.expires_at).toLocaleString()}</span></div>
              )}
              {selectedApproval.mutation_payload && Object.keys(selectedApproval.mutation_payload).length > 0 && (
                <div className="mt-2">
                  <p className="font-medium text-foreground/70 mb-1">Payload</p>
                  <pre className="rounded bg-muted/30 p-2 text-[11px] overflow-auto max-h-32 whitespace-pre-wrap">{JSON.stringify(selectedApproval.mutation_payload, null, 2)}</pre>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between">
              {Boolean(selectedApproval.entity_id ?? selectedApproval.mutation_payload?.issueId ?? selectedApproval.mutation_payload?.issue_id) && (
                <button
                  type="button"
                  className="text-xs text-blue-500 hover:underline"
                  onClick={() => {
                    const id = selectedApproval.entity_id ?? String(selectedApproval.mutation_payload?.issueId ?? selectedApproval.mutation_payload?.issue_id ?? '');
                    setSelectedApproval(null);
                    navigate(`/documents/${id}`);
                  }}
                >
                  View →
                </button>
              )}
              <div className="flex gap-2 ml-auto">
                <button
                  type="button"
                  className="rounded border border-border px-3 py-1.5 text-xs hover:bg-muted transition-colors"
                  onClick={() => { void approvalAction(selectedApproval.id, 'reject'); setSelectedApproval(null); }}
                >
                  Reject
                </button>
                <button
                  type="button"
                  className="rounded bg-foreground px-3 py-1.5 text-xs text-background hover:opacity-90 transition-opacity"
                  onClick={() => { void approvalAction(selectedApproval.id, 'approve'); setSelectedApproval(null); }}
                >
                  Approve
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
