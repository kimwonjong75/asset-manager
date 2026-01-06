# KIM'S 퀸트자산관리 - 포트폴리오 관리 시스템

## 📋 프로젝트 개요

KIM'S 퀸트자산관리는 계량적 투자 전략을 기반으로 한 종합 자산 관리 시스템입니다. Google Drive 연동을 통해 데이터를 안전하게 저장하고, 실시간 시세 정보를 제공하며, 다양한 자산 종류를 지원하는 포트폴리오 관리 도구입니다.

### 핵심 기능
- **멀티 자산 지원**: 한국주식, 미국주식, 해외주식, 채권, 암호화폐, 실물자산, 현금
- **실시간 시세 업데이트**: 외부 API를 통한 실시간 가격 정보
- **환율 자동 반영**: USD, JPY 등 주요 통화 환율 자동 적용
- **Google Drive 동기화**: 안전한 클라우드 저장소 연동
- **포트폴리오 분석**: 자산 배분, 수익률, 손익 추이 분석
- **매도 알림**: 설정한 하락률 기준 알림 기능
- **관심종목 관리**: 별도의 워치리스트 기능
- **CSV 대량 등록**: 대량의 자산 일괄 등록
- **기술적 지표 연동**: MA20/MA60 및 RSI 상태(NORMAL/OVERBOUGHT/OVERSOLD) 수신 및 표시
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
│   │   └── Toggle.tsx       # 토글 스위치 컴포넌트
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
│   ├── SellAssetModal.tsx   # 자산 매도 모달
│   ├── StatCard.tsx         # 통계 카드
│   ├── TopBottomAssets.tsx  # 상위/하위 자산
│   └── WatchlistPage.tsx    # 관심종목 페이지
├── hooks/                    # 커스텀 훅
│   ├── usePortfolioData.ts   # 핵심 데이터 및 동기화 관리
│   ├── useMarketData.ts      # 시세 및 환율 관리 (암호화폐 분기 처리 포함)
│   ├── useAssetActions.ts    # 자산 CRUD 및 액션 관리
│   ├── useGoogleDriveSync.ts # Google Drive API 래퍼
│   └── useOnClickOutside.ts  # 외부 클릭 감지 훅
├── services/                 # 외부 서비스 연동
│   ├── geminiService.ts   # Gemini AI 서비스
│   ├── googleDriveService.ts # Google Drive API
│   ├── priceService.ts    # 시세 정보 서비스 (주식/ETF)
│   └── upbitService.ts    # 업비트 API 서비스 (Cloud Run 프록시 경유)
├── utils/                    # 유틸리티 함수
│   ├── migrateData.ts     # 데이터 마이그레이션
│   └── signalUtils.ts     # 서버 신호/RSI 뱃지 렌더링 유틸
├── types.ts                # TypeScript 타입 정의
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
  - `https://www.googleapis.com/auth/drive.file`
  - `https://www.googleapis.com/auth/userinfo.email`
  - `https://www.googleapis.com/auth/userinfo.profile`
  - `openid`

#### 4. 내부 모듈 의존성
```
App.tsx
├── hooks/
│   └── useMarketData.ts ─────┬─── priceService.ts (주식/ETF)
│                             └─── upbitService.ts (암호화폐)
├── services/
│   ├── priceService.ts      (시세 정보 - Cloud Run /)
│   ├── upbitService.ts      (암호화폐 - Cloud Run /upbit) ← 신규 의존성
│   ├── googleDriveService.ts (클라우드 저장)
│   └── geminiService.ts    (AI 분석)
└── components/             (UI 컴포넌트들)
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
- **useAssetActions**: 자산 추가/수정/삭제, 매도, CSV 업로드 등 사용자 인터랙션 처리

### 3. priceService.ts (주식/ETF 시세 서비스)
**역할**: Cloud Run 서버를 통한 주식/ETF 시세 정보 관리
**책임**:
- 배치 단위 시세 조회 (20개씩 청크 처리)
- 환율 정보 조회
- 재시도 로직 (1회)
- 에러 처리 및 모킹 데이터 제공
**대상 자산**:
- 한국주식 (KRX, KONEX)
- 미국주식 (NASDAQ, NYSE, AMEX)
- 해외주식 (TSE 등)
- ETF, 채권, 실물자산

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
**주요 변경사항**:
- **수익률 계산 로직 개선 (Upbit/Bithumb 예외 처리)**: Upbit/Bithumb 자산의 경우, 설정된 통화(`currency`)와 무관하게 API가 반환하는 원화(`KRW`) 가격을 기준으로 수익률을 계산하도록 로직 수정. `currency`가 'USD'로 설정되어 있어도 `currentPrice`는 KRW(API 값), `yesterdayPrice`는 USD(데이터 불일치)인 경우를 감지하여 환율을 자동 적용해 올바른 등락률(`yesterdayChange`)을 계산하고 비정상적인 수익률(예: 147,000%) 표시 문제를 해결함.
- **변동액 표시 개선**: 전일 대비 변동액(`diffFromYesterday`) 또한 KRW 기준으로 계산 및 표시.

### 7. RebalancingTable.tsx (포트폴리오 리밸런싱)
**역할**: 목표 자산 비중 설정 및 리밸런싱 가이드 제공
**기능**:
- **목표 비중 설정**: 자산군별 목표 비중(%) 입력 및 목표 금액 자동 계산
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

### 3. 환율 적용 로직
```typescript
// 대시보드 환율 값 우선 적용
// 기본값: USD: 1450, JPY: 9.5
// 실시간 API 실패 시 기존 값 유지
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

- 응답 포맷
  - `indicators.ma20`: 20일 이동평균
  - `indicators.ma60`: 60일 이동평균
  - `indicators.rsi`: RSI 값
  - `indicators.rsi_status`: NORMAL/OVERBOUGHT/OVERSOLD
  - `indicators.signal`: STRONG_BUY/BUY/SELL/STRONG_SELL/NEUTRAL
- 데이터 전달 경로
  - Cloud Run → services/priceService.ts → hooks/useMarketData.ts
- UI 표시
  - 워치리스트 “신호” 칼럼에서 서버 신호/RSI를 배지로 표시
  - 표시 로직: utils/signalUtils.ts
  - 컴포넌트: components/WatchlistPage.tsx

## 🖥️ Cloud Run 서버 (백엔드)

### 엔드포인트
| 경로 | 메서드 | 설명 | 요청 형식 |
|------|--------|------|-----------|
| `/` | POST | 주식/ETF 시세 조회 | `{ "tickers": [{"ticker": "005930", "exchange": "KRX"}] }` |
| `/upbit` | POST | 암호화폐 시세 조회 | `{ "symbols": ["BTC", "ETH"] }` |

### 주요 파일
```
cloud-run/
├── main.py           # Cloud Run 엔트리포인트
└── requirements.txt  # Python 의존성
```

### main.py 핵심 기능
```python
# 기존: 주식/ETF 시세 조회 (FinanceDataReader)
def fetch_single_ticker(ticker):
    df = fdr.DataReader(ticker, start=start_date, end=end_date)
    ...

# 신규: 업비트 프록시
def fetch_upbit_prices(markets):
    url = f"https://api.upbit.com/v1/ticker?markets={markets_param}"
    response = requests.get(url)
    ...

@functions_framework.http
def get_stock_prices(request):
    if path == '/upbit' or path == '/upbit/':
        # 업비트 프록시 처리
        ...
    else:
        # 기존 주식 조회 처리
        ...
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

### 2. 환율 처리
- **기본값 설정**: USD 1450, JPY 9.5
- **유효성 검사**: USD > 100, JPY > 1
- **실시간 반영**: 자산 가치 계산 전 환율 우선 업데이트

### 3. Google Drive 동기화
- **자동 저장**: 2초 디바운스 적용
- **토큰 갱신**: 만료 5분 전 자동 갱신
- **오류 처리**: 네트워크 오류 시 재시도 로직

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
