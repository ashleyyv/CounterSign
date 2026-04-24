import { z } from 'zod';

import { getOrCreateDocumentReview } from '@documenso/lib/server-only/countersign/ai-review';
import { analyzeEnvelope } from '@documenso/lib/server-only/countersign/analyze-envelope';
import { forwardDocument } from '@documenso/lib/server-only/countersign/forward-document';
import { prisma } from '@documenso/prisma';

import { authenticatedProcedure, procedure, router } from '../trpc';

export const countersignRouter = router({
  getDocumentReview: authenticatedProcedure
    .input(
      z.object({
        documentHash: z.string(),
        documentText: z.string(),
        documentType: z.string().optional(),
        priorDocumentText: z.string().optional(),
      }),
    )
    .query(async ({ input }) => {
      const { documentHash, documentText, documentType, priorDocumentText } = input;

      return getOrCreateDocumentReview({
        documentHash,
        documentText,
        documentType,
        priorDocumentText,
      });
    }),

  getSignerPreferences: authenticatedProcedure.query(async ({ ctx }) => {
    return prisma.signerPreferences.findUnique({ where: { userId: ctx.user.id } });
  }),

  upsertSignerPreferences: authenticatedProcedure
    .input(
      z.object({
        targets: z.array(z.object({ label: z.string(), email: z.string().email() })).max(3),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;
      const { targets } = input;

      return prisma.signerPreferences.upsert({
        where: { userId },
        create: { userId, targets },
        update: { targets },
      });
    }),

  forwardDocument: authenticatedProcedure
    .input(
      z.object({
        envelopeId: z.string(),
        targetEmail: z.string().email(),
        targetLabel: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { envelopeId, targetEmail, targetLabel } = input;
      const senderId = ctx.user.id;

      await forwardDocument({ envelopeId, senderId, targetEmail, targetLabel });
    }),

  analyzeEnvelope: procedure
    .input(z.object({ envelopeId: z.string(), recipientEmail: z.string().email().optional() }))
    .query(async ({ input }) => {
      return analyzeEnvelope(input);
    }),

  getStalePendingDocuments: authenticatedProcedure.query(async ({ ctx }) => {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const recipients = await prisma.recipient.findMany({
      where: {
        email: ctx.user.email,
        signingStatus: 'NOT_SIGNED',
        sentAt: { lte: sevenDaysAgo },
      },
      include: {
        envelope: {
          select: {
            id: true,
            title: true,
            status: true,
            createdAt: true,
          },
        },
      },
    });

    return recipients.filter((r) => r.envelope?.status === 'PENDING');
  }),
});
