import { useState } from 'react';
import { ShieldSlashIcon } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';
import { ApiError } from '@/lib/api/client';

import { useResetMfaForUser } from './use-mfa';

/**
 * REQ-B-09: the administrator's reset, for a phone that is gone and codes
 * that are gone with it. Confirmed, because it removes a second factor:
 * after it the password alone signs the person in, and if their role
 * requires the app they are made to set it up again at that sign-in.
 */
export function MfaResetButton({ userId, employeeId, name }: { userId: string; employeeId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const reset = useResetMfaForUser();
  const queryClient = useQueryClient();

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => { setOpen(true); }}>
        <ShieldSlashIcon data-icon="inline-start" />
        Reset two-step sign-in
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset two-step sign-in for {name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Their authenticator, recovery codes and remembered browsers are removed. The password alone signs them in next time; if their role requires the app, they set it up again then. This is written to the audit trail with your name.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row justify-end gap-2">
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              disabled={reset.isPending}
              onClick={(event) => {
                event.preventDefault();
                reset.mutate(userId, {
                  onSuccess: () => {
                    void queryClient.invalidateQueries({ queryKey: ['employees', 'access', employeeId] });
                    setOpen(false);
                    toast.add({ type: 'success', title: 'Two-step sign-in reset', description: `${name} signs in with the password alone next time.` });
                  },
                  onError: (error) => {
                    toast.add({ type: 'error', title: 'Could not reset it', description: error instanceof ApiError ? error.message : 'Try again.' });
                  },
                });
              }}
            >
              {reset.isPending ? <Spinner data-icon="inline-start" /> : <ShieldSlashIcon data-icon="inline-start" />}
              Reset
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
