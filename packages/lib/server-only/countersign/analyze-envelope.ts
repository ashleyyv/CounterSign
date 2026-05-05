import crypto from 'crypto';

import { getFileServerSide } from '@documenso/lib/universal/upload/get-file.server';
import { env } from '@documenso/lib/utils/env';
import { prisma } from '@documenso/prisma';

import type { DocumentReviewResultV2 } from './ai-review';
import { jsonToDocumentReviewV2, jsonToStringArray, runDocumentReviewV2 } from './ai-review';

type PdfParseResult = { text: string };

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

  // Prefer V2 rawReview cache; bypass if absent or missing flaggedClauses
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
    console.log('[countersign] analyzeEnvelope: rawReview present but unusable — re-analyzing');
  } else if (cached) {
    console.log(
      '[countersign] analyzeEnvelope: legacy cache (no rawReview) — re-analyzing with V2',
      'legacy summary items:',
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
