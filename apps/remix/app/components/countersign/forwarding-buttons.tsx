import { useState } from 'react';

import { CheckIcon, Forward } from 'lucide-react';

import { trpc } from '@documenso/trpc/react';
import { Button } from '@documenso/ui/primitives/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@documenso/ui/primitives/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@documenso/ui/primitives/tooltip';

type ForwardingDropdownProps = {
  envelopeId: string;
};

export const ForwardingDropdown = ({ envelopeId }: ForwardingDropdownProps) => {
  const [sentTarget, setSentTarget] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const { data: preferences } = trpc.countersign.getSignerPreferences.useQuery();

  const { mutate: forwardDocument, isPending } = trpc.countersign.forwardDocument.useMutation({
    onSuccess: (_data, variables) => {
      setSentTarget(variables.targetEmail);
      setOpen(false);
      setTimeout(() => setSentTarget(null), 3000);
    },
  });

  const targets = (preferences?.targets as Array<{ label: string; email: string }> | null) ?? [];
  const hasTargets = targets.length > 0;

  const sentLabel = sentTarget
    ? (targets.find((t) => t.email === sentTarget)?.label ?? sentTarget)
    : null;

  if (!hasTargets) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex cursor-default">
              <Button variant="outline" disabled className="pointer-events-none">
                <Forward className="mr-2 h-5 w-5" />
                Forward signed copy
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>
            Set up forwarding in Settings → Forwarding to use this feature
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" loading={isPending} disabled={isPending}>
          {sentLabel ? (
            <>
              <CheckIcon className="mr-2 h-5 w-5 text-green-600" />
              Sent to {sentLabel}
            </>
          ) : (
            <>
              <Forward className="mr-2 h-5 w-5" />
              Forward signed copy
            </>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {targets.map((target) => (
          <DropdownMenuItem
            key={target.email}
            onSelect={() =>
              forwardDocument({
                envelopeId,
                targetEmail: target.email,
                targetLabel: target.label,
              })
            }
          >
            {target.label || target.email}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
