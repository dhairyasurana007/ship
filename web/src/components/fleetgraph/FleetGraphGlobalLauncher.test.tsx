import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { FleetGraphGlobalLauncher } from './FleetGraphGlobalLauncher';

describe('FleetGraphGlobalLauncher', () => {
  function renderWithQueryClient(ui: ReactElement) {
    const client = new QueryClient();
    return render(
      <MemoryRouter>
        <QueryClientProvider client={client}>{ui}</QueryClientProvider>
      </MemoryRouter>
    );
  }

  function makeSseResponse(payload: object): Response {
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done', ...payload })}\n\n`));
        controller.close();
      },
    });
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }

  function makeJsonResponse(data: object): Response {
    return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
  }

  function baseFetchMock(chatPayload: object = { response: 'ok', degraded: false }) {
    return vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/csrf-token')) return makeJsonResponse({ token: 't' });
      if (url.includes('/api/fleetgraph/outputs')) return makeJsonResponse({ outputs: [] });
      if (url.includes('/api/fleetgraph/approvals/pending')) return makeJsonResponse({ approvals: [] });
      if (url.includes('/api/fleetgraph/chat')) return makeSseResponse(chatPayload);
      return makeJsonResponse({});
    });
  }

  it('shows degraded context notice when chat response is degraded', async () => {
    const fetchMock = baseFetchMock({
      response: 'Partial response due to degraded context',
      degraded: true,
      degradedReason: 'fleetgraph_context_history_query_timeout',
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithQueryClient(<FleetGraphGlobalLauncher />);
    fireEvent.click(screen.getByRole('button', { name: /FleetGraph Assistant/i }));
    fireEvent.change(screen.getByPlaceholderText('Type your message...'), { target: { value: 'status?' } });
    fireEvent.click(screen.getByLabelText('Send message'));

    await waitFor(() => {
      expect(screen.getByText(/FleetGraph used degraded context/i)).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  it('sends currentPath in chat request body', async () => {
    const fetchMock = baseFetchMock();
    vi.stubGlobal('fetch', fetchMock);

    renderWithQueryClient(<FleetGraphGlobalLauncher />);
    fireEvent.click(screen.getByRole('button', { name: /FleetGraph Assistant/i }));
    fireEvent.change(screen.getByPlaceholderText('Type your message...'), { target: { value: 'status?' } });
    fireEvent.click(screen.getByLabelText('Send message'));

    await waitFor(() => {
      const chatCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/api/fleetgraph/chat'));
      expect(chatCall).toBeDefined();
      const init = chatCall![1] as RequestInit;
      const requestBody = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(requestBody.currentPath).toBeDefined();
      expect(typeof requestBody.currentPath).toBe('string');
    });
  });

  it('uses workspace contextScope when no document context provided', async () => {
    const fetchMock = baseFetchMock();
    vi.stubGlobal('fetch', fetchMock);

    renderWithQueryClient(<FleetGraphGlobalLauncher />);
    fireEvent.click(screen.getByRole('button', { name: /FleetGraph Assistant/i }));
    fireEvent.change(screen.getByPlaceholderText('Type your message...'), { target: { value: 'status?' } });
    fireEvent.click(screen.getByLabelText('Send message'));

    await waitFor(() => {
      const chatCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/api/fleetgraph/chat'));
      expect(chatCall).toBeDefined();
      const init = chatCall![1] as RequestInit;
      const requestBody = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(requestBody.contextScope).toBe('workspace');
    });
  });

  it('shows pending approval list and approval detail with Reject/Approve on item click', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/csrf-token')) return makeJsonResponse({ token: 't' });
      if (url.includes('/api/fleetgraph/outputs')) return makeJsonResponse({ outputs: [] });
      if (url.includes('/api/fleetgraph/approvals/pending')) {
        return makeJsonResponse({
          approvals: [
            { id: 'a1', mutation_type: 'change_issue_state', status: 'pending', mutation_payload: {} },
          ],
        });
      }
      return makeJsonResponse({});
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithQueryClient(<FleetGraphGlobalLauncher />);
    fireEvent.click(screen.getByRole('button', { name: /FleetGraph Assistant/i }));

    await waitFor(() => {
      expect(screen.getByText(/Pending approvals/i)).toBeInTheDocument();
    });

    // Click the approval item to open detail view
    fireEvent.click(screen.getByText(/change issue state/i));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument();
    });
  });
});
