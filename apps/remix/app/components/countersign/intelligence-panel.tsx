import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ChevronDownIcon, ChevronUpIcon, Loader2Icon, SparklesIcon } from 'lucide-react';

import { PDF_VIEWER_CONTENT_SELECTOR } from '@documenso/lib/constants/pdf-viewer';
import type { FlaggedClauseV2 } from '@documenso/lib/types/countersign';
import { trpc } from '@documenso/trpc/react';
import { cn } from '@documenso/ui/lib/utils';
import { Button } from '@documenso/ui/primitives/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@documenso/ui/primitives/collapsible';
import { useToast } from '@documenso/ui/primitives/use-toast';

import { AIDisclaimer } from './ai-disclaimer';
import { useOptionalClauseHighlight } from './clause-highlight-context';
import { shouldShowCountersignDiff } from './countersign-diff-eligibility';
import { useOptionalDiff } from './diff-context';
import { searchPdfBySectionNumber, searchPdfText } from './search-pdf-text';

const EXPANDED_KEY = 'countersign:panel:expanded';
const analyzedKey = (id: string) => `countersign:analyzed:${id}`;

const SEVERITY_ORDER = { severe: 0, notable: 1, 'worth-reading': 2 } as const;

const SEVERITY_KEYS = ['severe', 'notable', 'worth-reading'] as const;

const severitySectionLabel: Record<(typeof SEVERITY_KEYS)[number], string> = {
  severe: 'Serious — review carefully',
  notable: 'Notable',
  'worth-reading': 'Worth reading',
};

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
  /** Current envelope file title (tabs). Omit to disable Counterparty Diff UI entirely. */
  countersignDiffAttachmentTitle?: string | null;
};

export const IntelligencePanel = ({
  envelopeId,
  recipientEmail,
  pdfData,
  countersignDiffAttachmentTitle,
}: IntelligencePanelProps) => {
  const highlightCtx = useOptionalClauseHighlight();
  const diffCtx = useOptionalDiff();
  const { toast } = useToast();

  const countersignDiffEnabled = shouldShowCountersignDiff(countersignDiffAttachmentTitle);

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

  const [summaryOpen, setSummaryOpen] = useState(true);
  const [overviewOpen, setOverviewOpen] = useState(true);
  const [clausesSectionOpen, setClausesSectionOpen] = useState(true);
  const [severitySectionOpen, setSeveritySectionOpen] = useState<
    Record<(typeof SEVERITY_KEYS)[number], boolean>
  >({
    severe: true,
    notable: false,
    'worth-reading': false,
  });
  const summaryInitializedRef = useRef(false);

  const [navigatingClause, setNavigatingClause] = useState<string | null>(null);
  const clearHighlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [diffBannerOpen, setDiffBannerOpen] = useState(false);
  const [highlightedDiffId, setHighlightedDiffId] = useState<string | null>(null);
  const clauseCardRefs = useRef<Map<string, HTMLElement>>(new Map());

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
    {
      enabled: analyzed && !!envelopeId,
      // Cached on server by document hash; never refetch automatically (avoids Anthropic spend on tab focus / remount).
      staleTime: Number.POSITIVE_INFINITY,
      gcTime: 1000 * 60 * 60 * 24 * 7,
      refetchOnWindowFocus: false,
      refetchOnMount: false,
      refetchOnReconnect: false,
      retry: 1,
    },
  );

  const review = outcome?.status === 'ok' ? outcome.data : undefined;
  const unavailableReason = outcome?.status === 'unavailable' ? outcome.reason : undefined;

  const { data: diffOutcome } = trpc.countersign.getDiff.useQuery(
    { envelopeId, recipientEmail: recipientEmail ?? '' },
    {
      enabled: analyzed && !!envelopeId && !!recipientEmail && countersignDiffEnabled,
      staleTime: Number.POSITIVE_INFINITY,
      gcTime: 1000 * 60 * 60 * 24 * 7,
      refetchOnWindowFocus: false,
      refetchOnMount: false,
      refetchOnReconnect: false,
      retry: 1,
    },
  );

  const diffResult = diffOutcome?.status === 'ok' ? diffOutcome.data : undefined;

  useEffect(() => {
    if (!review || summaryInitializedRef.current) return;
    summaryInitializedRef.current = true;
    setSummaryOpen(review.riskVerdict.level !== 'high');
  }, [review]);

  const sortedClauses = useMemo(
    () =>
      [...(review?.flaggedClauses ?? [])].sort(
        (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
      ),
    [review?.flaggedClauses],
  );

  const clausesBySeverity = useMemo(() => {
    const groups: Record<(typeof SEVERITY_KEYS)[number], FlaggedClauseV2[]> = {
      severe: [],
      notable: [],
      'worth-reading': [],
    };
    for (const c of sortedClauses) {
      groups[c.severity].push(c);
    }
    return groups;
  }, [sortedClauses]);

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

  const scrollToClauseCard = useCallback((clauseId: string) => {
    const el = clauseCardRefs.current.get(clauseId);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    setHighlightedDiffId(clauseId);
    setTimeout(() => setHighlightedDiffId(null), 1200);
  }, []);

  // When a margin chip is clicked it sets activeDiffChipId on the DiffContext.
  // React here by scrolling the panel to the matching flagged-clause card.
  useEffect(() => {
    const activeId = diffCtx?.activeDiffChipId;
    if (!countersignDiffEnabled || !activeId || !diffResult) {
      return;
    }

    const change = diffResult.changes.find((c) => c.id === activeId);
    if (!change?.matchingFlaggedClauseId) {
      return;
    }

    const matchedClause = review?.flaggedClauses.find(
      (c) => c.id === change.matchingFlaggedClauseId,
    );

    if (matchedClause) {
      setSeveritySectionOpen((prev) => ({ ...prev, [matchedClause.severity]: true }));
      setClausesSectionOpen(true);
      // Small delay lets the collapsible open before we scroll into view
      setTimeout(() => scrollToClauseCard(change.matchingFlaggedClauseId!), 80);
    }
  }, [countersignDiffEnabled, diffCtx?.activeDiffChipId]);

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

          {/* Results — nested collapsibles: overview, summary, clauses by severity */}
          {analyzed && !isLoading && !isError && review && (
            <div className="flex flex-col gap-2">
              <Collapsible open={overviewOpen} onOpenChange={setOverviewOpen}>
                <CollapsibleTrigger
                  type="button"
                  className="flex w-full items-center justify-between gap-2 rounded-md border border-border/70 bg-muted/25 px-3 py-2.5 text-left transition-colors hover:bg-muted/40"
                >
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Overview &amp; risk
                  </span>
                  {overviewOpen ? (
                    <ChevronUpIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronDownIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-3 data-[state=closed]:animate-none">
                  <ul className="list-disc space-y-1.5 pl-5 text-sm text-foreground marker:text-muted-foreground">
                    <li>
                      <span className="font-semibold">{review.document.counterparty}</span>
                    </li>
                    <li>{review.document.documentType}</li>
                    <li>
                      {review.document.sectionCount} sections ·{' '}
                      {review.document.estimatedReadMinutes} min read
                    </li>
                  </ul>
                  <div
                    className={cn(
                      'mt-3 flex items-start gap-2.5 rounded-md border-l-4 py-2 pl-3 pr-2',
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
                    <ul className="list-disc pl-4 text-sm text-foreground marker:text-muted-foreground">
                      <li>{review.riskVerdict.headline}</li>
                    </ul>
                  </div>
                </CollapsibleContent>
              </Collapsible>

              {/* Diff banner — gated mock attachment + changes exist */}
              {countersignDiffEnabled && diffResult && diffResult.changes.length > 0 && (
                <div className="rounded-md border border-amber-200 bg-amber-50/60 dark:border-amber-700/50 dark:bg-amber-950/20">
                  <button
                    type="button"
                    onClick={() => setDiffBannerOpen((o) => !o)}
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
                  >
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-800 dark:text-amber-300">
                      <span>⚡</span>
                      <span>
                        {diffResult.changes.length} change
                        {diffResult.changes.length !== 1 ? 's' : ''} since last{' '}
                        {diffResult.priorDocument.documentType} from {review.document.counterparty}
                      </span>
                    </div>
                    {diffBannerOpen ? (
                      <ChevronUpIcon className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                    ) : (
                      <ChevronDownIcon className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                    )}
                  </button>

                  {diffBannerOpen && (
                    <div className="border-t border-amber-200 px-3 pb-2 dark:border-amber-700/50">
                      {[...diffResult.changes]
                        .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
                        .map((change) => (
                          <button
                            key={change.id}
                            type="button"
                            onClick={() => {
                              if (change.matchingFlaggedClauseId) {
                                const matchedClause = review.flaggedClauses.find(
                                  (c) => c.id === change.matchingFlaggedClauseId,
                                );
                                if (matchedClause) {
                                  setSeveritySectionOpen((prev) => ({
                                    ...prev,
                                    [matchedClause.severity]: true,
                                  }));
                                  setClausesSectionOpen(true);
                                  setTimeout(
                                    () => scrollToClauseCard(change.matchingFlaggedClauseId!),
                                    50,
                                  );
                                }
                              }
                            }}
                            className="flex w-full items-center gap-2 rounded px-1 py-1 text-left text-xs transition-colors hover:bg-amber-100/60 dark:hover:bg-amber-900/30"
                          >
                            <span className="font-mono text-amber-700 dark:text-amber-400">
                              {change.chipLabel}
                            </span>
                            <span className="text-foreground">{change.title}</span>
                          </button>
                        ))}
                    </div>
                  )}
                </div>
              )}

              <Collapsible open={summaryOpen} onOpenChange={setSummaryOpen}>
                <CollapsibleTrigger
                  type="button"
                  className="flex w-full items-center justify-between gap-2 rounded-md border border-border/70 bg-muted/25 px-3 py-2.5 text-left transition-colors hover:bg-muted/40"
                >
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Summary
                  </span>
                  {summaryOpen ? (
                    <ChevronUpIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronDownIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-3">
                  <ul className="list-disc space-y-2 pl-5 text-sm text-foreground marker:text-muted-foreground">
                    {review.summary.map((point, i) => (
                      <li key={i}>{point}</li>
                    ))}
                  </ul>
                </CollapsibleContent>
              </Collapsible>

              <Collapsible open={clausesSectionOpen} onOpenChange={setClausesSectionOpen}>
                <CollapsibleTrigger
                  type="button"
                  className="flex w-full items-center justify-between gap-2 rounded-md border border-border/70 bg-muted/25 px-3 py-2.5 text-left transition-colors hover:bg-muted/40"
                >
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Flagged clauses ({sortedClauses.length})
                  </span>
                  {clausesSectionOpen ? (
                    <ChevronUpIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronDownIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-2">
                  {sortedClauses.length === 0 ? (
                    <p className="py-1 text-xs text-muted-foreground">No clauses flagged.</p>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {SEVERITY_KEYS.map((sev) => {
                        const list = clausesBySeverity[sev];
                        if (list.length === 0) {
                          return null;
                        }
                        return (
                          <Collapsible
                            key={sev}
                            open={severitySectionOpen[sev]}
                            onOpenChange={(open) =>
                              setSeveritySectionOpen((prev) => ({ ...prev, [sev]: open }))
                            }
                          >
                            <CollapsibleTrigger
                              type="button"
                              className={cn(
                                'flex w-full min-w-0 items-center justify-between gap-2 rounded-md border px-2.5 py-2 text-left text-xs font-semibold transition-colors',
                                severityConfig[sev].border,
                                'bg-card hover:bg-muted/30',
                              )}
                            >
                              <span className="min-w-0 flex-1 text-foreground">
                                {severitySectionLabel[sev]}
                              </span>
                              <span className="flex shrink-0 items-center gap-1.5 tabular-nums text-muted-foreground">
                                {list.length} {list.length === 1 ? 'clause' : 'clauses'}
                                {severitySectionOpen[sev] ? (
                                  <ChevronUpIcon className="h-3.5 w-3.5 text-muted-foreground" />
                                ) : (
                                  <ChevronDownIcon className="h-3.5 w-3.5 text-muted-foreground" />
                                )}
                              </span>
                            </CollapsibleTrigger>
                            <CollapsibleContent className="pl-0 pt-2">
                              <div className="flex flex-col gap-2">
                                {list.map((clause) => {
                                  const cfg = severityConfig[clause.severity];
                                  const isNavigating = navigatingClause === clause.id;
                                  return (
                                    <button
                                      key={clause.id}
                                      ref={(el) => {
                                        if (el) clauseCardRefs.current.set(clause.id, el);
                                        else clauseCardRefs.current.delete(clause.id);
                                      }}
                                      type="button"
                                      disabled={!canNavigate || isNavigating}
                                      onClick={async () => {
                                        await handleClauseClick(clause);
                                      }}
                                      className={cn(
                                        'group w-full rounded border p-2.5 text-left transition-colors',
                                        cfg.border,
                                        canNavigate
                                          ? cn('cursor-pointer', cfg.hover)
                                          : 'cursor-default',
                                        highlightedDiffId === clause.id &&
                                          'ring-2 ring-amber-400 ring-offset-1 dark:ring-amber-500',
                                      )}
                                    >
                                      <p className="text-sm font-semibold leading-snug text-foreground">
                                        {clause.title}
                                      </p>
                                      <p className="mt-0.5 text-[0.65rem] text-muted-foreground">
                                        {clause.sectionReference}
                                      </p>
                                      <ul className="mt-2 list-disc space-y-1.5 pl-4 text-left text-sm marker:text-muted-foreground">
                                        <li>
                                          <span className="font-medium text-foreground">
                                            Says:{' '}
                                          </span>
                                          <span className="text-muted-foreground">
                                            {clause.whatItSays}
                                          </span>
                                        </li>
                                        <li>
                                          <span className="font-medium text-foreground">
                                            Means for you:{' '}
                                          </span>
                                          <span className="text-muted-foreground">
                                            {clause.whatItMeansForYou}
                                          </span>
                                        </li>
                                      </ul>
                                      {canNavigate && (
                                        <p
                                          className={cn(
                                            'mt-2 text-xs font-medium transition-opacity',
                                            cfg.jumpLink,
                                            isNavigating
                                              ? 'opacity-100'
                                              : 'opacity-0 group-hover:opacity-100',
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
                            </CollapsibleContent>
                          </Collapsible>
                        );
                      })}
                    </div>
                  )}
                </CollapsibleContent>
              </Collapsible>

              <div className="pt-1">
                <AIDisclaimer />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
