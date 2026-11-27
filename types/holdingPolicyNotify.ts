import type { HoldingPolicy } from './holdingPolicy';
import type { NotifyManifestTurtleHolding, NotifyManifestTurtleReentryPosition, NotifyManifestTurtleWatch } from '../utils/notifyManifest';

export interface PolicyNotifyHolding extends NotifyManifestTurtleHolding {
  policy: HoldingPolicy;
  remainingPrincipalKRW: number | null;
  position?: NotifyManifestTurtleReentryPosition;
}

export interface PolicyNotifyWatch extends NotifyManifestTurtleWatch {
  soldAt: string;
}

/** 구버전 GAS는 이 섹션 전체를 무시한다. 정책 종목을 옛 신호 목록에 중복해서 싣지 않는다. */
export interface PolicyNotifySection {
  holdings: PolicyNotifyHolding[];
  watchItems: PolicyNotifyWatch[];
}
