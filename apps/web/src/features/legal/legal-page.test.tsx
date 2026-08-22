import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import { LEGAL_DOCUMENTS } from './legal-content';
import { LegalPage } from './legal-page';
import { legalRoute } from './legal-route';

describe('LegalPage', () => {
  it('renders each document with its title as the h1, every section, and the way to the other', () => {
    for (const document of Object.values(LEGAL_DOCUMENTS)) {
      const { unmount } = render(
        <MemoryRouter>
          <LegalPage slug={document.slug} />
        </MemoryRouter>,
      );
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(document.title);
      expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(document.sections.length);
      expect(document.sections.every((section) => section.paragraphs.length > 0)).toBe(true);
      // Buttons rendered as Links keep role="button" (Base UI, nativeButton
      // off), so they are found by that role and checked for where they go.
      const other = document.slug === 'terms' ? 'Privacy Policy' : 'Terms and Conditions';
      expect(screen.getByRole('button', { name: other }).getAttribute('href')).toBe(document.slug === 'terms' ? '/legal/privacy' : '/legal/terms');
      expect(screen.getByRole('button', { name: /Sign in/u }).getAttribute('href')).toBe('/');
      unmount();
    }
  });

  it('says so at an address that is not a document', () => {
    render(
      <MemoryRouter>
        <LegalPage slug="cookies" />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Nothing at this address');
  });

  it('matches only /legal/ paths', () => {
    expect(legalRoute('/legal/terms')).toBe('terms');
    expect(legalRoute('/legal/privacy/')).toBe('privacy');
    expect(legalRoute('/reports')).toBeNull();
  });
});
