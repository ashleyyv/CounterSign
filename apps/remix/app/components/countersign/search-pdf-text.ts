import type { PageHighlight, TextBound } from './clause-highlight-context';

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** pdf.js destroy may return void or a Promise depending on version */
const destroyPdfDocument = async (pdf: { destroy: () => void | Promise<void> }) => {
  await Promise.resolve(pdf.destroy());
};

interface RawTextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
}

/**
 * Searches a PDF for the given clause text and returns page-level bounding boxes.
 * Coordinates are in unscaled PDF viewport space (scale 1), matching Konva's
 * coordinate system when the stage has scale applied separately.
 */
export const searchPdfText = async (
  pdfData: Uint8Array | string,
  searchText: string,
): Promise<PageHighlight[]> => {
  const pdfjsLib = await import('pdfjs-dist');

  if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
    try {
      const w = await import('pdfjs-dist/build/pdf.worker?url');
      const workerSrc =
        typeof w === 'string' ? w : isRecord(w) && typeof w.default === 'string' ? w.default : '';
      if (workerSrc) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;
      }
    } catch {
      // Worker already configured elsewhere, or running without worker (slower)
    }
  }

  let bytes: Uint8Array;
  if (typeof pdfData === 'string') {
    const resp = await fetch(pdfData);
    bytes = new Uint8Array(await resp.arrayBuffer());
  } else {
    bytes = pdfData;
  }

  const pdf = await pdfjsLib.getDocument({ data: bytes, cMapUrl: '/static/cmaps/' }).promise;

  const queryNorm = norm(searchText);
  // Use the first 50 normalised chars as an anchor for page detection
  const anchor = queryNorm.slice(0, 50);

  if (!anchor) {
    await destroyPdfDocument(pdf);
    return [];
  }

  const results: PageHighlight[] = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();

    const items: RawTextItem[] = content.items
      .filter((it): it is RawTextItem & { str: string } => 'str' in it && !!String(it.str).trim())
      .map((it) => {
        const t = Array.isArray(it.transform)
          ? it.transform.filter((n): n is number => typeof n === 'number')
          : [];
        const defaults = [1, 0, 0, 1, 0, 0];
        const safeTransform = defaults.map((d, i) => (typeof t[i] === 'number' ? t[i] : d));
        const width = isRecord(it) && typeof it.width === 'number' ? it.width : 60;
        const height = isRecord(it) && typeof it.height === 'number' ? it.height : 10;
        return {
          str: String(it.str),
          transform: safeTransform,
          width,
          height,
        };
      });

    const pageText = norm(items.map((i) => i.str).join(' '));

    // Fast rejection: anchor's first 30 chars must appear on this page
    if (!pageText.includes(anchor.slice(0, 30))) continue;

    // Walk items in order, accumulating text; capture items once we hit the anchor
    const bounds: TextBound[] = [];
    let accumulated = '';
    let capturing = false;
    const captureLimit = queryNorm.length + 80;

    for (const item of items) {
      const itemNorm = norm(item.str);
      accumulated += (accumulated ? ' ' : '') + itemNorm;

      if (!capturing && accumulated.includes(anchor.slice(0, 30))) {
        capturing = true;
      }

      if (capturing) {
        const x = item.transform[4];
        const pdfY = item.transform[5];
        // PDF uses bottom-up y; convert to top-down for Konva
        const h = item.height || Math.abs(item.transform[3] ?? 10) || 10;

        bounds.push({
          x,
          y: viewport.height - pdfY - h,
          width: item.width || 60,
          height: h,
        });

        if (accumulated.length > captureLimit) break;
      }
    }

    if (bounds.length > 0) {
      results.push({ page: pageNum, bounds });
    }
  }

  await destroyPdfDocument(pdf);
  return results;
};

/**
 * Groups per-item bounds into per-line merged rectangles for cleaner highlights.
 */
export const groupBoundsIntoLines = (bounds: TextBound[]): TextBound[] => {
  if (bounds.length === 0) return [];

  const sorted = [...bounds].sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: TextBound[][] = [];

  for (const bound of sorted) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last[0].y - bound.y) < 6) {
      last.push(bound);
    } else {
      lines.push([bound]);
    }
  }

  return lines.map((line) => {
    const minX = Math.min(...line.map((b) => b.x));
    const maxX = Math.max(...line.map((b) => b.x + b.width));
    const minY = Math.min(...line.map((b) => b.y));
    const maxH = Math.max(...line.map((b) => b.height));
    return { x: minX - 2, y: minY - 1, width: maxX - minX + 4, height: maxH + 2 };
  });
};
