import Anthropic from '@anthropic-ai/sdk';
import crypto from 'crypto';

import type {
  DiffChange,
  DocumentDiffResult,
  FlaggedClauseV2,
} from '@documenso/lib/types/countersign';
import { getFileServerSide } from '@documenso/lib/universal/upload/get-file.server';
import { env } from '@documenso/lib/utils/env';
import { prisma } from '@documenso/prisma';

import { jsonToDocumentReviewV2 } from './ai-review';

export type GenerateEnvelopeDiffOptions = {
  envelopeId: string;
  recipientEmail: string;
};

export type GenerateEnvelopeDiffResult =
  | { status: 'ok'; data: DocumentDiffResult }
  | { status: 'no_prior' }
  | { status: 'same_document' }
  | { status: 'unavailable' };

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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const enforcedChipLabel = (label: string): string => {
  if (label.length <= 12) {
    return label;
  }
  // Preserve the leading glyph (first char, which may be a multi-byte emoji)
  const chars = [...label];
  const glyph = chars[0] ?? '';
  return (glyph + label.slice(glyph.length, 12)).trimEnd();
};

const jsonToDiffChange = (el: unknown): DiffChange | null => {
  if (!isRecord(el)) {
    return null;
  }
  const changeTypes = new Set(['increased', 'decreased', 'added', 'removed', 'swapped']);
  const severities = new Set(['severe', 'notable', 'worth-reading']);

  if (
    typeof el.id !== 'string' ||
    typeof el.changeType !== 'string' ||
    !changeTypes.has(el.changeType) ||
    typeof el.severity !== 'string' ||
    !severities.has(el.severity) ||
    typeof el.sectionReference !== 'string' ||
    typeof el.sectionNumber !== 'number' ||
    typeof el.clauseText !== 'string' ||
    typeof el.chipLabel !== 'string' ||
    typeof el.title !== 'string' ||
    typeof el.whatChanged !== 'string' ||
    typeof el.whatItMeansForYou !== 'string'
  ) {
    return null;
  }

  const previousValue =
    el.previousValue === null || el.previousValue === undefined
      ? null
      : typeof el.previousValue === 'string'
        ? el.previousValue
        : null;

  const currentValue =
    el.currentValue === null || el.currentValue === undefined
      ? null
      : typeof el.currentValue === 'string'
        ? el.currentValue
        : null;

  const matchingFlaggedClauseId =
    el.matchingFlaggedClauseId === null || el.matchingFlaggedClauseId === undefined
      ? null
      : typeof el.matchingFlaggedClauseId === 'string'
        ? el.matchingFlaggedClauseId
        : null;

  return {
    id: el.id as string,
    changeType: el.changeType as DiffChange['changeType'],
    severity: el.severity as DiffChange['severity'],
    sectionReference: el.sectionReference as string,
    sectionNumber: el.sectionNumber as number,
    clauseText: el.clauseText as string,
    chipLabel: enforcedChipLabel(el.chipLabel as string),
    title: el.title as string,
    previousValue,
    currentValue,
    whatChanged: el.whatChanged as string,
    whatItMeansForYou: el.whatItMeansForYou as string,
    matchingFlaggedClauseId,
  };
};

export const jsonToDocumentDiffResult = (value: unknown): DocumentDiffResult | null => {
  if (!isRecord(value)) {
    return null;
  }

  const priorDoc = value.priorDocument;
  if (!isRecord(priorDoc)) {
    return null;
  }
  if (
    typeof priorDoc.id !== 'string' ||
    typeof priorDoc.signedDate !== 'string' ||
    typeof priorDoc.documentType !== 'string'
  ) {
    return null;
  }

  // Treat missing, null, or non-array changes as an empty list — the AI sometimes
  // omits the field entirely when documents are functionally identical.
  const changesRaw = value.changes;
  const changesArr = Array.isArray(changesRaw) ? changesRaw : [];

  const changes: DiffChange[] = [];
  for (const el of changesArr) {
    const change = jsonToDiffChange(el);
    if (change) {
      changes.push(change);
    }
  }

  return {
    priorDocument: {
      id: priorDoc.id as string,
      signedDate: priorDoc.signedDate as string,
      documentType: priorDoc.documentType as string,
    },
    changes,
  };
};

export const generateEnvelopeDiff = async (
  opts: GenerateEnvelopeDiffOptions,
): Promise<GenerateEnvelopeDiffResult> => {
  try {
    return await generateEnvelopeDiffInner(opts);
  } catch (err) {
    console.error('[countersign] generateEnvelopeDiff error:', err);
    return { status: 'unavailable' };
  }
};

// ─── Mock data for UI development (COUNTERSIGN_DIFF_MOCK=true) ───────────────

const MOCK_DIFF_RESULT: DocumentDiffResult = {
  priorDocument: {
    id: 'mock-prior-doc',
    signedDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    documentType: 'Mutual NDA',
  },
  changes: [
    {
      id: 'term-duration-increase',
      changeType: 'increased',
      severity: 'severe',
      sectionReference: 'Section 4',
      sectionNumber: 4,
      clauseText: 'confidential information',
      chipLabel: '↑ 5 yrs',
      title: 'Confidentiality term doubled',
      previousValue: '2 years',
      currentValue: '5 years',
      whatChanged: 'The confidentiality obligation period increased from 2 years to 5 years.',
      whatItMeansForYou:
        'You are bound by confidentiality for 5 years after the agreement ends instead of 2.',
      matchingFlaggedClauseId: null,
    },
    {
      id: 'liquidated-damages-added',
      changeType: 'added',
      severity: 'severe',
      sectionReference: 'Section 9',
      sectionNumber: 9,
      clauseText: 'intellectual property',
      chipLabel: '✦ NEW',
      title: 'Liquidated damages clause added',
      previousValue: null,
      currentValue: '$50,000 per breach',
      whatChanged:
        'A liquidated damages clause of $50,000 per breach was not present in the prior version.',
      whatItMeansForYou:
        'You could owe $50,000 per breach of this agreement — this clause did not exist before.',
      matchingFlaggedClauseId: null,
    },
    {
      id: 'jurisdiction-swap',
      changeType: 'swapped',
      severity: 'notable',
      sectionReference: 'Section 12',
      sectionNumber: 12,
      clauseText: 'governing law',
      chipLabel: '⇄ BVI',
      title: 'Jurisdiction changed to BVI',
      previousValue: 'Delaware, USA',
      currentValue: 'British Virgin Islands',
      whatChanged:
        'The governing jurisdiction changed from Delaware to the British Virgin Islands.',
      whatItMeansForYou:
        'Any disputes would be resolved under BVI law, which may be less accessible to you.',
      matchingFlaggedClauseId: null,
    },
    {
      id: 'notice-period-decrease',
      changeType: 'decreased',
      severity: 'notable',
      sectionReference: 'Section 7',
      sectionNumber: 7,
      clauseText: 'termination',
      chipLabel: '↓ 15 days',
      title: 'Termination notice reduced',
      previousValue: '60 days',
      currentValue: '15 days',
      whatChanged: 'Required notice period for termination dropped from 60 days to 15 days.',
      whatItMeansForYou:
        'The other party can end the agreement with only 15 days notice instead of 60.',
      matchingFlaggedClauseId: null,
    },
    {
      id: 'non-solicit-removed',
      changeType: 'removed',
      severity: 'worth-reading',
      sectionReference: 'Section 6',
      sectionNumber: 6,
      clauseText: 'non-solicitation',
      chipLabel: '✕ REMOVED',
      title: 'Non-solicitation clause removed',
      previousValue: 'Mutual 12-month non-solicitation',
      currentValue: null,
      whatChanged: 'The mutual non-solicitation clause present in the prior version was removed.',
      whatItMeansForYou: "Neither party is restricted from soliciting the other's employees.",
      matchingFlaggedClauseId: null,
    },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────

const generateEnvelopeDiffInner = async ({
  envelopeId,
  recipientEmail,
}: GenerateEnvelopeDiffOptions): Promise<GenerateEnvelopeDiffResult> => {
  const isMock = env('COUNTERSIGN_DIFF_MOCK')?.trim() === 'true';

  const envelope = await prisma.envelope.findUnique({
    where: { id: envelopeId },
    include: {
      envelopeItems: { include: { documentData: true }, take: 1 },
    },
  });

  if (!envelope || envelope.envelopeItems.length === 0) {
    return { status: 'unavailable' };
  }

  const item = envelope.envelopeItems[0];
  const currentBytes = await getFileServerSide(item.documentData);
  const currentDocumentHash = crypto
    .createHash('sha256')
    .update(Buffer.from(currentBytes))
    .digest('hex');

  // Find the most recent prior envelope from the same sender where this recipient signed
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
          envelopeItems: { include: { documentData: true }, take: 1 },
        },
      },
    },
  });

  if (!priorRecipient || priorRecipient.envelope.envelopeItems.length === 0) {
    return { status: 'no_prior' };
  }

  const priorItem = priorRecipient.envelope.envelopeItems[0];
  const priorBytes = await getFileServerSide(priorItem.documentData);
  const priorDocumentHash = crypto
    .createHash('sha256')
    .update(Buffer.from(priorBytes))
    .digest('hex');

  if (currentDocumentHash === priorDocumentHash) {
    return { status: 'same_document' };
  }

  // Return mock data immediately when flag is set — skips AI call and DB cache.
  if (isMock) {
    console.log(
      '[countersign] generateEnvelopeDiff: returning mock diff (COUNTERSIGN_DIFF_MOCK=true)',
    );
    return { status: 'ok', data: MOCK_DIFF_RESULT };
  }

  // Cache check
  const cached = await prisma.documentDiff.findUnique({
    where: {
      currentDocumentHash_priorDocumentHash: {
        currentDocumentHash,
        priorDocumentHash,
      },
    },
  });

  if (cached) {
    const result = jsonToDocumentDiffResult(cached.rawDiff);
    if (result) {
      return { status: 'ok', data: result };
    }
  }

  // Parse PDFs for text
  let currentDocumentText = envelope.title;
  try {
    const parsed = await parsePdf(Buffer.from(currentBytes));
    if (parsed.text?.trim()) {
      currentDocumentText = parsed.text;
    }
  } catch {
    // fall back to envelope title
  }

  let priorDocumentText = priorRecipient.envelope.title ?? '';
  try {
    const parsed = await parsePdf(Buffer.from(priorBytes));
    if (parsed.text?.trim()) {
      priorDocumentText = parsed.text;
    }
  } catch {
    // fall back to prior envelope title
  }

  // Load flagged clauses from the baseline review of the current document so
  // the AI can set matchingFlaggedClauseId correctly.
  let flaggedClausesFromCache: FlaggedClauseV2[] = [];
  try {
    const baselineReview = await prisma.documentReview.findUnique({
      where: { documentHash: currentDocumentHash },
    });
    if (baselineReview?.rawReview) {
      const v2 = jsonToDocumentReviewV2(baselineReview.rawReview);
      if (v2) {
        flaggedClausesFromCache = v2.flaggedClauses;
      }
    }
  } catch {
    // proceed without flagged clauses
  }

  const priorSignedDate = priorRecipient.signedAt
    ? priorRecipient.signedAt.toISOString().slice(0, 10)
    : 'unknown';

  const apiKey = env('ANTHROPIC_API_KEY')?.trim();
  if (!apiKey) {
    return { status: 'unavailable' };
  }

  const model = env('ANTHROPIC_MODEL')?.trim() || 'claude-sonnet-4-6';
  const client = new Anthropic({ apiKey });

  const systemPrompt = [
    'You are a legal document analyst. Compare two versions of a legal document and return a structured diff showing what changed.',
    '',
    'CRITICAL REQUIREMENTS:',
    '- changeType must be one of: increased, decreased, added, removed, swapped',
    '- severity must be one of: severe, notable, worth-reading',
    '- chipLabel: max 12 characters total. Must start with one of: ↑ ↓ ✦ ✕ ⇄ followed by a space and short value. Examples: "↑ 20 yrs", "↓ 15 days", "✦ NEW", "✕ REMOVED", "⇄ BVI". If unsure, use just the symbol.',
    '- clauseText: VERBATIM excerpt from the CURRENT document (used to anchor chips in the PDF)',
    '- whatItMeansForYou: informational only — describe consequences, never recommend actions or negotiations',
    '- previousValue/currentValue: null for added/removed clauses respectively',
    "- matchingFlaggedClauseId: if a change overlaps an existing flagged clause in the current document's review, set this to that clause's id. Otherwise null.",
    '- When documents are substantively identical or you find no meaningful differences, return changes: [] (an empty array). NEVER omit the changes field.',
    '- Return JSON only via the tool call. No prose.',
  ].join('\n');

  const userPrompt = [
    `Current document text:\n${currentDocumentText}`,
    '',
    `Prior document text (signed on ${priorSignedDate}):\n${priorDocumentText}`,
    '',
    `Current document's existing flagged clauses (for matchingFlaggedClauseId linking):\n${JSON.stringify(flaggedClausesFromCache, null, 2)}`,
  ].join('\n');

  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    system: systemPrompt,
    tools: [
      {
        name: 'submit_document_diff',
        description: 'Submit a structured diff between the current and prior document versions.',
        input_schema: {
          type: 'object' as const,
          properties: {
            priorDocument: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                signedDate: { type: 'string' },
                documentType: { type: 'string' },
              },
              required: ['id', 'signedDate', 'documentType'],
            },
            changes: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  changeType: {
                    type: 'string',
                    enum: ['increased', 'decreased', 'added', 'removed', 'swapped'],
                  },
                  severity: {
                    type: 'string',
                    enum: ['severe', 'notable', 'worth-reading'],
                  },
                  sectionReference: { type: 'string' },
                  sectionNumber: { type: 'number' },
                  clauseText: { type: 'string' },
                  chipLabel: { type: 'string' },
                  title: { type: 'string' },
                  previousValue: { type: ['string', 'null'] },
                  currentValue: { type: ['string', 'null'] },
                  whatChanged: { type: 'string' },
                  whatItMeansForYou: { type: 'string' },
                  matchingFlaggedClauseId: { type: ['string', 'null'] },
                },
                required: [
                  'id',
                  'changeType',
                  'severity',
                  'sectionReference',
                  'sectionNumber',
                  'clauseText',
                  'chipLabel',
                  'title',
                  'previousValue',
                  'currentValue',
                  'whatChanged',
                  'whatItMeansForYou',
                  'matchingFlaggedClauseId',
                ],
              },
            },
          },
          required: ['priorDocument', 'changes'],
        },
      },
    ],
    tool_choice: { type: 'tool', name: 'submit_document_diff' },
    messages: [{ role: 'user', content: userPrompt }],
  });

  const toolUse = response.content.find((block) => block.type === 'tool_use');
  if (!toolUse || toolUse.type !== 'tool_use') {
    return { status: 'unavailable' };
  }

  const aiInput = toolUse.input;
  const diffResult = jsonToDocumentDiffResult(aiInput);
  if (!diffResult) {
    console.error('[countersign] generateEnvelopeDiff: failed to parse AI response', aiInput);
    return { status: 'unavailable' };
  }

  // Enforce chipLabel ≤12 chars on all changes (AI may still exceed the limit)
  const sanitizedChanges = diffResult.changes.map((c) => ({
    ...c,
    chipLabel: enforcedChipLabel(c.chipLabel),
  }));

  const result: DocumentDiffResult = {
    priorDocument: diffResult.priorDocument,
    changes: sanitizedChanges,
  };

  // Only cache when the AI found actual changes. An empty result may mean the AI
  // missed differences on this call; not caching lets the next request retry.
  if (result.changes.length === 0) {
    return { status: 'ok', data: result };
  }

  await prisma.documentDiff.upsert({
    where: {
      currentDocumentHash_priorDocumentHash: {
        currentDocumentHash,
        priorDocumentHash,
      },
    },
    create: {
      currentDocumentHash,
      priorDocumentHash,
      rawDiff: result as unknown as Record<string, unknown>,
      aiModelVersion: model,
    },
    update: {
      rawDiff: result as unknown as Record<string, unknown>,
      aiModelVersion: model,
    },
  });

  return { status: 'ok', data: result };
};
