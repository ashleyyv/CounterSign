import Anthropic from '@anthropic-ai/sdk';

import { prisma } from '@documenso/prisma';

export type FlaggedClause = {
  clause: string;
  text: string;
  assessment: string;
  note: string;
};

export type DiffItem = {
  clause: string;
  change: string;
};

export type DocumentReviewResult = {
  summary: string[];
  flaggedClauses: FlaggedClause[];
  documentType: string | null;
  diff: DiffItem[] | null;
};

export type GetOrCreateDocumentReviewOptions = {
  documentHash: string;
  documentText: string;
  documentType?: string;
  priorDocumentText?: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const jsonToStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((x): x is string => typeof x === 'string');
};

export const jsonToFlaggedClauses = (value: unknown): FlaggedClause[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: FlaggedClause[] = [];
  for (const el of value) {
    if (!isRecord(el)) {
      continue;
    }
    const { clause, text, assessment, note } = el;
    if (
      typeof clause === 'string' &&
      typeof text === 'string' &&
      typeof assessment === 'string' &&
      typeof note === 'string'
    ) {
      out.push({ clause, text, assessment, note });
    }
  }
  return out;
};

const jsonToDiffItems = (value: unknown): DiffItem[] | null => {
  if (value === null || value === undefined) {
    return null;
  }
  if (!Array.isArray(value)) {
    return null;
  }
  const out: DiffItem[] = [];
  for (const el of value) {
    if (!isRecord(el)) {
      continue;
    }
    if (typeof el.clause === 'string' && typeof el.change === 'string') {
      out.push({ clause: el.clause, change: el.change });
    }
  }
  return out;
};

export const getOrCreateDocumentReview = async ({
  documentHash,
  documentText,
  documentType: documentTypeHint,
  priorDocumentText,
}: GetOrCreateDocumentReviewOptions): Promise<DocumentReviewResult | null> => {
  try {
    const existing = await prisma.documentReview.findUnique({
      where: { documentHash },
    });

    if (existing) {
      return {
        summary: jsonToStringArray(existing.summary),
        flaggedClauses: jsonToFlaggedClauses(existing.flaggedClauses),
        documentType: existing.documentType ?? null,
        diff: null,
      };
    }

    const anthropicApiKey = process.env.ANTHROPIC_API_KEY?.trim();
    if (!anthropicApiKey) {
      return null;
    }

    let userPrompt = '';

    if (documentTypeHint) {
      userPrompt += `Document type hint: ${documentTypeHint}\n\n`;
    }

    userPrompt += `Document text:\n${documentText}`;

    if (priorDocumentText) {
      userPrompt +=
        `\n\nA prior version of this document is provided below. ` +
        `Populate the "diff" field with plain-English descriptions of what changed per clause.\n\n` +
        `Prior document text:\n${priorDocumentText}`;
    } else {
      userPrompt += `\n\nSet "diff" to null — no prior document provided.`;
    }

    const client = new Anthropic({ apiKey: anthropicApiKey });

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system:
        'You are a legal document analyst helping signers understand what they are about to sign. Be plain, concise, and helpful. This is not legal advice.',
      tools: [
        {
          name: 'submit_document_review',
          description: 'Submit a structured review of the document.',
          input_schema: {
            type: 'object' as const,
            properties: {
              summary: {
                type: 'array',
                items: { type: 'string' },
                minItems: 3,
                maxItems: 3,
                description: 'Exactly 3 plain-English bullet points summarising the document.',
              },
              flaggedClauses: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    clause: {
                      type: 'string',
                      description: 'Short clause name, e.g. "Non-compete"',
                    },
                    text: { type: 'string', description: 'The actual clause text' },
                    assessment: { type: 'string', enum: ['standard', 'unusual', 'review'] },
                    note: { type: 'string', description: 'Plain-English explanation' },
                  },
                  required: ['clause', 'text', 'assessment', 'note'],
                },
              },
              documentType: {
                type: ['string', 'null'],
                description: 'Detected document type, e.g. "NDA", "Employment agreement"',
              },
              diff: {
                type: ['array', 'null'],
                items: {
                  type: 'object',
                  properties: {
                    clause: { type: 'string' },
                    change: {
                      type: 'string',
                      description: 'Plain-English description of the change',
                    },
                  },
                  required: ['clause', 'change'],
                },
                description: 'Clause-level diff vs prior document. Null if no prior document.',
              },
            },
            required: ['summary', 'flaggedClauses', 'documentType', 'diff'],
          },
        },
      ],
      tool_choice: { type: 'tool', name: 'submit_document_review' },
      messages: [{ role: 'user', content: userPrompt }],
    });

    const toolUse = response.content.find((block) => block.type === 'tool_use');

    if (!toolUse || toolUse.type !== 'tool_use') {
      return null;
    }

    const input = toolUse.input;
    if (!isRecord(input)) {
      return null;
    }

    const summary = jsonToStringArray(input.summary);
    const flaggedClauses = jsonToFlaggedClauses(input.flaggedClauses);
    const dt = input.documentType;
    const reviewDocumentType = dt === null || dt === undefined ? null : String(dt);
    const diff =
      input.diff === null || input.diff === undefined ? null : jsonToDiffItems(input.diff);

    const review: DocumentReviewResult = {
      summary,
      flaggedClauses,
      documentType: reviewDocumentType,
      diff,
    };

    await prisma.documentReview.create({
      data: {
        documentHash,
        summary,
        flaggedClauses,
        documentType: reviewDocumentType ?? undefined,
      },
    });

    return review;
  } catch (err) {
    console.error('[countersign] getOrCreateDocumentReview error:', err);
    return null;
  }
};
