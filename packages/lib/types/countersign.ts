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
