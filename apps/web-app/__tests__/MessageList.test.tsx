import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';

jest.mock('@/app/lib/api', () => ({
  apiFetch: jest.fn(),
}));

jest.mock('@/app/components/SendTipModal', () => ({
  __esModule: true,
  default: () => null,
}));

// jsdom does not implement IntersectionObserver
global.IntersectionObserver = class MockIntersectionObserver {
  observe = jest.fn();
  unobserve = jest.fn();
  disconnect = jest.fn();
  constructor(_cb: IntersectionObserverCallback, _opts?: IntersectionObserverInit) {}
} as unknown as typeof IntersectionObserver;

import MessageList from '@/app/components/MessageList';
import { apiFetch } from '@/app/lib/api';

const mockApiFetch = apiFetch as jest.Mock;

describe('MessageList', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('shows a loading spinner while fetching messages', () => {
    mockApiFetch.mockReturnValue(new Promise(() => {})); // never resolves

    const { container } = render(
      <MessageList channelId="ch1" currentUserId="user1" />,
    );

    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
  });

  test('shows empty-state message when the channel has no messages', async () => {
    mockApiFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [], next_cursor: null, has_more: false }),
    });

    render(<MessageList channelId="ch1" currentUserId="user1" />);

    await waitFor(() => {
      expect(
        screen.getByText('No messages yet — send the first one!'),
      ).toBeInTheDocument();
    });
  });

  test('renders messages returned by the API', async () => {
    const messages = [
      {
        message_id: 'msg-1',
        channel_id: 'ch1',
        author_id: 'user2',
        username: 'bob',
        content: 'Hey everyone!',
        created_at: new Date('2024-01-01T12:00:00Z').toISOString(),
      },
      {
        message_id: 'msg-2',
        channel_id: 'ch1',
        author_id: 'user1',
        username: 'alice',
        content: 'Hello Bob!',
        created_at: new Date('2024-01-01T12:01:00Z').toISOString(),
      },
    ];

    mockApiFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ messages, next_cursor: null, has_more: false }),
    });

    render(<MessageList channelId="ch1" currentUserId="user1" />);

    await waitFor(() => {
      expect(screen.getByText('Hey everyone!')).toBeInTheDocument();
      expect(screen.getByText('Hello Bob!')).toBeInTheDocument();
    });
  });

  test('renders optimistic (extra) messages passed as prop', async () => {
    mockApiFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [], next_cursor: null, has_more: false }),
    });

    const extraMessages = [
      {
        message_id: 'opt-1',
        channel_id: 'ch1',
        author_id: 'user1',
        username: 'alice',
        content: 'Optimistic message',
        created_at: new Date().toISOString(),
      },
    ];

    render(
      <MessageList
        channelId="ch1"
        currentUserId="user1"
        extraMessages={extraMessages}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Optimistic message')).toBeInTheDocument();
    });
  });
});
