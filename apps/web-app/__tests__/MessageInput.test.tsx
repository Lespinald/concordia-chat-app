import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

jest.mock('@/app/lib/api', () => ({
  apiFetch: jest.fn(),
}));

jest.mock('@/app/components/SendTipModal', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(() => ({ push: jest.fn() })),
  usePathname: jest.fn(() => '/app/servers/srv1/channels/ch1'),
}));

// jsdom does not implement IntersectionObserver or WebSocket
global.IntersectionObserver = class MockIntersectionObserver {
  observe = jest.fn();
  unobserve = jest.fn();
  disconnect = jest.fn();
  constructor(_cb: IntersectionObserverCallback, _opts?: IntersectionObserverInit) {}
} as unknown as typeof IntersectionObserver;

const mockWsClose = jest.fn();
global.WebSocket = jest.fn().mockImplementation(() => ({
  readyState: 1,
  close: mockWsClose,
  send: jest.fn(),
  onopen: null,
  onmessage: null,
  onclose: null,
  onerror: null,
})) as unknown as typeof WebSocket;

// ws-token endpoint (direct fetch, not apiFetch)
global.fetch = jest.fn().mockResolvedValue({
  ok: true,
  json: async () => ({ token: 'test-ws-token' }),
}) as unknown as typeof fetch;

import MessageInput from '@/app/components/MessageInput';
import ChannelView from '@/app/components/ChannelView';
import { apiFetch } from '@/app/lib/api';

const mockApiFetch = apiFetch as jest.Mock;

// ────────────────────────────────────────────────────────────────────────────
// MessageInput component: basic behaviour
// ────────────────────────────────────────────────────────────────────────────
describe('MessageInput', () => {
  test('renders textarea and send button', () => {
    render(
      <MessageInput channelId="ch1" channelName="general" onSend={jest.fn()} />,
    );

    expect(screen.getByPlaceholderText('Message #general')).toBeInTheDocument();
    expect(screen.getByTitle('Send message')).toBeInTheDocument();
  });

  test('send button is disabled when textarea is empty', () => {
    render(
      <MessageInput channelId="ch1" channelName="general" onSend={jest.fn()} />,
    );

    expect(screen.getByTitle('Send message')).toBeDisabled();
  });

  test('send button becomes enabled after typing', async () => {
    const user = userEvent.setup();
    render(
      <MessageInput channelId="ch1" channelName="general" onSend={jest.fn()} />,
    );

    await user.type(screen.getByPlaceholderText('Message #general'), 'Hello!');

    expect(screen.getByTitle('Send message')).not.toBeDisabled();
  });

  test('calls onSend with message content when Enter is pressed', async () => {
    const user = userEvent.setup();
    const onSend = jest.fn().mockResolvedValue(undefined);
    render(
      <MessageInput channelId="ch1" channelName="general" onSend={onSend} />,
    );

    await user.type(screen.getByPlaceholderText('Message #general'), 'Hello world!');
    await user.keyboard('{Enter}');

    expect(onSend).toHaveBeenCalledWith('Hello world!');
  });

  test('calls onSend with message content when Send button is clicked', async () => {
    const user = userEvent.setup();
    const onSend = jest.fn().mockResolvedValue(undefined);
    render(
      <MessageInput channelId="ch1" channelName="general" onSend={onSend} />,
    );

    await user.type(screen.getByPlaceholderText('Message #general'), 'Test message');
    await user.click(screen.getByTitle('Send message'));

    expect(onSend).toHaveBeenCalledWith('Test message');
  });

  test('clears textarea after message is sent', async () => {
    const user = userEvent.setup();
    const onSend = jest.fn().mockResolvedValue(undefined);
    render(
      <MessageInput channelId="ch1" channelName="general" onSend={onSend} />,
    );

    const textarea = screen.getByPlaceholderText('Message #general');
    await user.type(textarea, 'Hello!');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(textarea).toHaveValue('');
    });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// ChannelView: send message calls correct API + optimistic update
// ────────────────────────────────────────────────────────────────────────────
function setupChannelMocks(
  sendResponse?: () => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>,
) {
  mockApiFetch.mockImplementation((path: string) => {
    if (path === '/servers/srv1/channels') {
      return Promise.resolve({
        ok: true,
        json: async () => [
          { channel_id: 'ch1', name: 'general', type: 'TEXT', server_id: 'srv1' },
        ],
      });
    }
    if (path === '/auth/me') {
      return Promise.resolve({
        ok: true,
        json: async () => ({ user_id: 'user1', username: 'alice' }),
      });
    }
    if (path.startsWith('/channels/ch1/messages?')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ messages: [], next_cursor: null, has_more: false }),
      });
    }
    // POST /channels/ch1/messages
    if (sendResponse) return sendResponse();
    return Promise.resolve({
      ok: true,
      status: 201,
      json: async () => ({
        message_id: 'real-1',
        channel_id: 'ch1',
        author_id: 'user1',
        content: 'test',
        created_at: new Date().toISOString(),
      }),
    });
  });
}

describe('ChannelView – send message', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ token: 'test-ws-token' }),
    });
  });

  test('calls the correct API endpoint when a message is sent', async () => {
    const user = userEvent.setup();
    setupChannelMocks();

    render(<ChannelView serverId="srv1" channelId="ch1" />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Message #general')).toBeInTheDocument();
    });

    await user.type(screen.getByPlaceholderText('Message #general'), 'Hello API!');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(
        '/channels/ch1/messages',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ content: 'Hello API!' }),
        }),
      );
    });
  });

  test('shows message optimistically before the API response arrives', async () => {
    const user = userEvent.setup();

    // Never resolves — simulates a slow network
    let resolveMsg!: (v: unknown) => void;
    const slowSend = new Promise((res) => { resolveMsg = res; });
    setupChannelMocks(() => slowSend as ReturnType<typeof setupChannelMocks>);

    render(<ChannelView serverId="srv1" channelId="ch1" />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Message #general')).toBeInTheDocument();
    });

    await user.type(screen.getByPlaceholderText('Message #general'), 'Optimistic!');
    await user.keyboard('{Enter}');

    // Message must appear immediately, before the API resolves
    expect(screen.getByText('Optimistic!')).toBeInTheDocument();

    // Clean up – resolve the pending promise so no React state-update warnings
    act(() => {
      resolveMsg({
        ok: true,
        status: 201,
        json: async () => ({
          message_id: 'r1',
          channel_id: 'ch1',
          author_id: 'user1',
          content: 'Optimistic!',
          created_at: new Date().toISOString(),
        }),
      });
    });
  });
});
