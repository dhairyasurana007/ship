import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { FleetGraphGlobalLauncher } from './FleetGraphGlobalLauncher';

describe('FleetGraphGlobalLauncher', () => {
  function renderWithQueryClient(ui: ReactElement) {
    const client = new QueryClient();
    return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  }

  it('shows degraded context notice when chat response is degraded', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/csrf-token')) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ token: 't' }),
        } as Response;
      }
      if (url.includes('/api/fleetgraph/outputs')) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ outputs: [] }),
        } as Response;
      }
      if (url.includes('/api/fleetgraph/approvals/pending')) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ approvals: [] }),
        } as Response;
      }
      if (url.includes('/api/fleetgraph/chat')) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            response: 'Partial response due to degraded context',
            degraded: true,
            degradedReason: 'fleetgraph_context_history_query_timeout',
          }),
        } as Response;
      }
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({}),
      } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithQueryClient(<FleetGraphGlobalLauncher />);
    fireEvent.click(screen.getByRole('button', { name: /open fleetgraph assistant window/i }));
    fireEvent.change(screen.getByPlaceholderText('Type your message...'), { target: { value: 'status?' } });
    fireEvent.click(screen.getByRole('button', { name: /send message/i }));

    await waitFor(() => {
      expect(screen.getByText(/FleetGraph used degraded context/i)).toBeInTheDocument();
    });
  });

  it('shows reject/execute only when explicitly recommended', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/csrf-token')) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ token: 't' }),
        } as Response;
      }
      if (url.includes('/api/fleetgraph/outputs')) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ outputs: [] }),
        } as Response;
      }
      if (url.includes('/api/fleetgraph/approvals/pending')) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            approvals: [
              { id: 'a1', mutation_type: 'change_issue_state', status: 'pending', mutation_payload: { recommendedAction: 'reject' } },
              { id: 'a2', mutation_type: 'move_issue_sprint', status: 'approved', mutation_payload: { recommended_action: 'execute' } },
              { id: 'a3', mutation_type: 'reassign_issue', status: 'pending', mutation_payload: {} },
            ],
          }),
        } as Response;
      }
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({}),
      } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithQueryClient(<FleetGraphGlobalLauncher />);
    fireEvent.click(screen.getByRole('button', { name: /open fleetgraph assistant window/i }));

    await waitFor(() => {
      expect(screen.getByText(/Pending approvals/i)).toBeInTheDocument();
    });

    expect(screen.getAllByRole('button', { name: 'Approve' })).toHaveLength(3);
    expect(screen.getAllByRole('button', { name: 'Reject' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Execute' })).toHaveLength(1);
  });
});
