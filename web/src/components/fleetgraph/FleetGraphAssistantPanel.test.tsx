import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FleetGraphAssistantPanel } from './FleetGraphAssistantPanel';

describe('FleetGraphAssistantPanel', () => {
  it('sends message and renders assistant response', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { requiresMutationConfirm?: boolean };
      const payload = body.requiresMutationConfirm
        ? {
            response: 'Action proposed. Explicit confirm is required before mutation.',
            requiresConfirm: true,
          }
        : {
            response: 'Analyzed context for prompt: Move issue',
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

    render(<FleetGraphAssistantPanel documentId="d1" documentType="issue" />);
    fireEvent.change(screen.getByPlaceholderText('Type your message...'), { target: { value: 'Move issue' } });
    fireEvent.click(screen.getByLabelText('Send message'));

    await waitFor(() => {
      expect(screen.getByText('Analyzed context for prompt: Move issue')).toBeInTheDocument();
    });

    const lastRequest = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
    const requestBody = JSON.parse(String(lastRequest?.[1]?.body ?? '{}'));
    expect(requestBody.requiresMutationConfirm).toBe(false);
  });
});
