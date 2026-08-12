import type { FormEvent, ReactNode } from 'react';

interface FormProps {
  /** Called after the native event is cancelled, so callers cannot forget to. */
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  children: ReactNode;
  className?: string;
  'aria-labelledby'?: string;
}

/**
 * The `<form>` element, composed once.
 *
 * CLAUDE.md §3 rule 1 forbids raw form elements in feature code and directs a
 * missing primitive to be composed once in components/shared rather than
 * re-invented per screen. This is that composition. shadcn's `form` item does
 * not exist in the Base UI styles - `Field` and `FieldGroup` replace the
 * labelling and layout half of it - but neither renders a `<form>`, and the
 * element itself is not decoration: it is what gives Enter-to-submit, browser
 * autofill and password-manager integration.
 *
 * `noValidate` is deliberate. The browser's own bubbles cannot be styled, do
 * not match the rest of the interface, and appear before our own validation
 * has run; the schema is the single source of what is valid.
 */
export function Form({ onSubmit, children, className, ...rest }: FormProps) {
  return (
    // eslint-disable-next-line no-restricted-syntax -- the sanctioned composition; see above
    <form
      noValidate
      className={className}
      onSubmit={(event) => {
        // Prevented here so no caller can omit it and get a full page reload
        // that silently discards what the user typed.
        event.preventDefault();
        onSubmit(event);
      }}
      {...rest}
    >
      {children}
    </form>
  );
}
