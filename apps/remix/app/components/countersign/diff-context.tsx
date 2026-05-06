import React, { createContext, useContext, useState } from 'react';

import type { DocumentDiffResult } from '@documenso/lib/types/countersign';

type DiffContextValue = {
  diffResult: DocumentDiffResult | null;
  setDiffResult: (result: DocumentDiffResult | null) => void;
  activeDiffChipId: string | null;
  setActiveDiffChipId: (id: string | null) => void;
};

const DiffContext = createContext<DiffContextValue | null>(null);

export const DiffProvider = ({ children }: { children: React.ReactNode }) => {
  const [diffResult, setDiffResult] = useState<DocumentDiffResult | null>(null);
  const [activeDiffChipId, setActiveDiffChipId] = useState<string | null>(null);

  return (
    <DiffContext.Provider
      value={{ diffResult, setDiffResult, activeDiffChipId, setActiveDiffChipId }}
    >
      {children}
    </DiffContext.Provider>
  );
};

export const useDiff = () => {
  const ctx = useContext(DiffContext);

  if (!ctx) {
    throw new Error('useDiff must be used within DiffProvider');
  }

  return ctx;
};

export const useOptionalDiff = () => useContext(DiffContext);
