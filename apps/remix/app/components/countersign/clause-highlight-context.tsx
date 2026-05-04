import React, { createContext, useContext, useState } from 'react';

export type TextBound = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PageHighlight = {
  page: number;
  bounds: TextBound[];
};

export type ClauseHighlight = {
  clauseText: string;
  pages: PageHighlight[];
};

type ClauseHighlightContextValue = {
  activeHighlight: ClauseHighlight | null;
  setActiveHighlight: (h: ClauseHighlight | null) => void;
};

const ClauseHighlightContext = createContext<ClauseHighlightContextValue | null>(null);

export const ClauseHighlightProvider = ({ children }: { children: React.ReactNode }) => {
  const [activeHighlight, setActiveHighlight] = useState<ClauseHighlight | null>(null);

  return (
    <ClauseHighlightContext.Provider value={{ activeHighlight, setActiveHighlight }}>
      {children}
    </ClauseHighlightContext.Provider>
  );
};

export const useClauseHighlight = () => {
  const ctx = useContext(ClauseHighlightContext);
  if (!ctx) throw new Error('useClauseHighlight must be used within ClauseHighlightProvider');
  return ctx;
};

export const useOptionalClauseHighlight = () => useContext(ClauseHighlightContext);
