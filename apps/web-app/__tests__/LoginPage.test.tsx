import React from 'react';
import { render, screen } from '@testing-library/react';

jest.mock('@/app/actions/auth', () => ({
  loginAction: jest.fn(),
}));

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children }: { href: string; children: React.ReactNode }) =>
    React.createElement('a', { href }, children),
}));

jest.mock('react', () => ({
  ...jest.requireActual('react'),
  useActionState: jest.fn(),
}));

import LoginPage from '@/app/login/page';
import { useActionState } from 'react';

const mockUseActionState = useActionState as jest.Mock;

describe('LoginPage', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  test('renders form with required email and password fields (empty-field validation)', () => {
    mockUseActionState.mockReturnValue([undefined, jest.fn(), false]);
    render(<LoginPage />);

    const emailInput = screen.getByPlaceholderText('you@example.com');
    const passwordInput = screen.getByPlaceholderText('••••••••');

    expect(emailInput).toHaveAttribute('type', 'email');
    expect(emailInput).toHaveAttribute('required');
    expect(passwordInput).toHaveAttribute('type', 'password');
    expect(passwordInput).toHaveAttribute('required');
  });

  test('displays error message when action returns a server error', () => {
    mockUseActionState.mockReturnValue([
      { error: 'Email and password are required.' },
      jest.fn(),
      false,
    ]);
    render(<LoginPage />);

    expect(screen.getByText('Email and password are required.')).toBeInTheDocument();
  });

  test('displays network/server error returned from the backend', () => {
    mockUseActionState.mockReturnValue([
      { error: 'Could not reach the server. Please try again.' },
      jest.fn(),
      false,
    ]);
    render(<LoginPage />);

    expect(
      screen.getByText('Could not reach the server. Please try again.')
    ).toBeInTheDocument();
  });

  test('disables submit button and shows loading text while pending', () => {
    mockUseActionState.mockReturnValue([undefined, jest.fn(), true]);
    render(<LoginPage />);

    const button = screen.getByRole('button', { name: /signing in/i });
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent('Signing in…');
  });
});
