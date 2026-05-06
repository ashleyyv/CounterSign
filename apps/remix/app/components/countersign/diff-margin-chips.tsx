import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { createPortal } from 'react-dom';

import { PDF_VIEWER_CONTENT_SELECTOR } from '@documenso/lib/constants/pdf-viewer';
import type { DiffChange } from '@documenso/lib/types/countersign';
import { cn } from '@documenso/ui/lib/utils';

import { useOptionalDiff } from './diff-context';
import { searchPdfBySectionNumber, searchPdfText } from './search-pdf-text';

export type DiffMarginChipsProps = {
  pdfData: Uint8Array | string;
  changes: DiffChange[];
  scale?: number;
};

type AnchoredChip = {
  change: DiffChange;
  page: number;
  yTop: number;
};

type PositionedChip = AnchoredChip & {
  topPx: number;
};

const SEVERITY_ORDER = { severe: 0, notable: 1, 'worth-reading': 2 } as const;

const chipColors = {
  severe: {
    bg: 'bg-red-100/20 dark:bg-red-900/20',
    border: 'border-red-500/80 dark:border-red-400/80',
    text: 'text-red-700 dark:text-red-400',
  },
  notable: {
    bg: 'bg-amber-100/20 dark:bg-amber-900/20',
    border: 'border-amber-500/80 dark:border-amber-400/80',
    text: 'text-amber-700 dark:text-amber-400',
  },
  'worth-reading': {
    bg: 'bg-blue-100/20 dark:bg-blue-900/20',
    border: 'border-blue-500/80 dark:border-blue-400/80',
    text: 'text-blue-700 dark:text-blue-400',
  },
} as const;

/**
 * Compute final chip positions by:
 * 1. Locating each page element via data-page attribute
 * 2. Computing top = pageOffsetInContent + yTop * scale
 * 3. Stacking chips that would overlap (within 20px) sorted by severity
 */
const computePositions = (
  anchoredChips: AnchoredChip[],
  contentEl: HTMLElement,
): PositionedChip[] => {
  const sorted = [...anchoredChips].sort((a, b) => {
    if (a.page !== b.page) {
      return a.page - b.page;
    }

    return a.yTop - b.yTop;
  });

  const positioned: PositionedChip[] = [];

  for (const chip of sorted) {
    const pageEl = contentEl.querySelector(`[data-page="${chip.page}"]`);

    if (!pageEl) {
      continue;
    }

    const pageTop = Number((pageEl as HTMLElement).dataset.pageTop ?? 0);
    const pageScale = Number((pageEl as HTMLElement).dataset.pageScale ?? 1);
    const rawTop = pageTop + chip.yTop * pageScale;

    // Resolve overlaps: stack chips 20px apart, sorted by severity
    let resolvedTop = rawTop;
    const overlapping = positioned.filter((p) => Math.abs(p.topPx - rawTop) < 20);

    if (overlapping.length > 0) {
      const maxTop = Math.max(...overlapping.map((p) => p.topPx));
      resolvedTop = maxTop + 20;
    }

    positioned.push({ ...chip, topPx: resolvedTop });
  }

  // Re-sort by severity within same visual cluster so severe chips appear first
  return positioned.sort((a, b) => {
    if (Math.abs(a.topPx - b.topPx) > 40) {
      return a.topPx - b.topPx;
    }

    return SEVERITY_ORDER[a.change.severity] - SEVERITY_ORDER[b.change.severity];
  });
};

export const DiffMarginChips = ({ pdfData, changes, scale = 1 }: DiffMarginChipsProps) => {
  const diffCtx = useOptionalDiff();
  const [anchoredChips, setAnchoredChips] = useState<AnchoredChip[]>([]);
  const [positionedChips, setPositionedChips] = useState<PositionedChip[]>([]);
  const [contentEl, setContentEl] = useState<HTMLElement | null>(null);
  const containerRef = useRef<HTMLElement | null>(null);

  // Search PDF for text positions of each change
  useEffect(() => {
    if (changes.length === 0) {
      setAnchoredChips([]);
      return;
    }

    let cancelled = false;

    const run = async () => {
      const results: AnchoredChip[] = [];

      await Promise.all(
        changes.map(async (change) => {
          const pages = await (async () => {
            if (change.sectionNumber > 0) {
              const bySection = await searchPdfBySectionNumber(pdfData, change.sectionNumber);

              if (bySection.length > 0) {
                return bySection;
              }
            }

            return searchPdfText(pdfData, change.clauseText);
          })();

          if (pages.length > 0 && pages[0].bounds.length > 0) {
            results.push({
              change,
              page: pages[0].page,
              yTop: pages[0].bounds[0].y,
            });
          }
        }),
      );

      if (!cancelled) {
        setAnchoredChips(results);
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [pdfData, changes]);

  // Find the pdf content container element
  useLayoutEffect(() => {
    const el = document.querySelector(PDF_VIEWER_CONTENT_SELECTOR) as HTMLElement | null;
    setContentEl(el);
    containerRef.current = el;
  });

  // Recompute chip positions when anchors or content el change
  useLayoutEffect(() => {
    if (!contentEl || anchoredChips.length === 0) {
      setPositionedChips([]);
      return;
    }

    const computed = computePositions(anchoredChips, contentEl);
    setPositionedChips(computed);
  }, [anchoredChips, contentEl, scale]);

  // Re-position chips when the pdf container resizes (handles zoom/layout changes)
  useEffect(() => {
    if (!contentEl) {
      return;
    }

    const observer = new ResizeObserver(() => {
      setPositionedChips(computePositions(anchoredChips, contentEl));
    });

    observer.observe(contentEl);

    return () => {
      observer.disconnect();
    };
  }, [contentEl, anchoredChips]);

  const handleChipClick = useCallback(
    (changeId: string) => {
      diffCtx?.setActiveDiffChipId(changeId);
    },
    [diffCtx],
  );

  if (!contentEl || positionedChips.length === 0) {
    return null;
  }

  return createPortal(
    <div
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible' }}
      aria-hidden="true"
    >
      {positionedChips.map((chip) => {
        const colors = chipColors[chip.change.severity];
        const isActive = diffCtx?.activeDiffChipId === chip.change.id;

        return (
          <button
            key={chip.change.id}
            title={chip.change.title}
            onClick={() => handleChipClick(chip.change.id)}
            style={{
              position: 'absolute',
              top: chip.topPx,
              right: 0,
              transform: 'translateX(calc(100% + 4px))',
              pointerEvents: 'auto',
              padding: '3px 6px',
              borderRadius: '4px',
              borderWidth: '0.5px',
              borderStyle: 'solid',
              fontSize: '11px',
              fontWeight: 500,
              maxWidth: '70px',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              cursor: 'pointer',
              outline: 'none',
              opacity: isActive ? 1 : 0.85,
              boxShadow: isActive ? '0 0 0 2px currentColor' : undefined,
            }}
            className={cn(colors.bg, colors.border, colors.text)}
          >
            {chip.change.chipLabel}
          </button>
        );
      })}
    </div>,
    contentEl,
  );
};
