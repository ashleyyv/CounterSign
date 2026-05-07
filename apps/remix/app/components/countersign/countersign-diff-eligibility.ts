/**
 * Gate Counterparty Diff (panel banner + margin chips + getDiff fetch) so it only loads for this
 * mock attachment. Adjust or remove once diff is generalized per attachment.
 */
export const COUNTERSIGN_DIFF_ATTACHMENT_TITLE = 'MockNDA_AcmeVentures_v2.pdf';

export const shouldShowCountersignDiff = (
  envelopeAttachmentTitle: string | null | undefined,
): boolean =>
  typeof envelopeAttachmentTitle === 'string' &&
  envelopeAttachmentTitle.trim() === COUNTERSIGN_DIFF_ATTACHMENT_TITLE;
