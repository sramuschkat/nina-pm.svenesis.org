// @vitest-environment jsdom
/** `useUniformWidth` (AP-26i/26j): breitestes Element als CSS-Variable am Bereich. */
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useUniformWidth } from './use-uniform-width';

function Area({ names }: { names: string[] }) {
  const ref = useUniformWidth('.chip', '--chip-w');
  return (
    <div ref={ref} data-testid="area">
      {names.map((n) => (
        <span key={n} className="chip" data-w={String(n.length * 10)}>
          {n}
        </span>
      ))}
    </div>
  );
}

describe('useUniformWidth', () => {
  it('setzt die Breite des breitesten Elements als CSS-Variable', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      return { width: Number(this.dataset.w ?? 0) } as DOMRect;
    });
    const { getByTestId } = render(<Area names={['Ha', 'LUMI', 'R']} />);
    expect(getByTestId('area').style.getPropertyValue('--chip-w')).toBe('40px');
    vi.restoreAllMocks();
  });
});
