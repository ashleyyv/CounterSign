import { useCallback, useState } from 'react';

import { ChevronDownIcon, ChevronUpIcon, Loader2Icon, SparklesIcon } from 'lucide-react';

import { PDF_VIEWER_CONTENT_SELECTOR } from '@documenso/lib/constants/pdf-viewer';
import { trpc } from '@documenso/trpc/react';
import { cn } from '@documenso/ui/lib/utils';
import { Button } from '@documenso/ui/primitives/button';

import { AIDisclaimer } from './ai-disclaimer';
import { useOptionalClauseHighlight } from './clause-highlight-context';
import { searchPdfText } from './search-pdf-text';

const EXPANDED_KEY = 'countersign:panel:expanded';
const analyzedKey = (id: string) => `countersign:analyzed:${id}`;

const assessmentStyles: Record<string, string> = {
  standard: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  unusual: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  review: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
};

export type IntelligencePanelProps = {
  envelopeId: string;
  recipientEmail?: string;
  /** Pass currentEnvelopeItem.data from EnvelopeRenderProvider to enable clause navigation. */
  pdfData?: Uint8Array | string;
};

export const IntelligencePanel = ({
  envelopeId,
  recipientEmail,
  pdfData,
}: IntelligencePanelProps) => {
  const highlightCtx = useOptionalClauseHighlight();

  const [expanded, setExpanded] = useState(() => {
    try {
      return localStorage.getItem(EXPANDED_KEY) !== 'false';
    } catch {
      return true;
    }
  });

  // Whether this envelope has ever been analysed (persisted across visits)
  const [analyzed, setAnalyzed] = useState(() => {
    try {
      return localStorage.getItem(analyzedKey(envelopeId)) === 'true';
    } catch {
      return false;
    }
  });

  const [navigatingClause, setNavigatingClause] = useState<string | null>(null);

  const toggleExpanded = () => {
    setExpanded((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(EXPANDED_KEY, String(next));
      } catch {
        void 0;
      }
      return next;
    });
  };

  const triggerAnalysis = () => {
    setAnalyzed(true);
    try {
      localStorage.setItem(analyzedKey(envelopeId), 'true');
    } catch {
      void 0;
    }
  };

  const { data, isLoading } = trpc.countersign.analyzeEnvelope.useQuery(
    { envelopeId, recipientEmail },
    { enabled: analyzed && !!envelopeId },
  );

  const handleClauseClick = useCallback(
    async (clauseText: string) => {
      if (!pdfData) return;
      setNavigatingClause(clauseText);
      try {
        const pages = await searchPdfText(pdfData, clauseText);
        if (pages.length > 0) {
          highlightCtx?.setActiveHighlight({ clauseText, pages });
          // Trigger the existing MutationObserver scroll bridge
          const el = document.querySelector(PDF_VIEWER_CONTENT_SELECTOR);
          el?.setAttribute('data-scroll-to-page', String(pages[0].page));
        }
      } catch (err) {
        console.error('[countersign] clause navigation failed:', err);
      } finally {
        setNavigatingClause(null);
      }
    },
    [pdfData, highlightCtx],
  );

  const canNavigate = !!pdfData;

  return (
    <div className="overflow-hidden rounded-lg border border-violet-200 bg-card shadow-sm dark:border-violet-800/40">
      {/* ── Header ────────────────────────────────────────────────── */}
      <button
        onClick={toggleExpanded}
        className="flex w-full items-center justify-between gap-2 bg-gradient-to-r from-violet-50 to-indigo-50 px-4 py-3 text-left transition-colors hover:from-violet-100 hover:to-indigo-100 dark:from-violet-950/40 dark:to-indigo-950/40 dark:hover:from-violet-900/40 dark:hover:to-indigo-900/40"
      >
        <div className="flex items-center gap-2">
          <SparklesIcon className="h-4 w-4 shrink-0 text-violet-600 dark:text-violet-400" />
          <span className="text-sm font-semibold text-foreground">Document Review</span>
          {data?.documentType && (
            <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
              {data.documentType}
            </span>
          )}
        </div>
        {expanded ? (
          <ChevronUpIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronDownIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
      </button>

      {/* ── Body ─────────────────────────────────────────────────── */}
      {expanded && (
        <div className="p-4">
          {/* Trigger state */}
          {!analyzed && (
            <div className="flex flex-col items-center gap-3 py-2 text-center">
              <p className="text-xs text-muted-foreground">
                Get an AI-powered summary and clause analysis of this document.
              </p>
              <Button size="sm" onClick={triggerAnalysis} className="gap-1.5">
                <SparklesIcon className="h-3.5 w-3.5" />
                Analyze Document
              </Button>
            </div>
          )}

          {/* Loading */}
          {analyzed && isLoading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2Icon className="h-4 w-4 animate-spin" />
              <span>Analysing document…</span>
            </div>
          )}

          {/* Error / unavailable */}
          {analyzed && !isLoading && !data && (
            <p className="text-xs text-muted-foreground">
              Analysis unavailable. Ensure an Anthropic API key is configured on the server.
            </p>
          )}

          {/* Results */}
          {analyzed && !isLoading && data && (
            <div className="flex flex-col gap-4">
              <AIDisclaimer />

              {/* Summary */}
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Summary
                </p>
                <ul className="flex flex-col gap-1">
                  {data.summary.map((point, i) => (
                    <li key={i} className="flex gap-2 text-sm">
                      <span className="mt-0.5 shrink-0 text-muted-foreground">•</span>
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Flagged Clauses */}
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Flagged Clauses
                </p>
                {(data.flaggedClauses ?? []).length === 0 ? (
                  <p className="text-xs text-muted-foreground">No clauses flagged.</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {(data.flaggedClauses ?? []).map((clause, i) => (
                      <button
                        key={i}
                        type="button"
                        disabled={!canNavigate || navigatingClause === clause.text}
                        onClick={async () => {
                          await handleClauseClick(clause.text);
                        }}
                        className={cn(
                          'group w-full rounded border p-3 text-left transition-colors',
                          canNavigate
                            ? 'cursor-pointer hover:border-violet-300 hover:bg-violet-50/50 dark:hover:border-violet-700 dark:hover:bg-violet-950/20'
                            : 'cursor-default',
                        )}
                      >
                        <div className="mb-1 flex items-center gap-2">
                          <span className="text-sm font-medium">{clause.clause}</span>
                          <span
                            className={cn(
                              'rounded-full px-2 py-0.5 text-xs font-medium',
                              assessmentStyles[clause.assessment] ??
                                'bg-muted text-muted-foreground',
                            )}
                          >
                            {clause.assessment}
                          </span>
                          {navigatingClause === clause.text && (
                            <Loader2Icon className="ml-auto h-3 w-3 animate-spin text-muted-foreground" />
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground">{clause.note}</p>
                        {canNavigate && navigatingClause !== clause.text && (
                          <p className="mt-1.5 text-xs font-medium text-violet-600 opacity-0 transition-opacity group-hover:opacity-100 dark:text-violet-400">
                            Jump to section ↗
                          </p>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* What Changed */}
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
      )}
    </div>
  );
};
