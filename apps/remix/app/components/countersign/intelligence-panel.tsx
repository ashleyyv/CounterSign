import { useState } from 'react';

import { ChevronDownIcon, ChevronUpIcon, Loader2Icon } from 'lucide-react';

import { trpc } from '@documenso/trpc/react';
import { cn } from '@documenso/ui/lib/utils';

import { AIDisclaimer } from './ai-disclaimer';

type IntelligencePanelProps = {
  envelopeId: string;
  recipientEmail?: string;
};

const STORAGE_KEY = 'countersign:panel:expanded';

const assessmentStyles: Record<string, string> = {
  standard: 'bg-green-100 text-green-800',
  unusual: 'bg-yellow-100 text-yellow-800',
  review: 'bg-red-100 text-red-800',
};

export const IntelligencePanel = ({ envelopeId, recipientEmail }: IntelligencePanelProps) => {
  const [expanded, setExpanded] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) !== 'false';
    } catch {
      return true;
    }
  });

  const toggleExpanded = () => {
    setExpanded((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        void 0;
      }
      return next;
    });
  };

  const { data, isLoading } = trpc.countersign.analyzeEnvelope.useQuery(
    { envelopeId, recipientEmail },
    { enabled: !!envelopeId },
  );

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border bg-card p-4 text-sm text-muted-foreground">
        <Loader2Icon className="h-4 w-4 animate-spin" />
        <span>Analysing document…</span>
      </div>
    );
  }

  if (!data) {
    return null;
  }

  return (
    <div className="rounded-lg border bg-card p-4">
      <button
        onClick={toggleExpanded}
        className="flex w-full items-center justify-between text-left"
      >
        <span className="text-sm font-semibold">Document Review</span>
        {expanded ? (
          <ChevronUpIcon className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDownIcon className="h-4 w-4 text-muted-foreground" />
        )}
      </button>

      {expanded && (
        <div className="mt-4 flex flex-col gap-4">
          <AIDisclaimer />

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Summary
            </p>
            <ul className="flex flex-col gap-1">
              {data.summary.map((point, i) => (
                <li key={i} className="flex gap-2 text-sm">
                  <span className="mt-0.5 text-muted-foreground">•</span>
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          </div>

          {data.flaggedClauses.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Flagged Clauses
              </p>
              <div className="flex flex-col gap-3">
                {data.flaggedClauses.map((clause, i) => (
                  <div key={i} className="rounded border p-3">
                    <div className="mb-1 flex items-center gap-2">
                      <span className="text-sm font-medium">{clause.clause}</span>
                      <span
                        className={cn(
                          'rounded-full px-2 py-0.5 text-xs font-medium',
                          assessmentStyles[clause.assessment] ?? 'bg-muted text-muted-foreground',
                        )}
                      >
                        {clause.assessment}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">{clause.note}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {data.diff && data.diff.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                What Changed
              </p>
              <div className="flex flex-col gap-2">
                {data.diff.map((item, i) => (
                  <div key={i} className="text-sm">
                    <span className="font-medium">{item.clause}:</span>{' '}
                    <span className="text-muted-foreground">{item.change}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
