// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import '../../../test/setup';
import { Markdown } from './index';

describe('Markdown (SV-05)', () => {
  it('rendert Markdown, aber kein rohes HTML', () => {
    const { container } = render(
      <Markdown>
        {
          '**fett** <img src=x onerror=alert(1)><script>alert(1)</script> [Link](https://example.org)'
        }
      </Markdown>,
    );
    expect(screen.getByText('fett').tagName).toBe('STRONG');
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(screen.getByRole('link', { name: 'Link' })).toHaveAttribute(
      'rel',
      'noopener noreferrer',
    );
  });
});
