import React, { createContext, useContext, useState } from 'react';
import type { TurtleHoldingsSettings } from '../types/turtleHoldings';

function useDraftState() {
  return useState<Partial<TurtleHoldingsSettings>>({});
}

const DraftContext = createContext<ReturnType<typeof useDraftState> | null>(null);

export function TurtleSettingsDraftProvider({ children }: React.PropsWithChildren) {
  const draft = useDraftState();
  return <DraftContext.Provider value={draft}>{children}</DraftContext.Provider>;
}

export function useTurtleSettingsDraft() {
  const session = useContext(DraftContext);
  const local = useDraftState();
  return session ?? local;
}
