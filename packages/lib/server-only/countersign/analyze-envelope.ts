import crypto from 'crypto';

import type { FlaggedClauseV2 } from '@documenso/lib/types/countersign';
import { getFileServerSide } from '@documenso/lib/universal/upload/get-file.server';
import { env } from '@documenso/lib/utils/env';
import { prisma } from '@documenso/prisma';

import type { DocumentReviewResultV2 } from './ai-review';
import {
  jsonToDocumentReviewV2,
  jsonToFlaggedClauses,
  jsonToStringArray,
  runDocumentReviewV2,
} from './ai-review';

type PdfParseResult = { text: string };

/** Map legacy V1 DB row to V2 shape so we never burn Anthropic credits re-fetching the same document. */
const legacyRowToV2 = (
  cached: {
    summary: unknown;
    flaggedClauses: unknown;
    documentType: string | null;
  },
  envelopeTitle: string,
): DocumentReviewResultV2 | null => {
  const legacy = jsonToFlaggedClauses(cached.flaggedClauses);
  if (legacy.length === 0) {
    return null;
  }
  const legacySeverity = (assessment: string): FlaggedClauseV2['severity'] => {
    if (assessment === 'review') {
      return 'severe';
    }
    if (assessment === 'unusual') {
      return 'notable';
    }
    return 'worth-reading';
  };
  const flaggedClauses: FlaggedClauseV2[] = legacy.map((fc, i) => ({
    id: `legacy-${i}-${fc.clause.slice(0, 32)}`,
    severity: legacySeverity(fc.assessment),
    title: fc.clause,
    sectionReference: 'See document',
    sectionNumber: 0,
    clauseText: fc.text,
    whatItSays: fc.note,
    whatItMeansForYou: fc.note,
  }));
  const severe = flaggedClauses.filter((c) => c.severity === 'severe').length;
  const total = flaggedClauses.length;
  let level: DocumentReviewResultV2['riskVerdict']['level'];
  let headline: string;
  if (severe >= 3 || total >= 5) {
    level = 'high';
    headline =
      'This document contains several clauses that warrant careful review before you sign.';
  } else if (severe >= 1 || total >= 3) {
    level = 'mixed';
    headline = 'This document mixes typical terms with a few areas to read closely.';
  } else {
    level = 'standard';
    headline = 'Most clauses look typical for this kind of document; confirm what applies to you.';
  }
  let summary = jsonToStringArray(cached.summary);
  if (summary.length === 0) {
    summary = [
      'Review each flagged clause below in the context of your situation.',
      'This summary was recovered from an earlier analysis stored in your database.',
      'Run a fresh analysis only if the document was updated since then.',
    ];
  }
  return {
    document: {
      counterparty: envelopeTitle.trim() || 'Counterparty',
      documentType: cached.documentType?.trim() || 'Agreement',
      sectionCount: 0,
      estimatedReadMinutes: Math.min(120, Math.max(5, total * 2)),
    },
    riskVerdict: { level, headline },
    summary,
    flaggedClauses,
  };
};

const parsePdf = async (buf: Buffer): Promise<PdfParseResult> => {
  const mod = await import('pdf-parse');
  const candidate = mod.default ?? mod;
  if (typeof candidate !== 'function') {
    throw new Error('pdf-parse export is not a function');
  }
  const result: unknown = await candidate(buf);
  if (
    typeof result !== 'object' ||
    result === null ||
    !('text' in result) ||
    typeof result.text !== 'string'
  ) {
    return { text: '' };
  }
  return { text: result.text };
};

export type AnalyzeEnvelopeUnavailableReason =
  | 'no_api_key'
  | 'envelope_not_found'
  | 'analysis_failed';

export type AnalyzeEnvelopeResult =
  | { status: 'ok'; data: DocumentReviewResultV2 }
  | { status: 'unavailable'; reason: AnalyzeEnvelopeUnavailableReason };

export type AnalyzeEnvelopeOptions = {
  envelopeId: string;
  recipientEmail?: string;
};

export const analyzeEnvelope = async ({
  envelopeId,
  recipientEmail,
}: AnalyzeEnvelopeOptions): Promise<AnalyzeEnvelopeResult> => {
  try {
    return await analyzeEnvelopeInner({ envelopeId, recipientEmail });
  } catch (err) {
    console.error('[countersign] analyzeEnvelope error:', err);
    return { status: 'unavailable', reason: 'analysis_failed' };
  }
};

const analyzeEnvelopeInner = async ({
  envelopeId,
  recipientEmail,
}: AnalyzeEnvelopeOptions): Promise<AnalyzeEnvelopeResult> => {
  console.log('[countersign] analyzeEnvelope called', { envelopeId, recipientEmail });

  const envelope = await prisma.envelope.findUnique({
    where: { id: envelopeId },
    include: {
      envelopeItems: {
        include: { documentData: true },
        take: 1,
      },
    },
  });

  console.log(
    '[countersign] envelope found:',
    !!envelope,
    'items:',
    envelope?.envelopeItems?.length ?? 0,
  );

  if (!envelope || envelope.envelopeItems.length === 0) {
    return { status: 'unavailable', reason: 'envelope_not_found' };
  }

  const item = envelope.envelopeItems[0];
  const pdfBytes = await getFileServerSide(item.documentData);
  const documentHash = crypto.createHash('sha256').update(Buffer.from(pdfBytes)).digest('hex');

  // Prefer V2 rawReview cache; legacy JSON columns as fallback (no Anthropic).
  const cached = await prisma.documentReview.findUnique({ where: { documentHash } });
  if (cached?.rawReview) {
    const v2 = jsonToDocumentReviewV2(cached.rawReview);
    if (v2 && v2.flaggedClauses.length > 0) {
      console.log(
        '[countersign] analyzeEnvelope: rawReview cache hit — flaggedClauses:',
        v2.flaggedClauses.length,
      );
      return { status: 'ok', data: v2 };
    }
    const legacyV2 = legacyRowToV2(cached, envelope.title);
    if (legacyV2) {
      console.log(
        '[countersign] analyzeEnvelope: rawReview invalid — using legacy flaggedClauses from DB (no API)',
      );
      return { status: 'ok', data: legacyV2 };
    }
    console.log('[countersign] analyzeEnvelope: rawReview present but unusable — re-analyzing');
  } else if (cached) {
    const legacyV2 = legacyRowToV2(cached, envelope.title);
    if (legacyV2) {
      console.log(
        '[countersign] analyzeEnvelope: legacy DB row only — serving V2-shaped view (no API)',
      );
      return { status: 'ok', data: legacyV2 };
    }
    console.log(
      '[countersign] analyzeEnvelope: no usable legacy clauses — running V2 analysis',
      'summary items:',
      jsonToStringArray(cached.summary).length,
    );
  }

  const apiKey = env('ANTHROPIC_API_KEY')?.trim();
  if (!apiKey) {
    return { status: 'unavailable', reason: 'no_api_key' };
  }

  let documentText = envelope.title;
  try {
    const parsed = await parsePdf(Buffer.from(pdfBytes));
    if (parsed.text?.trim()) {
      documentText = parsed.text;
    }
  } catch {
    // fall back to envelope title
  }

  let priorDocumentText: string | undefined;
  if (recipientEmail) {
    const priorRecipient = await prisma.recipient.findFirst({
      where: {
        email: recipientEmail,
        signingStatus: 'SIGNED',
        envelope: {
          userId: envelope.userId,
          NOT: { id: envelopeId },
        },
      },
      orderBy: { signedAt: 'desc' },
      include: {
        envelope: {
          include: {
            envelopeItems: {
              include: { documentData: true },
              take: 1,
            },
          },
        },
      },
    });

    if (priorRecipient?.envelope.envelopeItems[0]) {
      try {
        const priorBytes = await getFileServerSide(
          priorRecipient.envelope.envelopeItems[0].documentData,
        );
        const priorParsed = await parsePdf(Buffer.from(priorBytes));
        if (priorParsed.text?.trim()) {
          priorDocumentText = priorParsed.text;
        }
      } catch {
        // no prior text
      }
    }
  }

  console.log('[countersign] analyzeEnvelope: running V2 analysis');

  const review = await runDocumentReviewV2({ documentHash, documentText, priorDocumentText });
  if (!review) {
    return { status: 'unavailable', reason: 'analysis_failed' };
  }

  return { status: 'ok', data: review };
};
