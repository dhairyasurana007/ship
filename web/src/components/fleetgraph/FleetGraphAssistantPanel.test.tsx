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

  function makeJsonResponse(data: object): Response {
    return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
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

  it('sends message and renders assistant response in full-access mode', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/csrf-token')) return makeJsonResponse({ token: 't' });
      const body = JSON.parse(String(init?.body ?? '{}')) as { requiresMutationConfirm?: boolean };
      const payload = body.requiresMutationConfirm
        ? { response: 'Action proposed. Explicit confirm is required before mutation.', requiresConfirm: true }
        : { response: 'Analyzed context for prompt: Move issue', requiresConfirm: false };
      return makeSseResponse(payload);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithQueryClient(<FleetGraphAssistantPanel documentId="d1" documentType="issue" />);
    fireEvent.change(screen.getByLabelText('Agent access mode'), { target: { value: 'full_access' } });
    fireEvent.change(screen.getByPlaceholderText('Type your message...'), { target: { value: 'Move issue' } });
    fireEvent.click(screen.getByLabelText('Send message'));

    await waitFor(() => {
      expect(screen.getByText(/Analyzed context for prompt: Move issue/)).toBeInTheDocument();
    }, { timeout: 3000 });

    const chatCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/api/fleetgraph/chat'));
    const requestBody = JSON.parse(String(chatCall?.[1]?.body ?? '{}'));
    expect(requestBody.requiresMutationConfirm).toBe(false);
  });

  it('requires mutation confirm by default in ask-permission mode', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/csrf-token')) return makeJsonResponse({ token: 't' });
      const body = JSON.parse(String(init?.body ?? '{}')) as { requiresMutationConfirm?: boolean };
      return makeSseResponse({
        response: body.requiresMutationConfirm
          ? 'Action proposed. Explicit confirm is required before mutation.'
          : 'Read-only response.',
        requiresConfirm: Boolean(body.requiresMutationConfirm),
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithQueryClient(<FleetGraphAssistantPanel documentId="d1" documentType="issue" />);
    fireEvent.change(screen.getByPlaceholderText('Type your message...'), { target: { value: 'delete this' } });
    fireEvent.click(screen.getByLabelText('Send message'));

    await waitFor(() => {
      expect(screen.getByText('Approve this requested action?')).toBeInTheDocument();
    }, { timeout: 3000 });

    const chatCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/api/fleetgraph/chat'));
    const requestBody = JSON.parse(String(chatCall?.[1]?.body ?? '{}'));
    expect(requestBody.requiresMutationConfirm).toBe(true);
    expect(requestBody.accessMode).toBe('ask_permission');
  });
});
