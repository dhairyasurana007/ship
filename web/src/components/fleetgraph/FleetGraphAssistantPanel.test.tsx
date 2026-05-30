import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { FleetGraphAssistantPanel } from './FleetGraphAssistantPanel';

describe('FleetGraphAssistantPanel', () => {
  function renderWithQueryClient(ui: ReactElement) {
    const client = new QueryClient();
    return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  }

  it('sends message and renders assistant response in full-access mode', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { requiresMutationConfirm?: boolean };
      const payload = body.requiresMutationConfirm
        ? {
            response: 'Action proposed. Explicit confirm is required before mutation.',
            requiresConfirm: true,
          }
        : {
            response: '**Analyzed** context for prompt: Move issue',
            requiresConfirm: false,
          };
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => payload,
      } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithQueryClient(<FleetGraphAssistantPanel documentId="d1" documentType="issue" />);
    fireEvent.change(screen.getByLabelText('Agent access mode'), { target: { value: 'full_access' } });
    fireEvent.change(screen.getByPlaceholderText('Type your message...'), { target: { value: 'Move issue' } });
    fireEvent.click(screen.getByLabelText('Send message'));

    await waitFor(() => {
      expect(screen.getByText('Analyzed', { selector: 'strong' })).toBeInTheDocument();
      expect(screen.getByText(/context for prompt: Move issue/)).toBeInTheDocument();
    });

    const lastRequest = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
    const requestBody = JSON.parse(String(lastRequest?.[1]?.body ?? '{}'));
    expect(requestBody.requiresMutationConfirm).toBe(false);
  });

  it('requires mutation confirm by default in ask-permission mode', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { requiresMutationConfirm?: boolean };
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          response: body.requiresMutationConfirm
            ? 'Action proposed. Explicit confirm is required before mutation.'
            : 'Read-only response.',
          requiresConfirm: Boolean(body.requiresMutationConfirm),
        }),
      } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithQueryClient(<FleetGraphAssistantPanel documentId="d1" documentType="issue" />);
    fireEvent.change(screen.getByPlaceholderText('Type your message...'), { target: { value: 'delete this' } });
    fireEvent.click(screen.getByLabelText('Send message'));

    await waitFor(() => {
      expect(screen.getByText('Approve this requested action?')).toBeInTheDocument();
    });

    const lastRequest = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
    const requestBody = JSON.parse(String(lastRequest?.[1]?.body ?? '{}'));
    expect(requestBody.requiresMutationConfirm).toBe(true);
    expect(requestBody.accessMode).toBe('ask_permission');
  });
});
