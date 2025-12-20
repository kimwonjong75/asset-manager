## 문제 요약
- 대량(70+개) 종목을 한 번에 요청하며 `services/priceService.ts:95`의 `fetchBatchAssetPrices`가 단일 요청으로 처리합니다.
- 서버 타임아웃/네트워크 오류 시 전체 `try-catch`가 발동해 모든 종목을 기본값으로 대체되어, UI에서는 모든 종목 실패로 표시됩니다(`App.tsx:347`).

## 현재 구현 관찰
- 단일 `POST`로 모든 `assets`를 전송(`services/priceService.ts:101–112`).
- 전체 `try-catch`에서 실패 시 모든 자산을 `isMocked: true`로 채웁니다(`services/priceService.ts:163–173`).
- 성공 케이스에서는 누락된 종목만 기본값으로 보충합니다(`services/priceService.ts:152–162`).

## 변경 목표
1. 대량 요청을 20개 단위 청크로 분할해 순차 요청.
2. 청크 사이 500ms 지연으로 서버 부하 완화.
3. 각 청크 실패 시 에러 로그에 상세 정보(`console.error('API Error Details:', e)`)를 남기고, 다른 청크의 성공 데이터는 유지.
4. 전체 처리 후 누락된 종목만 기본값으로 채워 최종 `resultMap` 반환.

## 구현 계획
- 상수 추가: `CHUNK_SIZE = 20`, `CHUNK_DELAY_MS = 500`.
- 유틸 추가: `sleep(ms)` Promise 기반 지연 함수.
- `fetchBatchAssetPrices` 재구성:
  - `for (let i=0; i<assets.length; i+=CHUNK_SIZE)` 반복.
  - 각 `chunk`에 대해 기존 payload 생성 로직 재사용(암호화폐 `-USD` 부착, `normalizeExchange` 유지).
  - `try { fetchStocksBatch(payload); items normalize; resultMap.set(...) } catch(e) { console.error('API Error Details:', e); }`.
  - `await sleep(CHUNK_DELAY_MS)`로 지연.
- 글로벌 `try-catch` 제거: 기존의 전체 실패 시 전부 기본값으로 덮는 로직을 삭제.
- 루프 종료 후, `assets`를 순회하여 `resultMap`에 없는 항목만 기본값으로 보충.

## 코드 변경 포인트(라인 레퍼런스)
- `services/priceService.ts:95`의 `export async function fetchBatchAssetPrices(...)`를 청크 처리 로직으로 대체.
- 기존 `console.log('fetchBatchAssetPrices payload', payload)`는 청크별로 유지하되, 필요 시 간단히 요약 로깅.
- 실패 시 `console.error('API Error Details:', e)` 추가.
- `fetchAssetData`(`services/priceService.ts:178`)는 그대로 유지.

## 에지 케이스/보완
- 중복 티커: `Map`은 마지막 청크 값으로 덮어씁니다(현재 방식과 동일).
- 암호화폐 KRW 환산: 기존 처리(USD 환율을 App에서 곱함) 유지.
- 서버 응답 형식 다양한 경우: 기존 `items` 정규화 로직(`results`/배열/객체) 재사용.
- 네트워크 실패가 연속 발생 시: 성공한 청크만 반영되고, 실패 청크 항목만 기본값으로 채워 UI의 “부분 성공” 맞춤.

## 검증 계획
- 70+개 포트폴리오에서 업데이트 실행.
- 콘솔에서 청크당 요청/응답 로깅 확인.
- 실패 시 콘솔에 `API Error Details:`로 상세 원인 확인(네트워크/HTTP 코드 등).
- UI에서 성공/실패 카운트가 부분 성공을 반영하고, 실패 종목 목록이 일부에만 표시되는지 확인.

## 선택적 개선(별도 승인 시 적용)
- `App.tsx:347`의 per-asset 실패 로그는 유지하되, 최종 요약 메시지(`successCount/failedCount`)를 chunk 기반 장애에도 정확히 반영하는지 확인.
- 필요 시 payload/응답 로깅 양을 축소해 콘솔 스팸 방지.