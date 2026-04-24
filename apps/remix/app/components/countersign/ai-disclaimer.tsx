import { InfoIcon } from 'lucide-react';

import { cn } from '@documenso/ui/lib/utils';

export const AIDisclaimer = ({ className }: { className?: string }) => (
  <div
    className={cn(
      'flex items-start gap-2 rounded border bg-muted/50 p-3 text-sm text-muted-foreground',
      className,
    )}
  >
    <InfoIcon className="mt-0.5 h-4 w-4 shrink-0" />
    <span>This is an AI-generated review and is not legal advice.</span>
  </div>
);
