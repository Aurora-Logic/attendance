import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuTrigger } from './dropdown-menu';

/**
 * Base UI's GroupLabel throws outside a Group, and the throw reaches the
 * screen's ErrorBoundary. Two menus in this product have crashed a screen
 * that way. The wrapper guards the class: a loose label renders.
 */
describe('DropdownMenuLabel outside a group', () => {
  it('renders instead of throwing MenuGroupContext is missing', () => {
    render(
      <DropdownMenu open>
        <DropdownMenuTrigger render={<button type="button" />}>Open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel>Loose label</DropdownMenuLabel>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    expect(screen.getByText('Loose label')).not.toBeNull();
  });
});
