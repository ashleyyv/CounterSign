import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ChevronDownIcon, ChevronUpIcon, Loader2Icon, SparklesIcon } from 'lucide-react';

import { PDF_VIEWER_CONTENT_SELECTOR } from '@documenso/lib/constants/pdf-viewer';
import type { FlaggedClauseV2 } from '@documenso/lib/types/countersign';
import { trpc } from '@documenso/trpc/react';
import { cn } from '@documenso/ui/lib/utils';
import { Button } from '@documenso/ui/primitives/button';
import { Separator } from '@documenso/ui/primitives/separator';
import { useToast } from '@documenso/ui/primitives/use-toast';

import { AIDisclaimer } from './ai-disclaimer';
import { useOptionalClauseHighlight } from './clause-highlight-context';
import { searchPdfBySectionNumber, searchPdfText } from './search-pdf-text';

const EXPANDED_KEY = 'countersign:panel:expanded';
const analyzedKey = (id: string) => `countersign:analyzed:${id}`;

const SEVERITY_ORDER = { severe: 0, notable: 1, 'worth-reading': 2 } as const;

const severityConfig = {
  severe: {
    pill: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
    border: 'border-red-200 dark:border-red-800/60',
    hover:
      'hover:border-red-300 hover:bg-red-50/40 dark:hover:border-red-700 dark:hover:bg-red-950/20',
    jumpLink: 'text-red-600 dark:text-red-400',
  },
  notable: {
    pill: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
    border: 'border-amber-200 dark:border-amber-800/60',
    hover:
      'hover:border-amber-300 hover:bg-amber-50/40 dark:hover:border-amber-700 dark:hover:bg-amber-950/20',
    jumpLink: 'text-amber-600 dark:text-amber-400',
  },
  'worth-reading': {
    pill: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
    border: 'border-blue-200 dark:border-blue-800/60',
    hover:
      'hover:border-blue-300 hover:bg-blue-50/40 dark:hover:border-blue-700 dark:hover:bg-blue-950/20',
    jumpLink: 'text-blue-600 dark:text-blue-400',
  },
} as const;

const riskConfig = {
  high: {
    leftBar: 'border-red-400 dark:border-red-600',
    bg: 'bg-red-50/60 dark:bg-red-950/20',
    pill: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
    headerPill: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  },
  mixed: {
    leftBar: 'border-amber-400 dark:border-amber-600',
    bg: 'bg-amber-50/60 dark:bg-amber-950/20',
    pill: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
    headerPill: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  },
  standard: {
    leftBar: 'border-green-400 dark:border-green-600',
    bg: 'bg-green-50/60 dark:bg-green-950/20',
    pill: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
    headerPill: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  },
} as const;

export type IntelligencePanelProps = {
  envelopeId: string;
  recipientEmail?: string;
  pdfData?: Uint8Array | string;
};

export const IntelligencePanel = ({
  envelopeId,
  recipientEmail,
  pdfData,
}: IntelligencePanelProps) => {
  const highlightCtx = useOptionalClauseHighlight();
  const { toast } = useToast();

  const [expanded, setExpanded] = useState(() => {
    try {
      return localStorage.getItem(EXPANDED_KEY) !== 'false';
    } catch {
      return true;
    }
  });

  const [analyzed, setAnalyzed] = useState(() => {
    try {
      return localStorage.getItem(analyzedKey(envelopeId)) === 'true';
    } catch {
      return false;
    }
  });

  const [summaryExpanded, setSummaryExpanded] = useState(true);
  const summaryInitializedRef = useRef(false);

  const [navigatingClause, setNavigatingClause] = useState<string | null>(null);
  const clearHighlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const {
    data: outcome,
    isLoading,
    isError,
  } = trpc.countersign.analyzeEnvelope.useQuery(
    { envelopeId, recipientEmail },
    { enabled: analyzed && !!envelopeId },
  );

  const review = outcome?.status === 'ok' ? outcome.data : undefined;
  const unavailableReason = outcome?.status === 'unavailable' ? outcome.reason : undefined;

  useEffect(() => {
    if (!review || summaryInitializedRef.current) return;
    summaryInitializedRef.current = true;
    setSummaryExpanded(review.riskVerdict.level !== 'high');
  }, [review]);

  const sortedClauses = useMemo(
    () =>
      [...(review?.flaggedClauses ?? [])].sort(
        (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
      ),
    [review?.flaggedClauses],
  );

  const canNavigate = !!pdfData;

  const handleClauseClick = useCallback(
    async (clause: FlaggedClauseV2) => {
      if (!pdfData) return;
      setNavigatingClause(clause.id);

      if (clearHighlightTimerRef.current) {
        clearTimeout(clearHighlightTimerRef.current);
        clearHighlightTimerRef.current = null;
      }

      try {
        let pages =
          clause.sectionNumber > 0
            ? await searchPdfBySectionNumber(pdfData, clause.sectionNumber)
            : [];
        if (pages.length === 0) {
          pages = await searchPdfText(pdfData, clause.clauseText);
        }

        if (pages.length > 0) {
          highlightCtx?.setActiveHighlight({
            clauseText: clause.clauseText,
            pages,
            severity: clause.severity,
          });
          const el = document.querySelector(PDF_VIEWER_CONTENT_SELECTOR);
          el?.setAttribute('data-scroll-to-page', String(pages[0].page));

          const highlightFadeTimer = setTimeout(() => {
            highlightCtx?.setActiveHighlight(null);
          }, 3000);
          // eslint-disable-next-line require-atomic-updates -- ref holds latest fade timer after awaited PDF search
          clearHighlightTimerRef.current = highlightFadeTimer;
        } else {
          toast({
            title: 'Clause not found',
            description: `Couldn't locate this clause in the PDF. See ${clause.sectionReference} manually.`,
          });
        }
      } catch (err) {
        console.error('[countersign] clause navigation failed:', err);
      } finally {
        setNavigatingClause(null);
      }
    },
    [pdfData, highlightCtx, toast],
  );

  return (
    <div className="overflow-hidden rounded-lg border border-violet-200 bg-card shadow-sm dark:border-violet-800/40">
      {/* ── Toggle header ─────────────────────────────────────── */}
      <button
        onClick={toggleExpanded}
        className="flex w-full items-center justify-between gap-2 bg-gradient-to-r from-violet-50 to-indigo-50 px-4 py-3 text-left transition-colors hover:from-violet-100 hover:to-indigo-100 dark:from-violet-950/40 dark:to-indigo-950/40 dark:hover:from-violet-900/40 dark:hover:to-indigo-900/40"
      >
        <div className="flex items-center gap-2">
          <SparklesIcon className="h-4 w-4 shrink-0 text-violet-600 dark:text-violet-400" />
          <span className="text-sm font-semibold text-foreground">Document Review</span>
          {review && (
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-xs font-medium',
                riskConfig[review.riskVerdict.level].headerPill,
              )}
            >
              {review.riskVerdict.level}
            </span>
          )}
        </div>
        {expanded ? (
          <ChevronUpIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronDownIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
      </button>

      {/* ── Body ──────────────────────────────────────────────── */}
      {expanded && (
        <div className="p-4">
          {/* Pre-analysis trigger */}
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

          {/* Network error */}
          {analyzed && !isLoading && isError && (
            <p className="text-xs text-muted-foreground">
              Could not reach the server. Check your connection and try again.
            </p>
          )}

          {/* Unavailable — no key */}
          {analyzed && !isLoading && !isError && unavailableReason === 'no_api_key' && (
            <p className="text-xs text-muted-foreground">
              Document review needs an Anthropic API key. Add{' '}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.7rem]">
                ANTHROPIC_API_KEY
              </code>{' '}
              to the repo root{' '}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.7rem]">.env</code> and
              restart{' '}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.7rem]">
                npm run dev
              </code>
              .
            </p>
          )}

          {/* Unavailable — envelope not found */}
          {analyzed && !isLoading && !isError && unavailableReason === 'envelope_not_found' && (
            <p className="text-xs text-muted-foreground">
              Could not load this envelope or PDF for analysis.
            </p>
          )}

          {/* Unavailable — analysis error */}
          {analyzed && !isLoading && !isError && unavailableReason === 'analysis_failed' && (
            <p className="text-xs text-muted-foreground">
              Analysis failed. Check the server logs and your{' '}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.7rem]">
                ANTHROPIC_API_KEY
              </code>{' '}
              setting.
            </p>
          )}

          {/* Results */}
          {analyzed && !isLoading && !isError && review && (
            <div className="flex flex-col gap-4">
              {/* Document info */}
              <div>
                <p className="text-sm font-bold leading-tight text-foreground">
                  {review.document.counterparty}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {review.document.documentType}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {review.document.sectionCount} sections · {review.document.estimatedReadMinutes}{' '}
                  min read
                </p>
              </div>

              {/* Risk verdict */}
              <div
                className={cn(
                  'flex items-start gap-2.5 rounded-r border-l-4 py-2 pl-3 pr-2',
                  riskConfig[review.riskVerdict.level].leftBar,
                  riskConfig[review.riskVerdict.level].bg,
                )}
              >
                <span
                  className={cn(
                    'mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold',
                    riskConfig[review.riskVerdict.level].pill,
                  )}
                >
                  {review.riskVerdict.level}
                </span>
                <span className="text-sm text-foreground">{review.riskVerdict.headline}</span>
              </div>

              <Separator />

              {/* Summary (collapsible) */}
              <div>
                <button
                  onClick={() => setSummaryExpanded((v) => !v)}
                  className="flex w-full items-center justify-between text-left"
                >
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Summary
                  </p>
                  {summaryExpanded ? (
                    <ChevronUpIcon className="h-3.5 w-3.5 text-muted-foreground" />
                  ) : (
                    <ChevronDownIcon className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                </button>
                {summaryExpanded && (
                  <ul className="mt-2 flex flex-col gap-1">
                    {review.summary.map((point, i) => (
                      <li key={i} className="flex gap-2 text-sm">
                        <span className="mt-0.5 shrink-0 text-muted-foreground">•</span>
                        <span>{point}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <Separator />

              {/* Flagged clauses */}
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Flagged Clauses
                </p>
                {sortedClauses.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No clauses flagged.</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {sortedClauses.map((clause) => {
                      const cfg = severityConfig[clause.severity];
                      const isNavigating = navigatingClause === clause.id;
                      return (
                        <button
                          key={clause.id}
                          type="button"
                          disabled={!canNavigate || isNavigating}
                          onClick={async () => {
                            await handleClauseClick(clause);
                          }}
                          className={cn(
                            'group w-full rounded border p-3 text-left transition-colors',
                            cfg.border,
                            canNavigate ? cn('cursor-pointer', cfg.hover) : 'cursor-default',
                          )}
                        >
                          {/* Card header row */}
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <span
                              className={cn(
                                'rounded-full px-2 py-0.5 text-xs font-semibold',
                                cfg.pill,
                              )}
                            >
                              {clause.severity}
                            </span>
                            <span className="shrink-0 text-xs text-muted-foreground">
                              {clause.sectionReference}
                            </span>
                          </div>

                          {/* Title */}
                          <p className="mb-2 text-sm font-semibold text-foreground">
                            {clause.title}
                          </p>

                          {/* What it says */}
                          <p className="mb-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground">
                            What it says
                          </p>
                          <p className="mb-2 text-sm text-foreground">{clause.whatItSays}</p>

                          {/* What it means */}
                          <p className="mb-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground">
                            What it means for you
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {clause.whatItMeansForYou}
                          </p>

                          {/* Jump link */}
                          {canNavigate && (
                            <p
                              className={cn(
                                'mt-2 text-xs font-medium transition-opacity',
                                cfg.jumpLink,
                                isNavigating ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                              )}
                            >
                              {isNavigating ? (
                                <span className="flex items-center gap-1">
                                  <Loader2Icon className="h-3 w-3 animate-spin" />
                                  Locating…
                                </span>
                              ) : (
                                '↗ Show in document'
                              )}
                            </p>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <Separator />

              {/* Disclaimer at bottom */}
              <AIDisclaimer />
            </div>
          )}
        </div>
      )}
    </div>
  );
};
