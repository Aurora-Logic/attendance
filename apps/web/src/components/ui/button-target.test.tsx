import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Button } from './button';
import { DropdownMenu, DropdownMenuTrigger } from './dropdown-menu';
import { Popover, PopoverTrigger } from './popover';
import { Sheet, SheetTrigger } from './sheet';

/**
 * The coarse-pointer floor in index.css leaves a Button out because the
 * Button grows its own 44px target. It keys on data-own-target, not on
 * data-slot, because a trigger's `render` prop replaces the Button's
 * data-slot with its own: the saved-views and column-chooser buttons
 * carried data-slot="popover-trigger" and rendered as 44px boxes. This pins
 * both facts so the next trigger cannot reintroduce the slab.
 */
describe('Button under a trigger render prop', () => {
  it('loses its data-slot to the trigger but keeps data-own-target', () => {
    const { container } = render(
      <>
        <Sheet><SheetTrigger render={<Button aria-label="sheet" />} /></Sheet>
        <Popover><PopoverTrigger render={<Button aria-label="popover" />} /></Popover>
        <DropdownMenu><DropdownMenuTrigger render={<Button aria-label="menu" />} /></DropdownMenu>
        <Button aria-label="plain" />
      </>,
    );
    const buttons = Array.from(container.querySelectorAll('button'));
    expect(buttons.map((b) => b.getAttribute('data-slot'))).toEqual(['sheet-trigger', 'popover-trigger', 'dropdown-menu-trigger', 'button']);
    expect(buttons.every((b) => b.hasAttribute('data-own-target'))).toBe(true);
  });
});
