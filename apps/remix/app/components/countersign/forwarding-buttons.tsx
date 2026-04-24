import { useState } from 'react';

import { CheckIcon } from 'lucide-react';

import { trpc } from '@documenso/trpc/react';
import { Button } from '@documenso/ui/primitives/button';

type ForwardingButtonsProps = {
  envelopeId: string;
};

export const ForwardingButtons = ({ envelopeId }: ForwardingButtonsProps) => {
  const [sentTargets, setSentTargets] = useState<Set<string>>(new Set());

  const { data: preferences } = trpc.countersign.getSignerPreferences.useQuery();

  const { mutate: forwardDocument, isPending } = trpc.countersign.forwardDocument.useMutation({
    onSuccess: (_data, variables) => {
      setSentTargets((prev) => new Set(prev).add(variables.targetEmail));
    },
  });

  const targets = (preferences?.targets as Array<{ label: string; email: string }> | null) ?? [];

  if (targets.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium">Forward this document</p>
      {targets.map((target) => {
        const sent = sentTargets.has(target.email);
        return (
          <Button
            key={target.email}
            variant="outline"
            size="sm"
            loading={isPending && !sent}
            disabled={sent}
            onClick={() =>
              forwardDocument({
                envelopeId,
                targetEmail: target.email,
                targetLabel: target.label,
              })
            }
          >
            {sent ? (
              <>
                <CheckIcon className="mr-2 h-4 w-4 text-green-600" />
                Sent to {target.label}
              </>
            ) : (
              `Send to ${target.label}`
            )}
          </Button>
        );
      })}
    </div>
  );
};
