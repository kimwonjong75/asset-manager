## 문제 진단
- UI 트리거: `Header`가 `onImport={fullImportHandler}`로 연결됨 (`components/Header.tsx`, `App.tsx:426–437`).
- 실제 처리: `App.tsx:329–374`의 `fullImportHandler`가 파일을 읽고 `JSON.parse`까지만 수행하며 상태 업데이트가 없음.
- 보조 핸들러: `handleImportAssetsFromFile`도 동일하게 파싱 후 상태 반영 로직이 미완성 (`App.tsx:263–326`).
- 매핑 유틸: `mapToNewAssetStructure`가 `hooks/usePortfolioData.ts` 내부에 존재하며 훅 반환값으로 제공되지만 `App.tsx`에서 구조분해에 포함되지 않아 사용되고 있지 않음 (`hooks/usePortfolioData.ts:65–63, 181–203`).
- 마이그레이션 유틸: `runMigrationIfNeeded`가 존재하여 불러온 데이터의 정합성을 보정 가능 (`utils/migrateData.ts`).

## 수정 계획
1. `fullImportHandler` 완성
- 파일 선택 → `JSON.parse` → `runMigrationIfNeeded(loadedData)` 적용
- 구조 추출: `assets`, `portfolioHistory`, `sellHistory`, `watchlist`, `exchangeRates`
- 자산 배열을 `mapToNewAssetStructure`로 변환
- `updateAllData(newAssets, newHistory, newSells, newWatchlist, sanitizedRates)` 호출
- 성공/에러 메시지 처리 및 자동 저장 트리거는 `updateAllData` 내부에 위임

2. 훅 반환값 확장 사용
- `usePortfolioData()` 구조분해에 `mapToNewAssetStructure`를 포함하도록 `App.tsx` 상단 구조분해 갱신 (`App.tsx:24–41`).

3. 중복 핸들러 정리
- `handleImportAssetsFromFile`를 `fullImportHandler`로 통합하거나 `fullImportHandler`만 사용하도록 유지 (현재 `Header`는 `fullImportHandler`에 연결되어 있으므로, 동작 보장 위해 `fullImportHandler`만 보완).

4. 예외 처리 강화
- `JSON.parse` 실패 → 사용자 메시지
- 예상 구조 없음/빈 배열 → 기본값으로 대체
- `exchangeRates` 유효성 보정: USD ≥ 100, JPY ≥ 1; 없으면 기본값 `{ USD:1450, JPY:9.5 }`

5. README 업데이트
- "가져오기/내보내기" 섹션에 동작 흐름과 데이터 매핑·마이그레이션 규칙, 로그인 요구사항을 명시.

## 구현 포인트
- 상태 반영: `updateAllData` 호출로 자산/히스토리/환율 일괄 반영 (`hooks/usePortfolioData.ts:163–179`).
- 매핑: `mapToNewAssetStructure`를 통해 이전 포맷 자산을 현재 스키마로 변환 (`hooks/usePortfolioData.ts:6–63`).
- 마이그레이션: `runMigrationIfNeeded`로 암호화폐 및 외화 자산 가격/통화 보정 (`utils/migrateData.ts`).

## 예상 변경 코드 (요지)
- `App.tsx:329–374` 내 `fullImportHandler`에서 파일 파싱 후 아래 순서 수행:
  - `const migrated = runMigrationIfNeeded(loadedData)`
  - `const rawAssets = Array.isArray(migrated.assets) ? migrated.assets : Array.isArray(migrated) ? migrated : []`
  - `const newAssets = rawAssets.map(mapToNewAssetStructure)`
  - `const newHistory = Array.isArray(migrated.portfolioHistory) ? migrated.portfolioHistory : []`
  - `const newSells = Array.isArray(migrated.sellHistory) ? migrated.sellHistory : []`
  - `const newWatchlist = Array.isArray(migrated.watchlist) ? migrated.watchlist : []`
  - `const rates = migrated.exchangeRates ?? { USD:1450, JPY:9.5 }` → 유효성 보정
  - `updateAllData(newAssets, newHistory, newSells, newWatchlist, rates)`
  - 성공 메시지 설정

## 검증 계획
- 로컬에서 샘플 JSON으로 테스트: (1) 전체 객체 구조, (2) 자산 배열만, (3) 잘못된 JSON
- 마이그레이션 로그 확인 (`utils/migrateData.ts`의 console.log 동작)
- 가져오기 이후 UI 반영: 대시보드/포트폴리오 탭에서 자산·환율·히스토리 내용 확인

## 리스크 및 완화
- 대형 JSON 파싱 시 UI 블록: FileReader는 비동기이므로 영향 제한적
- 예상 외 필드: 안전한 기본값 적용 및 빈 배열 처리
- 훅 반환에 `mapToNewAssetStructure` 포함으로 순환 참조 위험은 없음 (함수 레벨 반환)

이 계획대로 수정해도 될까요? 승인되면 구현을 진행하고 테스트까지 완료한 후 결과를 공유하겠습니다.