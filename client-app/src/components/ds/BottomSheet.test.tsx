import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BottomSheet } from './BottomSheet';

describe('BottomSheet', () => {
  it('renders nothing when closed', () => {
    render(
      <BottomSheet isOpen={false} onClose={() => {}}>
        <p>Body</p>
      </BottomSheet>,
    );
    expect(screen.queryByText('Body')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders children inside an a11y dialog when open', () => {
    render(
      <BottomSheet isOpen onClose={() => {}}>
        <p>Body</p>
      </BottomSheet>,
    );
    expect(screen.getByText('Body')).toBeVisible();
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
  });

  it('calls onClose when the backdrop is tapped', async () => {
    const onClose = vi.fn();
    render(
      <BottomSheet isOpen onClose={onClose}>
        <p>Body</p>
      </BottomSheet>,
    );
    const backdrop = document.querySelector('[aria-hidden="true"]');
    expect(backdrop).not.toBeNull();
    await userEvent.click(backdrop as Element);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('renders a pinned footer when provided', () => {
    render(
      <BottomSheet isOpen onClose={() => {}} pinnedFooter={<button>Confirm</button>}>
        <p>Body</p>
      </BottomSheet>,
    );
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument();
  });
});
