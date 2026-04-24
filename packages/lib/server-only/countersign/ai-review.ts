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

export const getOrCreateDocumentReview = async ({
  documentHash,
  documentText,
  documentType,
  priorDocumentText,
}: GetOrCreateDocumentReviewOptions): Promise<DocumentReviewResult | null> => {
  try {
    const existing = await prisma.documentReview.findUnique({
      where: { documentHash },
    });

    if (existing) {
      return {
        summary: existing.summary as string[],
        flaggedClauses: existing.flaggedClauses as FlaggedClause[],
        documentType: existing.documentType ?? null,
        diff: null,
      };
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return null;
    }

    let userPrompt = '';

    if (documentType) {
      userPrompt += `Document type hint: ${documentType}\n\n`;
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

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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

    const review = toolUse.input as DocumentReviewResult;

    await prisma.documentReview.create({
      data: {
        documentHash,
        summary: review.summary,
        flaggedClauses: review.flaggedClauses as object[],
        documentType: review.documentType ?? undefined,
      },
    });

    return review;
  } catch (err) {
    console.error('[countersign] getOrCreateDocumentReview error:', err);
    return null;
  }
};
