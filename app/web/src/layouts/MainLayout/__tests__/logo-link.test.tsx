import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/assets/icons/chevron-right.svg?react', () => ({ default: () => null }));
vi.mock('@/assets/icons/cloud.svg?react', () => ({ default: () => null }));
vi.mock('@/assets/icons/hexagon.svg?react', () => ({ default: () => null }));

import { MainLayout } from '@/layouts/MainLayout';

beforeAll(() => {
  window.HTMLElement.prototype.scrollTo = () => {};
});

const renderWithRouter = (initialPath = '/ml-perf') =>
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <MainLayout>
        <div>page content</div>
      </MainLayout>
    </MemoryRouter>
  );

describe('MainLayout logo link', () => {
  it('renders a link to the home page', () => {
    renderWithRouter('/ml-perf');
    const link = screen.getByRole('link', { name: /go to home page/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/');
  });

  it('link is present from /mmlu route', () => {
    renderWithRouter('/mmlu');
    expect(screen.getByRole('link', { name: /go to home page/i })).toBeInTheDocument();
  });

  it('link is present from /npu-eval/rngd route', () => {
    renderWithRouter('/npu-eval/rngd');
    expect(screen.getByRole('link', { name: /go to home page/i })).toBeInTheDocument();
  });

  it('link is present from /dashboard/gpu-realtime route', () => {
    renderWithRouter('/dashboard/gpu-realtime');
    expect(screen.getByRole('link', { name: /go to home page/i })).toBeInTheDocument();
  });
});
