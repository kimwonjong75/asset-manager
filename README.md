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

## 🏗️ 시스템 아키텍처

### 기술 스택
- **프론트엔드**: React 19.2.0, TypeScript
- **스타일링**: Tailwind CSS
- **빌드 도구**: Vite
- **차트 라이브러리**: Recharts
- **아이콘**: Lucide React
- **배포**: GitHub Pages

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
│   │   ├── DashboardView.tsx    # 대시보드 탭
│   │   ├── PortfolioView.tsx    # 포트폴리오 탭
│   │   ├── AnalyticsView.tsx    # 통계 탭
│   │   └── WatchlistView.tsx    # 관심종목 탭
│   ├── PortfolioAssistant.tsx # 포트폴리오 AI 어시스턴트
│   ├── PortfolioModal.tsx   # 포트폴리오 모달
│   ├── PortfolioTable.tsx   # 포트폴리오 테이블 (메인 Wrapper)
│   ├── portfolio-table/     # 포트폴리오 테이블 내부 컴포넌트
│   │   ├── PortfolioTableRow.tsx # 테이블 행 컴포넌트
│   │   ├── usePortfolioData.ts   # 데이터 로직 훅
│   │   ├── types.ts              # 타입 정의
│   │   └── utils.ts              # 유틸리티 함수
│   ├── ProfitLossChart.tsx  # 손익 추이 차트
│   ├── RegionAllocationChart.tsx # 지역 배분 차트
│   ├── SellAlertControl.tsx # 매도 알림 설정
│   ├── SellAnalyticsPage.tsx # 매도 분석 페이지
│   ├── SellAssetModal.tsx   # 자산 매도 모달
│   ├── StatCard.tsx         # 통계 카드
│   ├── TopBottomAssets.tsx  # 상위/하위 자산
│   └── WatchlistPage.tsx    # 관심종목 페이지
├── hooks/                    # 커스텀 훅
│   ├── usePortfolioData.ts   # 핵심 데이터 및 동기화 관리
│   ├── useMarketData.ts      # 시세 및 환율 관리
│   ├── useAssetActions.ts    # 자산 CRUD 및 액션 관리
│   ├── useGoogleDriveSync.ts # Google Drive API 래퍼
│   └── useOnClickOutside.ts  # 외부 클릭 감지 훅
├── services/                 # 외부 서비스 연동
│   ├── geminiService.ts   # Gemini AI 서비스
│   ├── googleDriveService.ts # Google Drive API
│   ├── priceService.ts    # 시세 정보 서비스
│   └── upbitService.ts    # 업비트 API 서비스
├── utils/                    # 유틸리티 함수
│   └── migrateData.ts     # 데이터 마이그레이션
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
  yesterdayPrice?: number;     // 전일 종가
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
외부 API (시세/환율) → priceService → 데이터 가공 → UI 반영
     ↓
포트폴리오 분석 → 차트/통계 → 시각화
```

### 주요 의존성

#### 1. 외부 API 의존성
- **시세 API**: `https://asset-manager-887842923289.asia-northeast3.run.app`
  - 한국주식, 미국주식, 해외주식 시세
  - 암호화폐 가격 (USD 기준)
  - 환율 정보 (USD/KRW, JPY/KRW)

#### 2. Google Drive API
- **인증**: OAuth 2.0
- **스코프**: 
  - `https://www.googleapis.com/auth/drive.file`
  - `https://www.googleapis.com/auth/userinfo.email`
  - `https://www.googleapis.com/auth/userinfo.profile`
  - `openid`

#### 3. 내부 모듈 의존성
```
App.tsx
├── services/
│   ├── priceService.ts      (시세 정보)
│   ├── googleDriveService.ts (클라우드 저장)
│   └── geminiService.ts    (AI 분석)
├── hooks/
│   └── useGoogleDriveSync.ts (동기화 관리)
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
- **useAssetActions**: 자산 추가/수정/삭제, 매도, CSV 업로드 등 사용자 인터랙션 처리

### 3. PortfolioTable.tsx (포트폴리오 테이블)
**역할**: 자산 목록 표시 및 관리 (Wrapper 컴포넌트)
**구조**:
- `components/portfolio-table/` 디렉토리로 로직 분리
- `usePortfolioData`: 데이터 가공, 정렬, 필터링 로직 담당
- `PortfolioTableRow`: 개별 행 렌더링 담당
**책임**:
- 자산 데이터 테이블 렌더링 (View)
- 정렬 및 필터링 (Logic 위임)
- 개별/전체 시세 업데이트
- 자산 편집/삭제/매도
- 매도 알림 표시

### 3. priceService.ts (시세 서비스)
**역할**: 외부 API를 통한 시세 정보 관리
**책임**:
- 배치 단위 시세 조회 (20개씩 청크 처리)
- 환율 정보 조회
- 재시도 로직 (1회)
- 에러 처리 및 모킹 데이터 제공

### 4. googleDriveService.ts (Google Drive 서비스)
**역할**: 클라우드 저장소 관리
**책임**:
- OAuth 2.0 인증
- 토큰 자동 갱신 (만료 5분 전)
- 파일 저장/불러오기
- 사용자 정보 관리

### 5. DashboardView.tsx (대시보드)
**역할**: 전체 자산 현황 요약 및 환율/필터 제어
**주요 변경사항**:
- **UI 레이아웃 개선**: 자산 필터, 환율 입력, 매도 알림을 상단 한 줄에 배치하여 공간 효율성 최적화
- **ExchangeRateInput 연동**: 외부 스타일 주입(`className`)을 통해 유연한 배치 적용
- **반응형 디자인**: 화면 크기에 따른 자동 줄바꿈(`flex-wrap`) 지원

## ⚙️ 핵심 로직 및 알고리즘

### 1. 시세 업데이트 로직
```typescript
// 청크 단위 처리 (20개씩)
const CHUNK_SIZE = 20;
const CHUNK_DELAY_MS = 500;

// 환율 우선 업데이트 → 자산 가격 업데이트
// KRW 단위 오류 자동 보정
// 비현금/현금 자산 분리 처리
```

### 2. 환율 적용 로직
```typescript
// 대시보드 환율 값 우선 적용
// 기본값: USD: 1450, JPY: 9.5
// 실시간 API 실패 시 기존 값 유지
```

### 3. 자산 카테고리 추론
```typescript
// 거래소 정보를 통한 카테고리 자동 판단
KRX/KONEX → 한국주식
NASDAQ/NYSE → 미국주식
TSE → 해외주식
금 관련 거래소 → 실물자산
```

### 4. 데이터 마이그레이션
```typescript
// 이전 버전 데이터 구조 변환
// region 필드 제거
// category 매핑 (한국어 → enum)
// exchange 기본값 설정
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

## 📋 주의사항 및 오류 방지 가이드

### 1. 시세 API 관련
- **청크 크기 제한**: 20개씩 요청 (API 제한 사항)
- **재시도**: 실패 시 1회 재시도, 1초 대기
- **모킹 데이터**: API 실패 시 기본값 제공 (isMocked: true)

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
- **청크 처리**: 대량 데이터分批 처리
- **지연 로딩**: 컴포넌트 지연 로딩 적용

## 🔍 디버깅 및 모니터링

### 로그 레벨
- `console.log`: API 요청/응답 데이터
- `console.error`: 오류 상세 정보
- `console.warn`: 경고 메시지

### 에러 처리
- **사용자 친화적 메시지**: 기술적 오류를 이해하기 쉽게 변환
- **자동 복구**: 가능한 경우 자동 복구 시도
- **상태 복원**: 오류 발생 시 이전 상태로 복원

### 모니터링 포인트
- API 응답 시간
- 환율 업데이트 성공률
- Google Drive 동기화 성공률
- 메모리 사용량

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

### 통화 추가
1. `Currency` enum에 추가
2. `CURRENCY_SYMBOLS`에 심볼 추가
3. 환율 API 엔드포인트 확인
4. 환율 입력 UI 업데이트

---

**문의사항**: 프로젝트 이슈 트래커를 통해 문의해 주세요.
**라이선스**: 이 프로젝트는 개인 용도로 사용 가능합니다.