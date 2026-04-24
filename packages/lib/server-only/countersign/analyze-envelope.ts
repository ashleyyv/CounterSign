import crypto from 'crypto';

import { getFileServerSide } from '@documenso/lib/universal/upload/get-file.server';
import { prisma } from '@documenso/prisma';

import type { DocumentReviewResult } from './ai-review';
import { getOrCreateDocumentReview } from './ai-review';

type PdfParseResult = { text: string };

const parsePdf = async (buf: Buffer): Promise<PdfParseResult> => {
  const mod = await import('pdf-parse');
  const fn = (mod.default ?? mod) as (buf: Buffer) => Promise<PdfParseResult>;
  return fn(buf);
};

export type AnalyzeEnvelopeOptions = {
  envelopeId: string;
  recipientEmail?: string;
};

export const analyzeEnvelope = async ({
  envelopeId,
  recipientEmail,
}: AnalyzeEnvelopeOptions): Promise<DocumentReviewResult | null> => {
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
    console.log('[countersign] returning null — no envelope or no items');
    return null;
  }

  const item = envelope.envelopeItems[0];
  const pdfBytes = await getFileServerSide(item.documentData);

  const documentHash = crypto.createHash('sha256').update(Buffer.from(pdfBytes)).digest('hex');

  // Return cached result immediately if available
  const cached = await prisma.documentReview.findUnique({ where: { documentHash } });
  if (cached) {
    return {
      summary: cached.summary as string[],
      flaggedClauses: cached.flaggedClauses as DocumentReviewResult['flaggedClauses'],
      documentType: cached.documentType ?? null,
      diff: null,
    };
  }

  // Extract text from PDF
  let documentText = envelope.title;
  try {
    const parsed = await parsePdf(Buffer.from(pdfBytes));
    if (parsed.text?.trim()) {
      documentText = parsed.text;
    }
  } catch {
    // fall back to envelope title as document text hint
  }

  // Look for a prior signed document from the same counterparty if recipientEmail provided
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
        // no prior text available
      }
    }
  }

  console.log(
    '[countersign] calling getOrCreateDocumentReview, apiKey set:',
    !!process.env.ANTHROPIC_API_KEY,
  );
  return getOrCreateDocumentReview({
    documentHash,
    documentText,
    priorDocumentText,
  });
};
