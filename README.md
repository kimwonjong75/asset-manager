# KIM'S 퀸트자산관리 - 포트폴리오 관리 시스템

## 📋 프로젝트 개요

KIM'S 퀸트자산관리는 계량적 투자 전략을 기반으로 한 종합 자산 관리 시스템입니다. Google Drive 연동을 통해 데이터를 안전하게 저장하고, 실시간 시세 정보를 제공하며, 다양한 자산 종류를 지원하는 포트폴리오 관리 도구입니다.

### 핵심 기능
- **멀티 자산 지원**: 한국주식, 미국주식, 해외주식, 채권, 암호화폐, 실물자산, 현금
- **실시간 시세 업데이트**: 외부 API를 통한 실시간 가격 정보
- **환율 자동 반영**: USD, JPY 등 주요 통화 환율 자동 적용
- **Google Drive 동기화**: 안전한 클라우드 저장소 연동 (LZ-String 압축 적용)
- **앱 시작 시 자동 시세 업데이트**: 오늘 업데이트 안 했으면 자동 갱신
- **히스토리 백필**: 앱을 안 열었던 날의 **실제 과거 시세**를 API로 조회하여 채움 (실패 시 보간으로 폴백)
- **포트폴리오 분석**: 자산 배분, 수익률, 손익 추이 분석
- **리밸런싱 목표 관리**: 자산군별 목표 비중 및 목표 총 자산 금액 설정/저장, 리밸런싱 가이드 제공
- **추가매수 기록**: 보유 종목의 추가매수 시 가중평균 단가 자동 계산 및 메모 이력 기재
- **매도 알림**: 설정한 하락률 기준 알림 기능
- **관심종목 관리**: 별도의 워치리스트 기능
- **CSV 대량 등록**: 대량의 자산 일괄 등록
- **기술적 지표 연동**: MA20/MA60 및 RSI 상태(NORMAL/OVERBOUGHT/OVERSOLD) 수신 및 표시
- **차트 MA 오버레이**: 자산 차트에 사용자 커스텀 이동평균선(MA5/10/20/60/120/200) 오버레이, 토글로 활성/비활성 선택, 설정 localStorage 저장
- **서버 신호 표시**: 서버 제공 매수/매도 신호(STRONG_BUY/BUY/SELL/STRONG_SELL/NEUTRAL) 배지 표시
- **전일종가 기반 변동률 개선**: 백엔드 prev_close 기반으로 일중 변동률(yesterdayChange) 정확 계산

## 🏗️ 시스템 아키텍처

### 기술 스택
- **프론트엔드**: React 19.2.0, TypeScript
- **스타일링**: Tailwind CSS
- **빌드 도구**: Vite
- **차트 라이브러리**: Recharts
- **아이콘**: Lucide React
- **배포**: GitHub Pages
- **백엔드**: Google Cloud Run (Python)

### 프로젝트 구조

```
자산-관리-시트/
├── components/                 # React 컴포넌트
│   ├── common/               # 공통 컴포넌트
│   │   ├── Toggle.tsx       # 토글 스위치 컴포넌트
│   │   └── Tooltip.tsx      # 툴팁 컴포넌트 (계산 방법 설명, 메모 표시)
│   ├── AddAssetForm.tsx     # 자산 추가 폼
│   ├── AddNewAssetModal.tsx # 새 자산 추가 모달
│   ├── AllocationChart.tsx  # 자산 배분 차트
│   ├── AssetTrendChart.tsx  # 자산 추이 차트
│   ├── BulkUploadModal.tsx  # CSV 대량 업로드 모달
│   ├── CategorySummaryTable.tsx # 카테고리 요약 테이블
│   ├── DataConflictModal.tsx # 데이터 충돌 모달
│   ├── EditAssetModal.tsx   # 자산 수정 모달
│   ├── ExchangeRateInput.tsx # 환율 입력 컴포넌트
│   ├── Header.tsx           # 헤더 컴포넌트
│   ├── layouts/             # 레이아웃 컴포넌트 (탭별 화면)
│   │   ├── DashboardView.tsx    # 대시보드 탭 (조합형)
│   │   ├── PortfolioView.tsx    # 포트폴리오 탭
│   │   ├── AnalyticsView.tsx    # 통계 탭
│   │   └── WatchlistView.tsx    # 관심종목 탭
│   ├── dashboard/           # 대시보드 전용 컴포넌트 (신규)
│   │   ├── DashboardControls.tsx # 상단 컨트롤
│   │   ├── DashboardStats.tsx    # 핵심 지표
│   │   ├── AllocationChart.tsx   # 배분 차트
│   │   ├── ProfitLossChart.tsx   # 손익 차트
│   │   └── ...
│   ├── PortfolioAssistant.tsx # 포트폴리오 AI 어시스턴트
│   ├── PortfolioModal.tsx   # 포트폴리오 모달
│   ├── PortfolioTable.tsx   # 포트폴리오 테이블 (메인 Wrapper)
│   ├── portfolio-table/     # 포트폴리오 테이블 내부 컴포넌트
│   │   ├── PortfolioTableRow.tsx # 테이블 행 컴포넌트
│   │   ├── usePortfolioData.ts   # 데이터 로직 훅
│   │   ├── types.ts              # 타입 정의
│   │   └── utils.ts              # 유틸리티 함수
│   ├── RegionAllocationChart.tsx # 지역 배분 차트
│   ├── SellAlertControl.tsx # 매도 알림 설정
│   ├── SellAnalyticsPage.tsx # 매도 분석 페이지
│   ├── BuyMoreAssetModal.tsx # 추가매수 모달
│   ├── SellAssetModal.tsx   # 자산 매도 모달
│   ├── StatCard.tsx         # 통계 카드
│   ├── TopBottomAssets.tsx  # 상위/하위 자산
│   └── WatchlistPage.tsx    # 관심종목 페이지
├── hooks/                    # 커스텀 훅
│   ├── usePortfolioData.ts   # 핵심 데이터 및 동기화 관리
│   ├── useMarketData.ts      # 시세 및 환율 관리 (암호화폐 분기 처리 포함)
│   ├── useAssetActions.ts    # 자산 CRUD 및 액션 관리
│   ├── useRebalancing.ts     # 리밸런싱 계산 및 저장 로직 (신규)
│   ├── useTopBottomAssets.ts # 수익률 상/하위 계산 로직 (신규)
│   ├── useHistoricalPriceData.ts # MA 차트용 과거 시세 fetch 훅 (캐시 내장)
│   ├── usePortfolioCalculator.ts # 수익률/손익 계산 (구매 환율 기준)
│   ├── usePortfolioHistory.ts # 포트폴리오 스냅샷 히스토리 관리
│   ├── useGoogleDriveSync.ts # Google Drive API 래퍼
│   └── useOnClickOutside.ts  # 외부 클릭 감지 훅
├── services/                 # 외부 서비스 연동
│   ├── geminiService.ts   # Gemini AI 서비스
│   ├── googleDriveService.ts # Google Drive API
│   ├── historicalPriceService.ts # 과거 시세 백필 서비스 (신규)
│   ├── priceService.ts    # 시세 정보 서비스 (주식/ETF)
│   └── upbitService.ts    # 업비트 API 서비스 (Cloud Run 프록시 경유)
├── utils/                    # 유틸리티 함수
│   ├── migrateData.ts     # 데이터 마이그레이션
│   ├── maCalculations.ts  # 이동평균선(SMA) 계산 및 차트 데이터 빌드 유틸
│   ├── signalUtils.ts     # 서버 신호/RSI 뱃지 렌더링 유틸
│   ├── historyUtils.ts    # 히스토리 보간/분리 유틸 (신규)
│   └── portfolioCalculations.ts # 포트폴리오 계산 유틸
├── types/                  # TypeScript 타입 정의
│   ├── index.ts           # 주요 타입 정의 (자산, 화폐, 거래소 등)
│   ├── api.ts             # API 관련 타입 정의
│   ├── store.ts           # 상태 관리 관련 타입 정의
│   └── ui.ts              # UI 컴포넌트 관련 타입 정의
├── constants/              # 상수 정의
│   └── columnDescriptions.ts # 포트폴리오 테이블 컬럼별 계산 방법 설명
├── App.tsx                 # 메인 애플리케이션
├── index.tsx              # 애플리케이션 진입점
└── initialData.ts         # 초기 데이터
```

## 📊 데이터 흐름 및 의존성

### 핵심 데이터 구조

#### 1. 자산 (Asset) 데이터
```typescript
interface Asset {
  id: string;                    // 고유 식별자
  category: AssetCategory;       // 자산 카테고리
  ticker: string;                // 티커 심볼
  exchange: string;              // 거래소
  name: string;                  // 자산명
  customName?: string;           // 사용자 지정명
  quantity: number;               // 보유 수량
  purchasePrice: number;        // 매수 단가
  purchaseDate: string;         // 매수일
  currency: Currency;           // 통화
  purchaseExchangeRate?: number; // 매수 시 환율
  currentPrice: number;        // 현재가
  priceOriginal: number;       // 원화 이외 통화의 원가
  highestPrice: number;        // 최고가
  previousClosePrice?: number; // 전일 종가 (구 yesterdayPrice)
  sellAlertDropRate?: number;  // 매도 알림 하락률
  memo?: string;               // 메모
  sellTransactions?: SellTransaction[]; // 매도 이력
}
```

#### 2. 포트폴리오 스냅샷
```typescript
interface PortfolioSnapshot {
  date: string;                 // 날짜
  assets: AssetSnapshot[];     // 자산 스냅샷
}

interface AssetSnapshot {
  id: string;                  // 자산 ID
  name: string;               // 자산명
  currentValue: number;       // 현재가치
  purchaseValue: number;      // 매수가치
  unitPrice?: number;        // 1주당 단가
}
```

### 데이터 흐름도

```
사용자 입력 → 컴포넌트 → 상태 관리 → Google Drive 저장
     ↓
┌─────────────────────────────────────────────────────────────┐
│                    시세 업데이트 흐름                         │
├─────────────────────────────────────────────────────────────┤
│  useMarketData.ts                                           │
│       │                                                     │
│       ├─── 자산 분류 (shouldUseUpbitAPI 함수)                │
│       │         │                                           │
│       │         ├─── Upbit/Bithumb 거래소                   │
│       │         │    또는 한글 거래소명 + 암호화폐 카테고리    │
│       │         │         ↓                                 │
│       │         │    upbitService.ts → Cloud Run /upbit     │
│       │         │         ↓                                 │
│       │         │    업비트 API (KRW 가격)                   │
│       │         │                                           │
│       │         └─── 그 외 (주식, ETF, 해외주식 등)          │
│       │                   ↓                                 │
│       │              priceService.ts → Cloud Run /          │
│       │                   ↓                                 │
│       │              FinanceDataReader                      │
│       │                                                     │
│       └─── 결과 병합 → UI 반영                              │
└─────────────────────────────────────────────────────────────┘
     ↓
포트폴리오 분석 → 차트/통계 → 시각화
```

### 주요 의존성

#### 1. 외부 API 의존성
- **Cloud Run 서버**: `https://asset-manager-887842923289.asia-northeast3.run.app`
  - **`/` (POST)**: 한국주식, 미국주식, 해외주식, ETF 시세 (FinanceDataReader)
  - **`/upbit` (POST)**: 암호화폐 시세 (업비트 API 프록시) ← **신규 추가**
  - 환율 정보 (USD/KRW, JPY/KRW)
  - 기술적 지표 및 신호: 응답 내 `indicators` 필드로 제공

#### 2. 시세 조회 분기 로직 (신규)
```typescript
// hooks/useMarketData.ts
const shouldUseUpbitAPI = (exchange: string, category?: AssetCategory): boolean => {
  // 1. exchange가 'Upbit' 또는 'Bithumb'인 경우 → 업비트 API
  // 2. exchange에 한글이 포함되어 있고 category가 암호화폐인 경우 → 업비트 API
  // 3. 그 외 → Cloud Run 기본 엔드포인트 (FinanceDataReader)
};
```

#### 3. Google Drive API
- **인증**: OAuth 2.0
- **스코프**:
  - `https://www.googleapis.com/auth/drive` (공유 폴더 접근을 위해 전체 Drive 권한 사용)
  - `https://www.googleapis.com/auth/userinfo.email`
  - `https://www.googleapis.com/auth/userinfo.profile`
  - `openid`
- **공유 폴더 지원**: `supportsAllDrives`, `includeItemsFromAllDrives` 파라미터를 통해 다른 계정과 공유된 폴더의 데이터 접근 가능

#### 4. 내부 모듈 의존성
```
App.tsx
├── hooks/
│   ├── useMarketData.ts ─────┬─── priceService.ts (주식/ETF 실시간)
│   │                         └─── upbitService.ts (암호화폐 실시간)
│   ├── usePortfolioData.ts ──┬─── historyUtils.ts (백필 로직)
│   │                         └─── historicalPriceService.ts (과거 시세 API)
│   └── useHistoricalPriceData.ts ─┬─── historicalPriceService.ts (과거 시세 API)
│                                  └─── maCalculations.ts (SMA 계산)
├── services/
│   ├── priceService.ts      (시세 정보 - Cloud Run / + 환율 - Cloud Run /exchange-rate)
│   ├── upbitService.ts      (암호화폐 - Cloud Run /upbit)
│   ├── historicalPriceService.ts (과거 시세 - Cloud Run /history, /upbit/history)
│   ├── googleDriveService.ts (클라우드 저장)
│   └── geminiService.ts    (AI 분석, 종목 검색)
├── components/
│   └── AssetTrendChart.tsx ──┬─── useHistoricalPriceData.ts (과거 시세 fetch)
│                             └─── maCalculations.ts (차트 데이터 빌드)
└── utils/
    └── maCalculations.ts     (SMA 계산, 차트 데이터 빌드, 순수 함수)
```

## 🎯 주요 컴포넌트 상세

### 1. App.tsx (메인 컴포넌트)
**역할**: 애플리케이션 진입점 및 레이아웃 구성
**책임**:
- 주요 Hooks(`usePortfolioData`, `useMarketData`, `useAssetActions`) 초기화 및 연결
- 탭 네비게이션 상태 관리 및 라우팅
- 전역 모달(설정, 파일 업로드 등) 관리
- 로그인 상태에 따른 화면 분기 처리

### 2. 핵심 Hooks (상태 및 로직 분리)
- **usePortfolioData**: 자산, 히스토리, 환율 등 핵심 데이터 상태 관리 및 Google Drive 동기화 담당
- **useMarketData**: 외부 API를 통한 시세 업데이트, 환율 갱신 로직 담당
  - **암호화폐 분기 처리**: `shouldUseUpbitAPI()` 함수를 통해 업비트 자산과 일반 자산 분리
  - **병렬 조회**: 업비트 API와 일반 시세 API를 동시에 호출하여 성능 최적화
- **useAssetActions**: 자산 추가/수정/삭제, 매도, 추가매수, CSV 업로드 등 사용자 인터랙션 처리
- **usePortfolioCalculator**: 수익률 및 손익 계산 담당 ← **수정됨**
  - **구매 환율 우선 적용**: 매수가 계산 시 `purchaseExchangeRate`(구매 당시 환율)를 우선 사용
  - **폴백 로직**: 구매 환율이 없는 기존 자산은 현재 환율로 계산 (하위 호환성)
  - **일관된 수익률**: 대시보드와 손익 차트의 수익률이 동일하게 표시됨
- **usePortfolioHistory**: 매일 포트폴리오 스냅샷 저장 (KRW 변환 후 저장)

### 3. priceService.ts (주식/ETF/환율 서비스)
**역할**: Cloud Run 서버를 통한 시세 및 환율 정보 관리
**책임**:
- 배치 단위 시세 조회 (20개씩 청크 처리)
- 환율 정보 조회 (현재 및 과거 날짜) ← **Gemini에서 이전됨**
- 재시도 로직 (1회)
- 에러 처리 및 모킹 데이터 제공
**대상 자산**:
- 한국주식 (KRX, KONEX)
- 미국주식 (NASDAQ, NYSE, AMEX)
- 해외주식 (TSE 등)
- ETF, 채권, 실물자산
- 환율 (USD/KRW, JPY/KRW, EUR/KRW, CNY/KRW)

### 4. upbitService.ts (암호화폐 시세 서비스) ← **신규/수정**
**역할**: Cloud Run 프록시를 통한 업비트 암호화폐 시세 조회
**책임**:
- Cloud Run `/upbit` 엔드포인트 호출 (CORS 우회)
- 심볼 → 마켓 코드 변환 (BTC → KRW-BTC)
- 유효하지 않은 심볼 필터링
- 결과 매핑 (마켓 코드 및 심볼 양방향)
**대상 자산**:
- exchange가 'Upbit' 또는 'Bithumb'인 자산
- exchange에 한글이 포함되고 category가 암호화폐인 자산

### 5. googleDriveService.ts (Google Drive 서비스)
**역할**: 클라우드 저장소 관리
**책임**:
- OAuth 2.0 인증
- 토큰 자동 갱신 (만료 5분 전)
- 파일 저장/불러오기
- 사용자 정보 관리

### 6. PortfolioTable.tsx (포트폴리오 테이블)
**역할**: 자산 목록 표시 및 관리 (Wrapper 컴포넌트)
**구조**:
- `components/portfolio-table/` 디렉토리로 로직 분리
- `usePortfolioData`: 데이터 가공, 정렬, 필터링 로직 담당
- `constants/columnDescriptions.ts`: 컬럼별 계산 방법 설명 상수
**주요 기능**:
- **컬럼 툴팁**: 헤더 및 데이터 셀에 마우스 오버 시 해당 항목의 계산 방법을 툴팁으로 표시
- **메모 툴팁**: 종목명에 마우스 오버 시 메모 내용 표시 (줄바꿈 지원)
- **수익률 계산 로직 (Upbit/Bithumb 예외 처리)**: Upbit/Bithumb 자산의 경우, 설정된 통화(`currency`)와 무관하게 API가 반환하는 원화(`KRW`) 가격을 기준으로 수익률을 계산
- **변동액 표시**: 전일 대비 변동액(`diffFromYesterday`) KRW 기준으로 계산 및 표시

### 7. RebalancingTable.tsx (포트폴리오 리밸런싱)
**역할**: 목표 자산 비중 설정 및 리밸런싱 가이드 제공
**기능**:
- **목표 비중 및 금액 설정**: 자산군별 목표 비중(%)뿐만 아니라 목표 총 자산 금액도 설정 및 영구 저장 가능
- **리밸런싱 가이드**: 현재 평가액과 목표 금액의 차이를 계산하여 매수/매도 필요 금액 제시
- **상태 관리**: 목표 총 자산 금액 및 비중 설정을 실시간으로 반영하여 시뮬레이션 가능

### 8. DashboardView.tsx (대시보드)
**역할**: 전체 자산 현황 요약 및 환율/필터 제어
**주요 변경사항**:
- **UI 레이아웃 개선**: 자산 필터, 환율 입력, 매도 알림을 상단 한 줄에 배치하여 공간 효율성 최적화
- **ExchangeRateInput 연동**: 외부 스타일 주입(`className`)을 통해 유연한 배치 적용
- **반응형 디자인**: 화면 크기에 따른 자동 줄바꿈(`flex-wrap`) 지원

## ⚙️ 핵심 로직 및 알고리즘

### 1. 시세 업데이트 로직 (수정됨)
```typescript
// hooks/useMarketData.ts

// 1. 자산 분류
const cashAssets = assets.filter(a => a.category === AssetCategory.CASH);
const upbitAssets = assets.filter(a => 
  a.category !== AssetCategory.CASH && shouldUseUpbitAPI(a.exchange, a.category)
);
const generalAssets = assets.filter(a => 
  a.category !== AssetCategory.CASH && !shouldUseUpbitAPI(a.exchange, a.category)
);

// 2. 병렬 조회
const [cashResults, batchPriceMap, upbitPriceMap] = await Promise.all([
  Promise.allSettled(cashPromises),
  fetchBatchAssetPricesNew(assetsToFetch),  // Cloud Run / (주식/ETF)
  fetchUpbitPricesBatch(upbitSymbols)        // Cloud Run /upbit (암호화폐)
]);

// 3. 결과 병합 및 UI 반영
```

### 2. 암호화폐 분기 판단 로직 (신규)
```typescript
// hooks/useMarketData.ts
const shouldUseUpbitAPI = (exchange: string, category?: AssetCategory): boolean => {
  const normalized = (exchange || '').toLowerCase();
  
  // 명확하게 Upbit/Bithumb인 경우
  if (normalized === 'upbit' || normalized === 'bithumb') {
    return true;
  }
  
  // 한글이 포함된 거래소명이고 암호화폐인 경우 (예: '주요 거래소 (종합)')
  const hasKorean = /[ㄱ-ㅎ|ㅏ-ㅣ|가-힣]/.test(exchange);
  if (hasKorean && category === AssetCategory.CRYPTOCURRENCY) {
    return true;
  }
  
  return false;
};
```

### 3. 환율 적용 로직 (수정됨)
```typescript
// hooks/usePortfolioCalculator.ts

// [신규] 매수가를 KRW로 변환 - 구매 당시 환율 우선 사용
const getPurchaseValueInKRW = (asset: Asset, exchangeRates: ExchangeRates): number => {
  // KRW 자산은 그대로 반환
  if (asset.currency === Currency.KRW) {
    return asset.purchasePrice;
  }
  
  // 구매 당시 환율이 있으면 사용 (우선)
  if (asset.purchaseExchangeRate && asset.purchaseExchangeRate > 0) {
    return asset.purchasePrice * asset.purchaseExchangeRate;
  }
  
  // 구매 환율이 없으면 현재 환율로 폴백 (기존 자산 호환성)
  return getValueInKRW(asset.purchasePrice, asset.currency, exchangeRates);
};

// 현재가: 대시보드 실시간 환율 적용
// 매수가: 구매 당시 환율(purchaseExchangeRate) 우선 적용
// 기본값: USD 1450, JPY 9.5
```

### 4. 자산 카테고리 추론
```typescript
// 거래소 정보를 통한 카테고리 자동 판단
KRX/KONEX → 한국주식
NASDAQ/NYSE → 미국주식
TSE → 해외주식
Upbit/Bithumb → 암호화폐
금 관련 거래소 → 실물자산
```

### 5. 데이터 마이그레이션
```typescript
// 이전 버전 데이터 구조 변환
// region 필드 제거
// category 매핑 (한국어 → enum)
// exchange 기본값 설정
```

## 📈 기술적 지표 및 신호 표시

### 서버 제공 지표 (단일값)
- 응답 포맷
  - `indicators.ma20`: 20일 이동평균
  - `indicators.ma60`: 60일 이동평균
  - `indicators.rsi`: RSI 값
  - `indicators.rsi_status`: NORMAL/OVERBOUGHT/OVERSOLD
  - `indicators.signal`: STRONG_BUY/BUY/SELL/STRONG_SELL/NEUTRAL
- 데이터 전달 경로
  - Cloud Run → services/priceService.ts → hooks/useMarketData.ts
- UI 표시
  - 워치리스트 "신호" 칼럼에서 서버 신호/RSI를 배지로 표시
  - 표시 로직: utils/signalUtils.ts
  - 컴포넌트: components/WatchlistPage.tsx

### 차트 MA 오버레이 (프론트엔드 계산)
- **데이터 소스**: `/history` 또는 `/upbit/history` 엔드포인트의 과거 종가
- **계산**: `utils/maCalculations.ts`에서 SMA(단순이동평균)를 순수 함수로 계산
- **지원 기간**: MA5, MA10, MA20, MA60, MA120, MA200 (사용자 토글 선택)
- **기본 활성**: MA20 (#EF4444), MA60 (#3B82F6)
- **데이터 흐름**:
  - `hooks/useHistoricalPriceData.ts` → `historicalPriceService.ts`로 과거 시세 fetch (모듈 레벨 캐시, TTL 10분)
  - `utils/maCalculations.ts`의 `buildChartDataWithMA()` → Recharts용 데이터 배열 빌드
  - `components/AssetTrendChart.tsx`에서 활성 MA별 `<Line>` 컴포넌트 동적 렌더링
- **설정 저장**: localStorage (`asset-manager-ma-preferences`)
- **폴백**: MA 비활성 시 기존 PortfolioSnapshot 기반 차트 로직 유지, 과거 시세 API 실패 시에도 기존 차트 정상 동작

## 🖥️ Cloud Run 서버 (백엔드)

### 엔드포인트
| 경로 | 메서드 | 설명 | 요청 형식 |
|------|--------|------|-----------|
| `/` | POST | 주식/ETF 시세 조회 | `{ "tickers": [{"ticker": "005930", "exchange": "KRX"}] }` |
| `/upbit` | POST | 암호화폐 시세 조회 | `{ "symbols": ["BTC", "ETH"] }` |
| `/history` | POST | 주식/ETF 과거 시세 (백필용) | `{ "tickers": ["005930", "AAPL"], "start_date": "2024-01-01", "end_date": "2024-01-31" }` |
| `/upbit/history` | POST | 암호화폐 과거 시세 (백필용) | `{ "symbols": ["BTC", "ETH"], "start_date": "2024-01-01", "end_date": "2024-01-31" }` |
| `/exchange-rate` | POST | 환율 조회 (현재/과거) | `{ "from": "USD", "to": "KRW", "date": "2024-01-15" }` |

### 주요 파일
```
cloud-run/
├── main.py           # Cloud Run 엔트리포인트
└── requirements.txt  # Python 의존성
```

### main.py 핵심 기능
```python
# 주식/ETF 시세 조회 (FinanceDataReader)
def fetch_single_ticker(ticker):
    df = fdr.DataReader(ticker, start=start_date, end=end_date)
    ...

# 주식/ETF 과거 시세 조회 - 백필용 (신규)
def fetch_historical_prices(ticker, start_date, end_date):
    df = fdr.DataReader(ticker, start=start_date, end=end_date)
    return {"data": {date: close_price, ...}, "ticker": ticker}

# 업비트 프록시
def fetch_upbit_prices(markets):
    url = f"https://api.upbit.com/v1/ticker?markets={markets_param}"
    response = requests.get(url)
    ...

# 업비트 일봉 조회 - 백필용 (신규)
def fetch_upbit_candles(market, start_date, end_date):
    url = "https://api.upbit.com/v1/candles/days"
    return {"data": {date: close_price, ...}, "market": market}

# 환율 조회 (FinanceDataReader)
def fetch_exchange_rate(from_currency, to_currency, target_date=None):
    symbol = f"{from_currency}/{to_currency}"  # 예: USD/KRW
    df = fdr.DataReader(symbol, start=start_date, end=end_date)
    ...

@functions_framework.http
def get_stock_prices(request):
    if path == '/history':
        # 주식/ETF 과거 시세 조회 (백필용)
    elif path == '/upbit/history':
        # 암호화폐 과거 시세 조회 (백필용)
    elif path == '/upbit':
        # 업비트 프록시 처리
    elif path == '/exchange-rate':
        # 환율 조회 처리
    else:
        # 주식 조회 처리
```

### 배포 명령
```bash
gcloud run deploy asset-manager \
  --source . \
  --region asia-northeast3 \
  --allow-unauthenticated
```

## 🔧 설정 및 환경 변수

### 필수 환경 변수
```env
VITE_GOOGLE_CLIENT_ID=your_google_client_id
```

### Google Cloud Console 설정
1. OAuth 2.0 클라이언트 ID 생성
2. 승인된 리디렉션 URI 설정
3. 필요한 API 활성화:
   - Google Drive API
   - Google OAuth2.0

### 빌드 설정
```typescript
// vite.config.ts
base: '/asset-manager/'  // GitHub Pages 경로
```

## 🚀 배포 및 빌드

### 개발 서버 실행
```bash
npm run dev
```

### 프로덕션 빌드
```bash
npm run build
```

### GitHub Pages 배포
```bash
npm run deploy
```

### Cloud Run 배포
```bash
cd cloud-run
gcloud run deploy asset-manager --source . --region asia-northeast3 --allow-unauthenticated
```

## 📋 주의사항 및 오류 방지 가이드

### 1. 시세 API 관련
- **청크 크기 제한**: 20개씩 요청 (API 제한 사항)
- **암호화폐 분기 처리**: `exchange` 기준으로 업비트 API와 일반 API 분기
  - Upbit/Bithumb 거래소 → Cloud Run `/upbit` 엔드포인트
  - 한글 거래소명 + 암호화폐 카테고리 → Cloud Run `/upbit` 엔드포인트
  - 그 외 → Cloud Run `/` 엔드포인트 (FinanceDataReader)
- **Upbit/Bithumb 예외 처리**: 업비트 API는 항상 KRW 가격을 반환하므로, `currency` 설정과 무관하게 강제로 KRW로 처리
- **CORS 우회**: 클라이언트에서 업비트 직접 호출 불가 → Cloud Run 프록시 필수
- **재시도**: 실패 시 1회 재시도, 1초 대기
- **모킹 데이터**: API 실패 시 기본값 제공 (isMocked: true)
- **지표/신호 처리**: 지표/신호 계산은 백엔드에서 수행하며, 프론트는 전달/표시에만 집중한다.
- **전일종가 기준**: Cloud Run의 `prev_close`/`previousClose`를 그대로 사용해 변동률을 계산한다.

### 2. 환율 처리 (수정됨)
- **기본값 설정**: USD 1450, JPY 9.5
- **유효성 검사**: USD > 100, JPY > 1
- **현재가 환율**: 대시보드의 실시간 환율 적용
- **매수가 환율**: 구매 당시 환율(`purchaseExchangeRate`) 우선 적용
  - 자산 추가 시 해당 날짜의 환율이 자동 저장됨
  - 구매 환율이 없는 기존 자산은 현재 환율로 폴백
- **수익률 일관성**: 대시보드와 손익 차트가 동일한 기준으로 계산

### 3. Google Drive 동기화
- **자동 저장**: 2초 디바운스 적용
- **토큰 갱신**: 만료 5분 전 자동 갱신
- **오류 처리**: 네트워크 오류 시 재시도 로직
- **LZ-String 압축**: 저장 시 UTF16 압축 적용 (파일 크기 70-80% 감소)
- **레거시 호환**: 압축되지 않은 기존 파일도 정상 로드
- **앱 시작 시 자동 업데이트**: 오늘 업데이트 안 했으면 자동으로 시세 갱신
- **히스토리 백필**: 앱을 안 열었던 날의 **실제 과거 시세**를 API로 조회하여 채움
  - 주식/ETF: Cloud Run `/history` (FinanceDataReader)
  - 암호화폐: Cloud Run `/upbit/history` (Upbit Candles API)
  - 90일 초과 누락 시 또는 API 실패 시: 기존 보간 방식으로 폴백

### 4. 데이터 무결성
- **마이그레이션**: 이전 버전 데이터 자동 변환
- **구조 검증**: 필수 필드 존재 여부 확인
- **백업**: Google Drive에 자동 저장

### 5. 성능 최적화
- **useMemo 활용**: 무거운 계산 결과 캐싱
- **청크 처리**: 대량 데이터 분배 처리
- **병렬 조회**: 업비트 API와 일반 API 동시 호출
- **지연 로딩**: 컴포넌트 지연 로딩 적용

## 🔍 디버깅 및 모니터링

### 로그 레벨
- `console.log`: API 요청/응답 데이터
  - `[useMarketData] 자산 분류:` - 자산 분류 결과
  - `[useMarketData] 업비트 조회 심볼:` - 업비트 API로 조회할 심볼
  - `[useMarketData] Cloud Run 조회:` - 일반 API로 조회할 심볼
  - `[Upbit] BTC: 현재가=xxx, 전일종가=xxx` - 업비트 조회 결과
- `console.error`: 오류 상세 정보
- `console.warn`: 경고 메시지

### 에러 처리
- **사용자 친화적 메시지**: 기술적 오류를 이해하기 쉽게 변환
- **자동 복구**: 가능한 경우 자동 복구 시도
- **상태 복원**: 오류 발생 시 이전 상태로 복원
- **부분 성공**: 일부 자산 조회 실패 시 성공한 자산만 업데이트

### 모니터링 포인트
- API 응답 시간
- 환율 업데이트 성공률
- Google Drive 동기화 성공률
- 메모리 사용량
- 업비트 API 호출 성공률

## 📚 확장 가이드

### 새로운 자산 카테고리 추가
1. `AssetCategory` enum에 추가
2. `EXCHANGE_MAP`에 거래소 매핑
3. `inferCategoryFromExchange` 로직 업데이트
4. 관련 컴포넌트 UI 업데이트

### 새로운 거래소 추가
1. `COMMON_EXCHANGES` 또는 `ALL_EXCHANGES`에 추가
2. 카테고리 추론 로직 업데이트
3. 시세 API 지원 확인
4. **암호화폐 거래소인 경우**: `shouldUseUpbitAPI()` 함수에 조건 추가

### 통화 추가
1. `Currency` enum에 추가
2. `CURRENCY_SYMBOLS`에 심볼 추가
3. 환율 API 엔드포인트 확인
4. 환율 입력 UI 업데이트

### 새로운 암호화폐 거래소 추가 (신규)
1. `shouldUseUpbitAPI()` 함수에 거래소명 조건 추가
2. 해당 거래소 API가 업비트와 호환되는지 확인
3. 호환되지 않는 경우 별도 서비스 파일 생성 및 Cloud Run 엔드포인트 추가

## 🧩 개발 참고: 타입 가이드 및 any 금지

- 공용 타입은 모두 `types/` 디렉토리 내의 파일들에 정의하고 전 파일에서 일관되게 사용
- any 사용 금지: 응답/데이터는 명확한 인터페이스로 모델링
  - 시세 응답 아이템: [PriceItem](file:///c:/Users/beari/Desktop/Dev/asset-manager/types/api.ts)
  - 시세 응답 포맷: [PriceAPIResponse](file:///c:/Users/beari/Desktop/Dev/asset-manager/types/api.ts)
  - 구버전 데이터: [LegacyAssetShape](file:///c:/Users/beari/Desktop/Dev/asset-manager/types/index.ts)
  - 드라이브 메타데이터: [DriveFileMetadata](file:///c:/Users/beari/Desktop/Dev/asset-manager/types/index.ts)
- 통화 타입 일관화: `AssetDataResult.currency`는 반드시 [Currency](file:///c:/Users/beari/Desktop/Dev/asset-manager/types/index.ts)
- 프런트 서비스에서의 적용 예시
  - 일반 시세/환율 처리: [priceService.ts](file:///c:/Users/beari/Desktop/Dev/asset-manager/services/priceService.ts)
  - 업비트 시세 처리: [upbitService.ts](file:///c:/Users/beari/Desktop/Dev/asset-manager/services/upbitService.ts)
  - 데이터 마이그레이션: [migrateData.ts](file:///c:/Users/beari/Desktop/Dev/asset-manager/utils/migrateData.ts)
  - 신호/RSI 표시 유틸: [signalUtils.ts](file:///c:/Users/beari/Desktop/Dev/asset-manager/utils/signalUtils.ts)

## 🔗 데이터 소스 및 구현 확인

- 주식/ETF/해외주식
  - 소스: Google Cloud Run 기본 엔드포인트 `/` (Python) + FinanceDataReader
  - 클라이언트: [priceService.ts](file:///c:/Users/beari/Desktop/Dev/asset-manager/services/priceService.ts) 배치 조회/환율 조회 사용
  - 분기/병합: [useMarketData.ts](file:///c:/Users/beari/Desktop/Dev/asset-manager/hooks/useMarketData.ts#L126-L154) 일반 자산을 Cloud Run으로 조회 후 결과 병합
- 암호화폐
  - 소스: Cloud Run `/upbit` 프록시 → 업비트 API(KRW)
  - 클라이언트: [upbitService.ts](file:///c:/Users/beari/Desktop/Dev/asset-manager/services/upbitService.ts#L36-L66)
  - 분기 로직: [shouldUseUpbitAPI](file:///c:/Users/beari/Desktop/Dev/asset-manager/hooks/useMarketData.ts#L26-L41)로 Upbit/Bithumb 또는 한글 거래소+암호화폐 판별
  - 병합/반영: [useMarketData.ts](file:///c:/Users/beari/Desktop/Dev/asset-manager/hooks/useMarketData.ts#L135-L147), [useMarketData.ts](file:///c:/Users/beari/Desktop/Dev/asset-manager/hooks/useMarketData.ts#L175-L201)

---

## 📝 변경 이력

### 2026-02-05: AssetTrendChart에 사용자 커스텀 이동평균선(MA) 오버레이 추가
- **기능 추가 — 차트 MA 오버레이**:
  - 자산 차트에 MA5/10/20/60/120/200 이동평균선 오버레이
  - 사용자가 칩 토글로 MA 기간별 표시/숨김 선택 (기본: MA20, MA60 활성)
  - MA 활성 시: `/history` 과거 종가 기반 차트 + SMA 라인 오버레이
  - MA 비활성 시: 기존 PortfolioSnapshot 기반 차트 로직 유지 (폴백)
  - KRW 토글이 MA 데이터에도 동일 적용
  - 현금(CASH) 자산은 MA 토글 숨김
  - 과거 시세 모듈 레벨 캐시 (TTL 10분)
  - MA 토글 설정은 localStorage에 저장
- **새로운 파일**:
  - `utils/maCalculations.ts`: SMA 계산, 차트 데이터 빌드, MA 설정 상수 (순수 함수)
  - `hooks/useHistoricalPriceData.ts`: 과거 시세 fetch 훅 (주식/암호화폐 자동 분기, 캐시 내장)
- **수정된 파일**:
  - `components/AssetTrendChart.tsx`: MA 토글 UI, 과거 시세 기반 차트 데이터, 동적 MA 라인 렌더링 추가
  - `components/portfolio-table/PortfolioTableRow.tsx`: AssetTrendChart에 `ticker`, `exchange`, `category` props 전달
- **의존 관계 추가**:
  - `AssetTrendChart.tsx` → `useHistoricalPriceData`, `maCalculations`
  - `useHistoricalPriceData.ts` → `historicalPriceService.ts`, `maCalculations.ts`
  - `PortfolioTableRow.tsx` → `AssetTrendChart` (기존, props 3개 추가)

### 2026-02-02: 포트폴리오 테이블 툴팁 기능 추가
- **기능 추가 — 컬럼 계산 방법 툴팁**:
  - 테이블 헤더 및 데이터 셀에 마우스 오버 시 해당 항목의 계산 방법을 툴팁으로 표시
  - 예: 최고가 대비 → "(현재가 - 52주 최고가) / 52주 최고가 × 100"
- **기능 개선 — 메모 툴팁**:
  - 기존 브라우저 기본 `title` 속성을 커스텀 툴팁으로 교체 (빠른 반응 속도)
  - 긴 메모는 자동 줄바꿈, 입력 시 줄바꿈도 유지
- **새로운 파일**:
  - `components/common/Tooltip.tsx`: 공용 툴팁 컴포넌트 (CSS-only, `wrap` prop으로 줄바꿈 제어)
  - `constants/columnDescriptions.ts`: 컬럼별 계산 방법 설명 상수
- **수정된 파일**:
  - `components/PortfolioTable.tsx`: 헤더에 Tooltip 적용
  - `components/portfolio-table/PortfolioTableRow.tsx`: 데이터 셀 및 메모에 Tooltip 적용
- **의존 관계**:
  - `PortfolioTable.tsx` → `Tooltip`, `COLUMN_DESCRIPTIONS`
  - `PortfolioTableRow.tsx` → `Tooltip`, `COLUMN_DESCRIPTIONS`

### 2026-02-02: 히스토리 백필(Backfill) 기능 구현
- **기능 추가 — 실제 과거 시세로 히스토리 채우기**:
  - 앱을 안 열었던 날의 데이터를 **실제 과거 종가**로 채움 (기존: 마지막 스냅샷 복사)
  - 주식/ETF: Cloud Run `/history` 엔드포인트 (FinanceDataReader)
  - 암호화폐: Cloud Run `/upbit/history` 엔드포인트 (Upbit Candles API)
  - **데이터 소스 분리 원칙 준수**: 실시간 시세와 동일한 API 소스 사용 (일관성)
- **폴백 처리**:
  - API 실패 시 기존 `fillAllMissingDates()`로 자동 폴백
  - 90일 초과 누락 시 API 부하 방지를 위해 기존 보간 방식 사용
- **새로운 파일**:
  - `services/historicalPriceService.ts`: 백필 API 호출 서비스
- **수정된 파일**:
  - `main.py` (Cloud Run): `fetch_historical_prices()`, `fetch_upbit_candles()` 함수 및 `/history`, `/upbit/history` 엔드포인트 추가
  - `utils/historyUtils.ts`: `backfillWithRealPrices()`, `getMissingDateRange()` 함수 추가
  - `hooks/usePortfolioData.ts`: 로드 시 자동 백필 로직 추가
- **의존 관계 변경**:
  - `usePortfolioData.ts` → `historyUtils.ts`의 `backfillWithRealPrices`, `getMissingDateRange` 사용
  - `historyUtils.ts` → `historicalPriceService.ts`의 백필 API 함수들 사용

### 2026-02-02: 환율 조회를 Gemini API에서 Cloud Run으로 이전
- **기능 변경 — 환율 조회 API 이전**:
  - Gemini API 사용을 줄이기 위해 환율 조회를 Cloud Run (FinanceDataReader)으로 이전
  - 현재 환율 및 과거 날짜 환율 모두 지원
- **새로운 엔드포인트**: Cloud Run `/exchange-rate`
  - 요청: `{ "from": "USD", "to": "KRW", "date": "2024-01-15" }` (date는 선택)
  - 응답: `{ "rate": 1350.5, "date": "2024-01-15", "from": "USD", "to": "KRW" }`
- **영향받는 파일**:
  - `main.py` (Cloud Run): `fetch_exchange_rate()` 함수 및 `/exchange-rate` 엔드포인트 추가
  - `services/priceService.ts`: `fetchCurrentExchangeRate()`, `fetchHistoricalExchangeRate()` 함수 추가
  - `hooks/useMarketData.ts`: import 경로 변경 (geminiService → priceService)
  - `hooks/useAssetActions.ts`: import 경로 변경 (geminiService → priceService)
  - `services/geminiService.ts`: 환율 관련 함수 제거
- **의존 관계 변경**:
  - 환율 조회: `geminiService.ts` → `priceService.ts` (Cloud Run `/exchange-rate`)
  - Gemini API 사용처: 종목 검색(`searchSymbols`), 포트폴리오 AI 분석(`askPortfolioQuestion`)만 유지

### 2026-01-31: Google Drive 저장 최적화 및 자동 업데이트
- **기능 추가 — LZ-String 압축**:
  - 저장 시 LZ-String UTF16 압축 적용으로 파일 크기 70-80% 감소
  - 레거시 호환: 압축되지 않은 기존 파일도 정상 로드
- **기능 추가 — 앱 시작 시 자동 시세 업데이트**:
  - 마지막 업데이트 날짜(`lastUpdateDate`) 확인
  - 오늘 업데이트 안 했으면 자동으로 시세 갱신
- **기능 추가 — 히스토리 보간(Interpolation)**:
  - 앱을 안 열었던 날의 데이터를 마지막 스냅샷으로 자동 채움
  - `fillAllMissingDates()` 함수로 중간 빈 날짜도 보간
- **새로운 파일**: `utils/historyUtils.ts`
- **의존 관계**:
  - `googleDriveService.ts` → `lz-string` 패키지 의존성 추가
  - `usePortfolioData.ts` → `historyUtils.ts`의 `fillAllMissingDates` 사용
  - `PortfolioContext.tsx` → `shouldAutoUpdate` 플래그 기반 자동 업데이트 트리거

### 2026-01-30: Google Drive 공유 폴더 지원 추가
- **기능 추가 — 다중 계정 데이터 공유**:
  - OAuth scope를 `drive.file` → `drive`로 변경하여 공유 폴더 접근 권한 확보
  - Google Drive API 호출 시 `supportsAllDrives`, `includeItemsFromAllDrives` 파라미터 추가
  - 동일 폴더를 공유받은 계정들이 같은 `portfolio.json` 파일 참조 가능
- **설정 방법**:
  1. Google Cloud Console에서 OAuth 동의 화면에 `drive` scope 추가
  2. Google Drive에서 데이터 폴더를 다른 계정과 "편집자" 권한으로 공유
  3. 기존 로그인 세션 로그아웃 후 재로그인 (새 scope 적용)
- **영향받는 파일**:
  - `services/googleDriveService.ts` (scope 변경, API 파라미터 추가)

### 2026-01-28: 수익통계 매도 손익 계산 로직 개선
- **버그 수정 — 추가매수 후 과거 매도 손익이 잘못 계산되는 문제**:
  - **문제**: 보유 종목을 추가매수하면 평균 매수가가 변경되어, 과거 매도 기록의 손익이 변경된 평균가 기준으로 재계산됨 (예: 수익이었던 매도가 손실로 표시)
  - **원인**: `SellAnalyticsPage.tsx`의 `recordWithCalc`에서 보유 자산이 존재하면 스냅샷을 무시하고 현재 자산의 평균 매수가를 사용
  - **해결**: 스냅샷 필드(`originalPurchasePrice` 등)가 존재하면 **우선 사용**하고, 스냅샷이 없는 경우에만 현재 자산 정보로 폴백하도록 로직 변경
- **영향받는 파일**:
  - `components/SellAnalyticsPage.tsx` (수익률 계산 우선순위 변경)

### 2026-01-28: 보유 종목 추가매수 기능 추가
- **기능 추가 — 추가매수 모달 및 로직**:
  - 포트폴리오 테이블의 '관리' 드롭다운 메뉴에 '매수' 버튼 추가 (매도 버튼 위에 위치, 초록색 텍스트)
  - '매수' 클릭 시 추가매수 모달(`BuyMoreAssetModal.tsx`) 표시
  - 모달에서 매수일자, 매수가, 매수 수량 입력 → 예상 매수금액, 변경 후 평균단가, 변경 후 총 수량 실시간 미리보기
  - 추가매수 확인 시:
    - **가중평균 매수단가** 자동 계산: `(기존수량 × 기존단가 + 추가수량 × 추가단가) / 총수량`
    - **외화 자산 환율** 가중평균 재계산: 매수일 기준 환율 조회 후 기존 환율과 가중평균
    - **매수일자** 유지: 최초 매수일 변경 없음
    - **메모에 이력 기재**: `(YY.M.DD xx주 xxx원 추가매수)` 형식으로 자동 기록
- **새로운 파일**: `components/BuyMoreAssetModal.tsx`
- **의존 관계**:
  - `useAssetActions.ts` → `handleConfirmBuyMore` 함수 추가 (외화 환율 조회를 위해 `geminiService.fetchHistoricalExchangeRate` 사용)
  - `PortfolioContext.tsx` → `buyingAsset` 상태, `openBuyModal`/`closeBuyModal`/`confirmBuyMore` 액션 추가
  - `types/store.ts` → `ModalState.buyingAsset`, `PortfolioActions.confirmBuyMore`/`openBuyModal`/`closeBuyModal` 타입 추가
  - `types/ui.ts` → `PortfolioTableProps.onBuy` prop 추가
  - `PortfolioTableRow.tsx` → 드롭다운 메뉴에 `onBuy` 콜백 연결
  - `PortfolioTable.tsx` → `onBuy` prop 수신 및 Row로 전달
  - `PortfolioView.tsx` → `onBuy={actions.openBuyModal}` 연결
  - `App.tsx` → `BuyMoreAssetModal` 렌더링 추가

### 2026-01-27: 수익 통계 수익률 계산 오류 수정 및 매도 알림 설정 영구 저장
- **버그 수정 1 — 완전 매도 자산 수익률 0% 표시 문제**:
  - **문제**: 자산을 전량 매도(삭제)한 뒤, '수익 통계' 탭에서 해당 매도 기록의 수익률이 항상 `0.00%`로 표시됨
  - **원인**: `SellAnalyticsPage.tsx`의 `recordWithCalc`에서 현재 보유 자산(`assets`)만 참조하여 매수가를 조회했기 때문에, 전량 매도 후 삭제된 자산은 매수가를 `0`으로 계산
  - **해결**: `SellRecord`에 저장된 스냅샷 필드(`originalPurchasePrice`, `originalPurchaseExchangeRate`, `originalCurrency`)를 활용하는 `toKRWPurchaseFromRecord()` 함수 추가. 보유 자산에서 조회 실패 시 매도 기록의 스냅샷 데이터로 폴백
- **기능 추가 — 매도 기록 목록 테이블**:
  - '수익 통계' 탭 하단에 개별 매도 기록을 확인할 수 있는 테이블 추가
  - 매도일, 종목명, 티커, 수량, 매도금액, 매수금액, 실현손익, 수익률 컬럼 제공
  - 매도일 기준 최신순 정렬, 손익에 따른 색상 구분(녹색/빨간색)
- **버그 수정 2 — 매도 알림 하락률(`sellAlertDropRate`) 미저장 문제**:
  - **문제**: 매도 알림 '최고가대비' % 설정값이 페이지 새로고침 시 기본값(15%)으로 초기화됨
  - **원인**: `sellAlertDropRate`가 `PortfolioContext`의 로컬 `useState`로만 관리되어 Google Drive 저장/로드 체인에 포함되지 않음
  - **해결**: `useGoogleDriveSync` → `usePortfolioData` → `PortfolioContext` 전체 영속화 체인에 `sellAlertDropRate` 추가
- **영향받는 파일**:
  - `components/SellAnalyticsPage.tsx` (수익률 계산 수정 + 매도 기록 테이블 추가)
  - `hooks/useGoogleDriveSync.ts` (`LoadedData` 타입 및 `autoSave`/`loadFromGoogleDrive`에 `sellAlertDropRate` 추가)
  - `hooks/usePortfolioData.ts` (`sellAlertDropRate` 상태 관리 및 영속화)
  - `hooks/usePortfolioExport.ts` (`triggerAutoSave` 타입 시그니처 업데이트)
  - `contexts/PortfolioContext.tsx` (로컬 상태를 영속화된 값으로 교체)

### 2026-01-19: 매도 자산 통계 및 수익률 계산 개선
- **문제**: 자산 전량 매도 후 목록에서 삭제 시, 대시보드 매도 통계에서 제외되고 수익금 계산이 불가능한 문제 발생
- **해결**:
  1. `SellRecord` 타입에 매수 당시 정보(`originalPurchasePrice`, `originalPurchaseExchangeRate` 등) 필드 추가
  2. 매도 확정(`handleConfirmSell`) 시점에 매수 정보를 스냅샷하여 영구 저장
  3. `usePortfolioCalculator`의 매도 통계 로직을 `assets`(보유 자산) 기준에서 `sellHistory`(전체 매도 이력) 기준으로 변경
- **영향받는 파일**:
  - `types/index.ts`
  - `hooks/useAssetActions.ts`
  - `hooks/usePortfolioCalculator.ts`
  - `hooks/usePortfolioStats.ts`
  - `contexts/PortfolioContext.tsx`

### 2026-01-15: 리밸런싱 목표 금액 저장 기능 추가
- **기능 추가**: 목표 총 자산 금액(`targetTotalAmount`) 저장 기능 구현
  - `AllocationTargets` 타입 확장 (`weights` + `targetTotalAmount`)
  - Google Drive 연동 및 JSON 내보내기/가져오기 지원
  - 데이터 마이그레이션 로직 추가 (구버전 호환성 확보)
- **영향받는 파일**:
  - `types/index.ts`
  - `hooks/useRebalancing.ts`, `hooks/usePortfolioData.ts`, `hooks/usePortfolioExport.ts`
  - `contexts/PortfolioContext.tsx`

### 2026-01-14: 대시보드 리밸런싱 및 수익률 분석 개선
- **기능 추가**: 포트폴리오 리밸런싱 목표 비중(%) 저장 기능 구현
  - `allocationTargets` 데이터 필드 추가 및 Google Drive 동기화
  - `useRebalancing` 훅으로 로직 분리
- **버그 수정**: 수익률 TOP5/BOTTOM5 분석 오류 수정
  - 외화 자산의 원화 환산 수익률 계산 로직 정교화 (현재 환율 및 매수 환율 반영)
  - `useTopBottomAssets` 훅으로 로직 분리 및 평가손익(KRW) 표시 추가
- **영향받는 파일**:
  - `types/index.ts`, `types/store.ts`
  - `hooks/useGoogleDriveSync.ts`, `hooks/usePortfolioData.ts`
  - `components/dashboard/RebalancingTable.tsx`, `components/dashboard/TopBottomAssets.tsx`
  - `hooks/useRebalancing.ts`, `hooks/useTopBottomAssets.ts` (신규)

### 2025-01-13: 외화 자산 차트 개선
- **문제**: 외화 자산의 과거 데이터가 원화(KRW)로 저장되어 있어, 차트에서 외화 단위(USD/JPY)로 볼 때 값의 단위가 맞지 않는 문제 발생
- **해결**:
  1. `AssetTrendChart`에 원화/외화 보기 토글 기능 추가
  2. 외화 모드 시, 과거 데이터의 `unitPriceOriginal`(외화 원본) 우선 사용
  3. 원본 데이터가 없는 과거 구간은 현재 환율을 역산하여 외화 가치 추정 표시
  4. `PortfolioTableRow`에서 정확한 환율 정보를 차트로 전달하도록 구조 개선
- **영향받는 파일**:
  - `components/AssetTrendChart.tsx`
  - `components/portfolio-table/PortfolioTableRow.tsx`
  - `hooks/usePortfolioHistory.ts`

### 2025-01-11: 수익률 계산 환율 기준 통일
- **문제**: 대시보드 총 수익률과 손익분석 차트의 수익률이 다르게 표시됨
- **원인**: 대시보드는 실시간 환율로 매수가를 계산, 차트는 구매 당시 환율로 계산
- **해결**:
  1. `usePortfolioCalculator.ts`에 `getPurchaseValueInKRW()` 함수 추가
  2. 매수가 계산 시 `purchaseExchangeRate`(구매 당시 환율) 우선 적용
  3. 구매 환율이 없는 기존 자산은 현재 환율로 폴백 (하위 호환성)
- **영향받는 파일**:
  - `hooks/usePortfolioCalculator.ts`
- **결과**: 대시보드와 손익 차트의 수익률이 동일하게 표시됨

### 2024-XX-XX: 암호화폐 시세 조회 개선
- **문제**: Cloud Run 서버에서 암호화폐 시세 조회 실패 (빈 응답 반환)
- **원인**: FinanceDataReader가 암호화폐를 지원하지 않음
- **해결**:
  1. Cloud Run 서버에 `/upbit` 엔드포인트 추가 (업비트 API 프록시)
  2. `useMarketData.ts`에서 `exchange` 기준 분기 처리
  3. `upbitService.ts`가 Cloud Run 프록시 호출하도록 수정
- **영향받는 파일**:
  - `main.py` (Cloud Run 서버)
  - `hooks/useMarketData.ts`
  - `services/upbitService.ts`