## 구현 개요
- hooks/usePortfolioData.ts에서 계산/변환(mapToNewAssetStructure)과 페칭/상태 로직을 분리
- 계산 로직과 관련 의존성을 utils/portfolioCalculations.ts로 이동
- 이동된 함수는 순수 함수로 유지

## 3단계 계획
1. utils/portfolioCalculations.ts 생성
   - mapToNewAssetStructure(asset: LegacyAssetShape): Asset export
   - 함수 내부 EXCHANGE_MAP 상수 포함(현 기본값 로직 유지)
   - AssetCategory, Currency, LegacyAssetShape, Asset 등 types에서 import
2. hooks/usePortfolioData.ts 수정
   - 기존 mapToNewAssetStructure 정의 제거
   - utils/portfolioCalculations.ts에서 import해 사용
   - 훅 반환 객체에 mapToNewAssetStructure를 그대로 노출하여 외부 호환성 유지
3. 검증
   - 타입/빌드 에러 확인
   - Google Drive 로드 경로에서 runMigrationIfNeeded → mapToNewAssetStructure 정상 적용 확인
   - 자동 저장/로그아웃/초기화 등 페칭/상태 흐름 무변화 검증

## 준수 사항
- 의존성 완전 이동 또는 적절 import로 누락/에러 방지
- utils의 함수는 외부 상태에 의존하지 않는 순수 함수로 유지