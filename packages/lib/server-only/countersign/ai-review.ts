import Anthropic from '@anthropic-ai/sdk';

import type {
  DocumentInfo,
  DocumentReviewResultV2,
  FlaggedClauseV2,
  RiskVerdict,
} from '@documenso/lib/types/countersign';
import { env } from '@documenso/lib/utils/env';
import { prisma } from '@documenso/prisma';

export type { DocumentInfo, DocumentReviewResultV2, FlaggedClauseV2, RiskVerdict };

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

export const jsonToStringArray = (value: unknown): string[] => {
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
      const cachedFlagged = jsonToFlaggedClauses(existing.flaggedClauses);
      console.log(
        '[countersign] getOrCreateDocumentReview: cache hit — flaggedClauses:',
        cachedFlagged.length,
        'summary items:',
        jsonToStringArray(existing.summary).length,
      );
      if (cachedFlagged.length > 0) {
        return {
          summary: jsonToStringArray(existing.summary),
          flaggedClauses: cachedFlagged,
          documentType: existing.documentType ?? null,
          diff: null,
        };
      }
      console.log(
        '[countersign] getOrCreateDocumentReview: cached flaggedClauses empty — re-analyzing',
      );
    }

    const anthropicApiKey = env('ANTHROPIC_API_KEY')?.trim();
    if (!anthropicApiKey) {
      return null;
    }

    const model = env('ANTHROPIC_MODEL')?.trim() || 'claude-sonnet-4-6';

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
      model,
      max_tokens: 4096,
      system: [
        'You are a legal document analyst helping signers understand what they are about to sign.',
        'Be plain, concise, and informational. This is not legal advice.',
        '',
        'When reviewing a document you MUST:',
        '1. Populate flaggedClauses with EVERY clause the signer should be aware of before signing.',
        '   Include substantive terms even if standard — a signer deserves to know what they are agreeing to.',
        '   Do NOT put clause details only in the summary and leave flaggedClauses empty.',
        '2. Use these assessment values:',
        '   - "standard": clause is common for this document type but worth knowing about',
        '   - "unusual": less common, one-sided, or has terms the signer may not expect',
        '   - "review": signer should read carefully — significant financial, legal, or rights implications',
        '3. For each flagged clause, "text" must be a VERBATIM excerpt from the document — copy the',
        '   exact wording so it can be located in the PDF. Do not paraphrase.',
      ].join('\n'),
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
                description:
                  'Every substantive clause in the document. MUST be populated — do not return an empty array for any document with meaningful terms. Each item must include verbatim text from the document.',
                items: {
                  type: 'object',
                  properties: {
                    clause: {
                      type: 'string',
                      description: 'Short clause name, e.g. "Non-compete"',
                    },
                    text: {
                      type: 'string',
                      description:
                        'VERBATIM excerpt copied directly from the document — do not paraphrase.',
                    },
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

    console.log(
      '[countersign] AI returned — flaggedClauses:',
      flaggedClauses.length,
      'summary items:',
      summary.length,
      'documentType:',
      reviewDocumentType,
    );

    const review: DocumentReviewResult = {
      summary,
      flaggedClauses,
      documentType: reviewDocumentType,
      diff,
    };

    await prisma.documentReview.upsert({
      where: { documentHash },
      create: {
        documentHash,
        summary,
        flaggedClauses,
        documentType: reviewDocumentType ?? undefined,
      },
      update: {
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

// ─── V2 ──────────────────────────────────────────────────────────────────────

const jsonToFlaggedClausesV2 = (value: unknown): FlaggedClauseV2[] => {
  if (!Array.isArray(value)) return [];
  const severities = new Set(['severe', 'notable', 'worth-reading']);
  const out: FlaggedClauseV2[] = [];
  for (const el of value) {
    if (!isRecord(el)) continue;
    if (
      typeof el.id === 'string' &&
      typeof el.severity === 'string' &&
      severities.has(el.severity) &&
      typeof el.title === 'string' &&
      typeof el.sectionReference === 'string' &&
      typeof el.sectionNumber === 'number' &&
      typeof el.clauseText === 'string' &&
      typeof el.whatItSays === 'string' &&
      typeof el.whatItMeansForYou === 'string'
    ) {
      out.push({
        id: el.id as string,
        severity: el.severity as FlaggedClauseV2['severity'],
        title: el.title as string,
        sectionReference: el.sectionReference as string,
        sectionNumber: el.sectionNumber as number,
        clauseText: el.clauseText as string,
        whatItSays: el.whatItSays as string,
        whatItMeansForYou: el.whatItMeansForYou as string,
      });
    }
  }
  return out;
};

export const jsonToDocumentReviewV2 = (value: unknown): DocumentReviewResultV2 | null => {
  if (!isRecord(value)) return null;
  const doc = value.document;
  const rv = value.riskVerdict;
  const summary = value.summary;
  let flaggedClausesRaw: unknown = value.flaggedClauses;
  if (typeof flaggedClausesRaw === 'string') {
    try {
      flaggedClausesRaw = JSON.parse(flaggedClausesRaw) as unknown;
    } catch {
      return null;
    }
  }
  if (
    !isRecord(doc) ||
    !isRecord(rv) ||
    !Array.isArray(summary) ||
    !Array.isArray(flaggedClausesRaw)
  ) {
    return null;
  }
  if (
    typeof doc.counterparty !== 'string' ||
    typeof doc.documentType !== 'string' ||
    typeof doc.sectionCount !== 'number' ||
    typeof doc.estimatedReadMinutes !== 'number'
  )
    return null;
  const validLevels = new Set(['high', 'mixed', 'standard']);
  if (typeof rv.level !== 'string' || !validLevels.has(rv.level) || typeof rv.headline !== 'string')
    return null;
  return {
    document: {
      counterparty: doc.counterparty as string,
      documentType: doc.documentType as string,
      sectionCount: doc.sectionCount as number,
      estimatedReadMinutes: doc.estimatedReadMinutes as number,
    },
    riskVerdict: {
      level: rv.level as RiskVerdict['level'],
      headline: rv.headline as string,
    },
    summary: jsonToStringArray(summary),
    flaggedClauses: jsonToFlaggedClausesV2(flaggedClausesRaw),
  };
};

export type RunDocumentReviewV2Options = {
  documentHash: string;
  documentText: string;
  priorDocumentText?: string;
};

export const runDocumentReviewV2 = async ({
  documentHash,
  documentText,
  priorDocumentText,
}: RunDocumentReviewV2Options): Promise<DocumentReviewResultV2 | null> => {
  try {
    const anthropicApiKey = env('ANTHROPIC_API_KEY')?.trim();
    if (!anthropicApiKey) return null;

    const model = env('ANTHROPIC_MODEL')?.trim() || 'claude-sonnet-4-6';
    const client = new Anthropic({ apiKey: anthropicApiKey });

    let userPrompt = `Document text:\n${documentText}`;
    if (priorDocumentText) {
      userPrompt += `\n\nPrior version for comparison:\n${priorDocumentText}`;
    }

    const response = await client.messages.create({
      model,
      max_tokens: 4096,
      system: [
        'You are a legal document analyst. Help signers understand what they are about to sign.',
        'Be informational and plain. Never recommend actions, negotiations, or legal strategy. This is not legal advice.',
        '',
        'Severity definitions:',
        '- "severe": significant financial liability, irreversible commitments, rights waivers',
        '  (e.g. liquidated damages over $100K, broad IP assignment, jury waivers, perpetual obligations)',
        '- "notable": unusual relative to standard documents of this type',
        '  (e.g. long non-competes, offshore jurisdiction, auto-renewal with short notice, one-sided indemnification)',
        '- "worth-reading": standard but contains choices the signer should know',
        '  (e.g. typical confidentiality terms, standard non-solicits)',
        '',
        'Risk verdict calibration (apply strictly):',
        '- "high": 3+ severe clauses OR 5+ flagged clauses total',
        '- "mixed": 1-2 severe clauses OR 3-4 flagged clauses total',
        '- "standard": 0 severe AND ≤2 flagged clauses total',
        '',
        'CRITICAL REQUIREMENTS:',
        '- clauseText MUST be a VERBATIM excerpt copied directly from the document — used to locate text in the PDF.',
        '- whatItMeansForYou must be informational only — describe consequences, never recommend actions.',
        '- Populate flaggedClauses with EVERY substantive clause. Do not return an empty array for any meaningful document.',
        "- Compare against typical documents of the identified type, not the signer's history.",
      ].join('\n'),
      tools: [
        {
          name: 'submit_document_review',
          description: 'Submit a complete structured review of the legal document.',
          input_schema: {
            type: 'object' as const,
            properties: {
              document: {
                type: 'object',
                description: 'Metadata about the document',
                properties: {
                  counterparty: {
                    type: 'string',
                    description: 'The party that is NOT the signer',
                  },
                  documentType: {
                    type: 'string',
                    description: 'e.g. "Mutual NDA", "Employment Agreement"',
                  },
                  sectionCount: {
                    type: 'number',
                    description: 'Approximate number of sections',
                  },
                  estimatedReadMinutes: {
                    type: 'number',
                    description: 'Estimated minutes to read at normal pace',
                  },
                },
                required: ['counterparty', 'documentType', 'sectionCount', 'estimatedReadMinutes'],
              },
              riskVerdict: {
                type: 'object',
                description: 'Overall risk assessment',
                properties: {
                  level: {
                    type: 'string',
                    enum: ['high', 'mixed', 'standard'],
                    description: 'Apply the calibration rules strictly',
                  },
                  headline: {
                    type: 'string',
                    description: 'One short sentence summarizing overall risk level',
                  },
                },
                required: ['level', 'headline'],
              },
              summary: {
                type: 'array',
                items: { type: 'string' },
                minItems: 2,
                maxItems: 4,
                description: '2-4 plain-English bullets summarizing what this document does',
              },
              flaggedClauses: {
                type: 'array',
                description:
                  'Every substantive clause the signer should know about. MUST be populated for any meaningful document.',
                items: {
                  type: 'object',
                  properties: {
                    id: {
                      type: 'string',
                      description: 'Stable kebab-case id, e.g. "non-compete-2yr"',
                    },
                    severity: {
                      type: 'string',
                      enum: ['severe', 'notable', 'worth-reading'],
                    },
                    title: { type: 'string', description: 'Short clause title' },
                    sectionReference: {
                      type: 'string',
                      description: 'e.g. "Section 9" or "§ 4.2"',
                    },
                    sectionNumber: {
                      type: 'number',
                      description: 'Integer section number, 0 if not clearly numbered',
                    },
                    clauseText: {
                      type: 'string',
                      description:
                        'VERBATIM excerpt copied directly from the document — do not paraphrase',
                    },
                    whatItSays: {
                      type: 'string',
                      description: 'One sentence neutral description of the clause',
                    },
                    whatItMeansForYou: {
                      type: 'string',
                      description:
                        'Informational consequences for the signer — no advice or recommendations',
                    },
                  },
                  required: [
                    'id',
                    'severity',
                    'title',
                    'sectionReference',
                    'sectionNumber',
                    'clauseText',
                    'whatItSays',
                    'whatItMeansForYou',
                  ],
                },
              },
            },
            required: ['document', 'riskVerdict', 'summary', 'flaggedClauses'],
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
    if (!isRecord(input)) return null;

    const result = jsonToDocumentReviewV2(input);
    if (!result) {
      console.error('[countersign] runDocumentReviewV2: failed to parse AI response', input);
      return null;
    }

    const severityCount = result.flaggedClauses.reduce<Record<string, number>>((acc, c) => {
      acc[c.severity] = (acc[c.severity] ?? 0) + 1;
      return acc;
    }, {});
    console.log(
      '[countersign] runDocumentReviewV2 — flaggedClauses:',
      result.flaggedClauses.length,
      'severity:',
      severityCount,
      'riskLevel:',
      result.riskVerdict.level,
    );

    // Map V2 clauses to legacy shape for backward-compat columns
    const legacyFlagged = result.flaggedClauses.map((c) => ({
      clause: c.title,
      text: c.clauseText,
      assessment:
        c.severity === 'severe' ? 'review' : c.severity === 'notable' ? 'unusual' : 'standard',
      note: c.whatItSays,
    }));

    await prisma.documentReview.upsert({
      where: { documentHash },
      create: {
        documentHash,
        summary: result.summary,
        flaggedClauses: legacyFlagged,
        documentType: result.document.documentType,
        rawReview: result as unknown as Record<string, unknown>,
      },
      update: {
        summary: result.summary,
        flaggedClauses: legacyFlagged,
        documentType: result.document.documentType,
        rawReview: result as unknown as Record<string, unknown>,
      },
    });

    return result;
  } catch (err) {
    console.error('[countersign] runDocumentReviewV2 error:', err);
    return null;
  }
};
