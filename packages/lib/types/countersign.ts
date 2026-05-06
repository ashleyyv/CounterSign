export type DiffChange = {
  id: string;
  changeType: 'increased' | 'decreased' | 'added' | 'removed' | 'swapped';
  severity: 'severe' | 'notable' | 'worth-reading';
  sectionReference: string;
  sectionNumber: number;
  clauseText: string;
  chipLabel: string;
  title: string;
  previousValue: string | null;
  currentValue: string | null;
  whatChanged: string;
  whatItMeansForYou: string;
  matchingFlaggedClauseId: string | null;
};

export type PriorDocumentInfo = {
  id: string;
  signedDate: string;
  documentType: string;
};

export type DocumentDiffResult = {
  priorDocument: PriorDocumentInfo;
  changes: DiffChange[];
};

export type FlaggedClauseV2 = {
  id: string;
  severity: 'severe' | 'notable' | 'worth-reading';
  title: string;
  sectionReference: string;
  sectionNumber: number;
  clauseText: string;
  whatItSays: string;
  whatItMeansForYou: string;
};

export type DocumentInfo = {
  counterparty: string;
  documentType: string;
  sectionCount: number;
  estimatedReadMinutes: number;
};

export type RiskVerdict = {
  level: 'high' | 'mixed' | 'standard';
  headline: string;
};

export type DocumentReviewResultV2 = {
  document: DocumentInfo;
  riskVerdict: RiskVerdict;
  summary: string[];
  flaggedClauses: FlaggedClauseV2[];
};
