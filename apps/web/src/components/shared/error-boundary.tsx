import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ArrowClockwiseIcon, WarningCircleIcon } from '@phosphor-icons/react';

import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';

/**
 * The app had no error boundary, and React unmounts the whole tree when a
 * render throws. One bad row anywhere therefore produced a blank white page,
 * with no message, no way back, and no clue what happened -- and it came back
 * on refresh, which makes it look intermittent rather than reproducible.
 *
 * A boundary does not stop the throw. What it does is bound the damage to the
 * screen that threw, keep the shell and the navigation alive, and put the error
 * somewhere a person can read it and send it on. "Try again" re-mounts the
 * subtree, which is enough whenever the cause was the data a query happened to
 * return.
 *
 * A class rather than a hook because React offers no hook equivalent:
 * getDerivedStateFromError and componentDidCatch exist only on classes.
 */

interface Props {
  children: ReactNode;
  /** Remounting key: change it and a boundary showing an error resets. */
  resetKey?: string;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    // Rethrowing is not an option and swallowing is not either (CLAUDE.md §6).
    // The console is where this has to land until there is somewhere to send
    // it; the component stack is the half that says which screen threw.
    console.error('Unhandled render error', error, info.componentStack);
  }

  override componentDidUpdate(previous: Props) {
    if (this.state.error !== null && previous.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  override render() {
    const { error } = this.state;
    if (error === null) return this.props.children;

    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <WarningCircleIcon />
          </EmptyMedia>
          <EmptyTitle>This screen stopped responding</EmptyTitle>
          <EmptyDescription>
            Nothing you did was saved or lost -- the screen failed while drawing itself. Trying
            again reloads just this screen; if it keeps happening, the message below is the part
            worth reporting.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              this.setState({ error: null });
            }}
          >
            <ArrowClockwiseIcon data-icon="inline-start" />
            Try again
          </Button>
          <p className="text-muted-foreground max-w-prose text-xs break-words">{error.message}</p>
        </EmptyContent>
      </Empty>
    );
  }
}
