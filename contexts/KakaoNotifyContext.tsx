import type { PropsWithChildren } from 'react';
import { KakaoNotifyContext, useKakaoNotifyState } from '../hooks/useKakaoNotify';

export function KakaoNotifyProvider({ children }: PropsWithChildren) {
  const value = useKakaoNotifyState();
  return <KakaoNotifyContext.Provider value={value}>{children}</KakaoNotifyContext.Provider>;
}
