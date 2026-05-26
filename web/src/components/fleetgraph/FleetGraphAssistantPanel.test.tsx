import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FleetGraphAssistantPanel } from './FleetGraphAssistantPanel';

describe('FleetGraphAssistantPanel', () => {
  it('renders response and confirm controls', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        json: async () => ({
          response: 'Action proposed. Explicit confirm is required before mutation.',
          requiresConfirm: true,
        }),
      }))
    );

    render(<FleetGraphAssistantPanel documentId="d1" documentType="issue" />);
    fireEvent.change(screen.getByPlaceholderText('Ask about this document context...'), { target: { value: 'Move issue' } });
    fireEvent.click(screen.getByText('Ask'));

    await waitFor(() => {
      expect(screen.getByText('Approve')).toBeInTheDocument();
      expect(screen.getByText('Reject')).toBeInTheDocument();
    });
  });
});

