# 리팩토링 계획 및 규칙 정리

## 1. 변수명 통일 규칙 (Variable Naming Convention)

### 기존 문제점
- `previousClose`, `prev_close`, `yesterdayPrice`가 혼용되어 사용됨
- `price`, `currentPrice`, `priceKRW` 등 가격 관련 변수명이 일관되지 않음

### 통일된 규칙
| 의미 | 통일된 변수명 | 설명 |
|------|---------------|------|
| 이전 종가 | `previousClosePrice` | 전일 종가, 어제 가격을 모두 이 이름으로 통일 |
| 현재가 | `currentPrice` | 현재 시장 가격 |
| 원화 환산가 | `priceKRW` | 원화로 환산된 가격 |
| 원본 통화가격 | `priceOriginal` | API에서 받은 원본 통화 기준 가격 |

### 적용 범위
- `types/index.ts`: `Asset`, `WatchlistItem` 인터페이스
- `types/api.ts`: `AssetDataResult`, `PriceItem` 인터페이스
- `services/priceService.ts`: API 응답 처리 로직
- `hooks/useMarketData.ts`: 가격 업데이트 로직
- `components/portfolio-table/usePortfolioData.ts`: 수익률 계산 로직

### 마이그레이션
- `utils/migrateData.ts`: 기존 `yesterdayPrice` → `previousClosePrice` 자동 변환
- 하위 호환성 유지를 위해 기존 데이터 읽기 지원

## 2. 타입 정의 구조화 (Type Architecture)

### 디렉토리 구조
```
types/
├── index.ts      # 핵심 도메인 모델
├── api.ts        # API 응답 규격
├── ui.ts         # UI 컴포넌트용 타입
└── store.ts      # 상태 관리용 타입
```

### 각 파일별 주요 타입

#### types/index.ts
- `Asset`, `WatchlistItem`, `SellRecord`
- `AssetCategory`, `Currency` enum
- `ExchangeRates`, `PortfolioSnapshot`
- 헬퍼 함수: `normalizeExchange()`, `inferCategoryFromExchange()`

#### types/api.ts
- `AssetDataResult`: API 응답 가공 결과
- `PriceItem`: 원본 API 응답 아이템
- `PriceAPIResponse`: API 응답 유니온 타입

#### types/ui.ts
- `PortfolioTableProps`: 테이블 컴포넌트 props
- `SortKey`, `SortDirection`: 정렬 관련 타입
- `AssetMetrics`, `EnrichedAsset`: 계산된 메트릭

#### types/store.ts
- `PortfolioContextValue`: Context 전체 구조
- `PortfolioData`, `PortfolioStatus`: 데이터/상태 세분화
- `PortfolioActions`: 모든 액션 정의

### import 규칙
```typescript
// 도메인 모델
import { Asset, Currency } from '../types';

// UI 전용 타입
import { PortfolioTableProps } from '../types/ui';

// API 관련
import { AssetDataResult } from '../types/api';
```

## 3. 로직 분리 계획 (Logic Separation)

### 현재 분리된 Hook

#### usePortfolioStats.ts
**책임**: 자산 통계 계산
- 총 자산가치, 투자원금, 손익 계산
- 카테고리별 필터링 통계
- 매도 통계 (soldAssetsStats)
- 알림 카운트 계산

**사용처**: DashboardView, PortfolioContext

#### usePortfolioHistory.ts
**책임**: 포트폴리오 히스토리 관리
- 일일 스냅샷 생성
- 환율 적용 로직
- 365일 제한 관리

**사용처**: PortfolioContext

#### usePortfolioExport.ts
**책임**: 파일 입출력
- JSON 내보내기/가져오기
- CSV 내보내기
- Google Drive 저장

**사용처**: PortfolioContext

### 향후 분리 계획

#### usePortfolioCalculations.ts (신규)
**책임**: 복잡한 계산 로직
- 수익률 계산 (일간, 총 수익률)
- 최고가 대비 하락률
- 배분 비율 계산
- 환율 변환 로직

**대상 파일**:
- `components/portfolio-table/usePortfolioData.ts`의 계산 로직
- `utils/portfolioCalculations.ts` 통합

#### useAssetValidation.ts (신규)
**책임**: 자산 데이터 검증
- 티커 형식 검증
- 가격 데이터 유효성 검사
- 날짜 형식 검증

**대상 파일**:
- `components/AddAssetForm.tsx`의 validation
- `components/EditAssetModal.tsx`의 validation

#### useMarketDataSync.ts (신규)
**책임**: 시세 데이터 동기화
- API 호출 빈도 관리
- 실패 재시도 로직
- 캐시 관리

**대상 파일**:
- `hooks/useMarketData.ts`의 일부 로직
- `services/priceService.ts`의 호출 로직

#### usePortfolioFilters.ts (신규)
**책임**: 필터링 및 검색 로직
- 카테고리 필터
- 알림 필터
- 검색 기능
- 정렬 로직

**대상 파일**:
- `components/PortfolioTable.tsx`의 필터 로직
- `components/WatchlistPage.tsx`의 필터 로직

## 4. 컴포넌트 구조화 계획

### 현재 구조
```
components/
├── layouts/          # 페이지 레이아웃
├── common/          # 공통 컴포넌트
├── portfolio-table/ # 포트폴리오 테이블 관련
└── *.tsx           # 개별 컴포넌트
```

### 향후 구조 (제안)
```
components/
├── layouts/          # 페이지 레이아웃
├── common/          # 공통 컴포넌트
├── portfolio/       # 포트폴리오 전용
│   ├── table/       # 테이블 관련
│   ├── charts/      # 차트 관련
│   └── forms/       # 입력 폼
├── watchlist/       # 관심종목 전용
├── analytics/       # 분석 도구
└── settings/        # 설정 관련
```

## 5. 서비스 레이어 정리

### 현재 서비스
- `priceService.ts`: 시세 API 통신
- `geminiService.ts`: AI 분석
- `googleDriveService.ts`: 구글 드라이브
- `upbitService.ts`: 업비트 API

### 개선 방향
- 각 서비스별 에러 처리 통일
- 응답 데이터 표준화
- 재시도 로직 중앙화
- 캐싱 전략 수립

## 6. 리팩토링 우선순위

### 1단계 (높음)
- [ ] `usePortfolioCalculations.ts` 생성
- [ ] `components/portfolio-table/` 구조화
- [ ] 에러 처리 통일

### 2단계 (중간)
- [ ] `useAssetValidation.ts` 생성
- [ ] 폼 컴포넌트 구조화
- [ ] 서비스 레이어 개선

### 3단계 (낮음)
- [ ] `useMarketDataSync.ts` 생성
- [ ] `usePortfolioFilters.ts` 생성
- [ ] 전체 구조 최적화

## 7. 코딩 규칙

### 네이밍
- 컴포넌트: PascalCase (`DashboardView`)
- 훅: camelCase with 'use' prefix (`usePortfolioStats`)
- 함수: camelCase (`calculateReturn`)
- 상수: UPPER_SNAKE_CASE (`CURRENCY_SYMBOLS`)
- 파일: camelCase for hooks, PascalCase for components

### 타입 정의
- 인터페이스는 `I` prefix 없이 사용 (`Asset`, not `IAsset`)
- 유니온 타입은 명확한 이름 사용 (`PriceAPIResponse`)
- 제네릭은 단일 문자보다 의미 있는 이름 권장

### import 순서
1. React 관련
2. 외부 라이브러리
3. 내부 types
4. 내부 hooks
5. 내부 components
6. 내부 utils/services
7. 상대 경로는 사용 지양 (절대 경로 사용)

### 주석 규칙
- JSDoc 형식 사용 for 함수/인터페이스
- 복잡한 로직에는 한글 주석
- TODO/FIXME는 명확한 설명과 함께