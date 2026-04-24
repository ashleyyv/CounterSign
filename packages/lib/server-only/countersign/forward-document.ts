import { mailer } from '@documenso/email/mailer';
import { AppError, AppErrorCode } from '@documenso/lib/errors/app-error';
import { getFileServerSide } from '@documenso/lib/universal/upload/get-file.server';
import { prisma } from '@documenso/prisma';

export type ForwardDocumentOptions = {
  envelopeId: string;
  senderId: number;
  targetEmail: string;
  targetLabel: string;
};

export const forwardDocument = async ({
  envelopeId,
  senderId,
  targetEmail,
  targetLabel: _targetLabel,
}: ForwardDocumentOptions): Promise<void> => {
  const envelope = await prisma.envelope.findUnique({
    where: { id: envelopeId },
    include: {
      envelopeItems: {
        include: {
          documentData: true,
        },
      },
      user: {
        select: {
          name: true,
          email: true,
        },
      },
      team: {
        select: {
          url: true,
        },
      },
    },
  });

  if (!envelope) {
    throw new AppError(AppErrorCode.NOT_FOUND, {
      message: 'Envelope not found',
    });
  }

  const senderName = envelope.user.name || envelope.user.email;
  const subject = `${envelope.title} — forwarded by ${senderName}`;
  const bodyText = 'Please find the signed document attached.';
  const bodyHtml = '<p>Please find the signed document attached.</p>';

  const attachments = await Promise.all(
    envelope.envelopeItems.map(async (item) => {
      const pdfBytes = await getFileServerSide(item.documentData);

      return {
        filename: `${item.title}.pdf`,
        content: Buffer.from(pdfBytes),
        contentType: 'application/pdf' as const,
      };
    }),
  );

  await mailer.sendMail({
    to: targetEmail,
    from: process.env.NEXT_PRIVATE_SMTP_FROM_ADDRESS || 'noreply@documenso.com',
    subject,
    html: bodyHtml,
    text: bodyText,
    attachments,
  });

  await prisma.forwardEvent.create({
    data: {
      envelopeId,
      senderId,
      targetEmail,
    },
  });
};
