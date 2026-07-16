// KRX official-data cross-check adapter for conditional-channel-kr-size-v1.
// The service key is accepted only at runtime and is never persisted.

import type { IsoDate, IsoTimestamp } from '../../../../types/backtestConditionalChannel';

export class KrxAdapterError extends Error {
  constructor(
    public readonly code: 'NO_SERVICE_KEY' | 'API_ERROR' | 'PARSE_ERROR' | 'QUOTA_EXCEEDED',
    message: string
  ) {
    super(message);
    this.name = 'KrxAdapterError';
  }
}

export interface KrxCrossCheckRecord {
  code: string;
  checkDate: IsoDate;
  marcapClose: number | null;
  krxClose: number | null;
  closePctDiff: number | null;
  marcapStocks: number | null;
  krxStocks: number | null;
  stocksPctDiff: number | null;
  closeMatch: boolean;
  stocksMatch: boolean;
}

export type CrossCheckVerdict =
  | 'PASS'
  | 'FAIL_PRICE_MISMATCH'
  | 'FAIL_STOCKS_MISMATCH'
  | 'FAIL_NO_SAMPLES'
  | 'FAIL_INSUFFICIENT_SAMPLES'
  | 'WAITING_FOR_USER_KEY';

export interface KrxCrossCheckResult {
  status: CrossCheckVerdict;
  checkedAt: IsoTimestamp | null;
  records: KrxCrossCheckRecord[];
  failedRecords: KrxCrossCheckRecord[];
  note: string;
}

const KRX_API_BASE_URL =
  'https://apis.data.go.kr/1160100/service/GetStockSecuritiesInfoService';
const CLOSE_TOLERANCE_PCT = 0.01;
const STOCKS_TOLERANCE_PCT = 0.001;
export const MIN_KRX_CROSSCHECK_SAMPLES = 10;

export function buildWaitingResult(): KrxCrossCheckResult {
  return {
    status: 'WAITING_FOR_USER_KEY',
    checkedAt: null,
    records: [],
    failedRecords: [],
    note:
      'data.go.kr 서비스키가 없어 공식 KRX 교차검증을 실행하지 않았다. ' +
      '서비스키 발급 후 data-audit 단계에서 다시 실행해야 한다.',
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? value as Record<string, unknown>
    : null;
}

function asFiniteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractItems(body: unknown): Record<string, unknown>[] {
  const root = asRecord(body);
  const response = asRecord(root?.response);
  const responseBody = asRecord(response?.body);
  const items = asRecord(responseBody?.items);
  const itemValue = items?.item;
  if (Array.isArray(itemValue)) {
    return itemValue.map(asRecord).filter((item): item is Record<string, unknown> => item !== null);
  }
  const single = asRecord(itemValue);
  return single === null ? [] : [single];
}

export async function fetchKrxDailyPrice(
  serviceKey: string,
  code: string,
  date: string
): Promise<{ close: number; stocks: number } | null> {
  if (!serviceKey.trim()) {
    throw new KrxAdapterError('NO_SERVICE_KEY', 'data.go.kr 서비스키가 없습니다.');
  }

  const url = new URL(`${KRX_API_BASE_URL}/getStockPriceInfo`);
  url.searchParams.set('serviceKey', serviceKey);
  url.searchParams.set('numOfRows', '100');
  url.searchParams.set('pageNo', '1');
  url.searchParams.set('resultType', 'json');
  url.searchParams.set('basDt', date.replace(/-/g, ''));
  url.searchParams.set('likeSrtnCd', code);

  let response: Response;
  try {
    response = await fetch(url.toString());
  } catch (error) {
    throw new KrxAdapterError('API_ERROR', `KRX API 네트워크 오류: ${String(error)}`);
  }
  if (response.status === 429) {
    throw new KrxAdapterError('QUOTA_EXCEEDED', 'KRX API 호출 한도를 초과했다.');
  }
  if (!response.ok) {
    throw new KrxAdapterError('API_ERROR', `KRX API HTTP ${response.status}`);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    throw new KrxAdapterError('PARSE_ERROR', `KRX API JSON 파싱 실패: ${String(error)}`);
  }

  const item = extractItems(body).find((candidate) => String(candidate.srtnCd ?? '') === code);
  if (!item) return null;

  const close = asFiniteNumber(item.clpr);
  const stocks = asFiniteNumber(item.lstgStCnt ?? item.lstgStkCnt ?? item.lstgStkcnt);
  if (close === null || stocks === null) return null;
  return { close, stocks };
}

export function validateCrossCheckInputs(
  samples: ReadonlyArray<{ code: string; date: IsoDate }>,
  marcapData: ReadonlyMap<string, ReadonlyMap<string, { close: number; stocks: number }>>
): KrxCrossCheckResult | null {
  if (samples.length === 0) {
    return {
      status: 'FAIL_NO_SAMPLES',
      checkedAt: null,
      records: [],
      failedRecords: [],
      note: 'KRX 교차검증 표본이 0건이므로 PASS 판정할 수 없다.',
    };
  }
  if (samples.length < MIN_KRX_CROSSCHECK_SAMPLES) {
    return {
      status: 'FAIL_INSUFFICIENT_SAMPLES',
      checkedAt: null,
      records: [],
      failedRecords: [],
      note: `KRX 교차검증은 최소 ${MIN_KRX_CROSSCHECK_SAMPLES}건이 필요하다. 현재 ${samples.length}건이다.`,
    };
  }
  const missing = samples.filter(({ code, date }) => marcapData.get(code)?.get(date) === undefined);
  if (missing.length > 0) {
    return {
      status: 'FAIL_INSUFFICIENT_SAMPLES',
      checkedAt: null,
      records: [],
      failedRecords: [],
      note: `marcap 기준값이 없는 표본 ${missing.length}건이 있어 교차검증을 실행할 수 없다.`,
    };
  }
  return null;
}

export async function runKrxCrossCheck(
  serviceKey: string,
  samples: ReadonlyArray<{ code: string; date: IsoDate }>,
  marcapData: ReadonlyMap<string, ReadonlyMap<string, { close: number; stocks: number }>>
): Promise<KrxCrossCheckResult> {
  if (!serviceKey.trim()) return buildWaitingResult();

  const invalid = validateCrossCheckInputs(samples, marcapData);
  if (invalid) return invalid;

  const records: KrxCrossCheckRecord[] = [];
  const checkedAt = new Date().toISOString() as IsoTimestamp;

  for (const { code, date } of samples) {
    const marcapEntry = marcapData.get(code)?.get(date) ?? null;
    let krxEntry: { close: number; stocks: number } | null = null;
    try {
      krxEntry = await fetchKrxDailyPrice(serviceKey, code, date);
    } catch (error) {
      if (error instanceof KrxAdapterError && error.code === 'QUOTA_EXCEEDED') throw error;
    }

    const closePctDiff = marcapEntry && krxEntry && krxEntry.close > 0
      ? Math.abs(marcapEntry.close - krxEntry.close) / krxEntry.close
      : null;
    const stocksPctDiff = marcapEntry && krxEntry && krxEntry.stocks > 0
      ? Math.abs(marcapEntry.stocks - krxEntry.stocks) / krxEntry.stocks
      : null;

    records.push({
      code,
      checkDate: date,
      marcapClose: marcapEntry?.close ?? null,
      krxClose: krxEntry?.close ?? null,
      closePctDiff,
      marcapStocks: marcapEntry?.stocks ?? null,
      krxStocks: krxEntry?.stocks ?? null,
      stocksPctDiff,
      closeMatch: closePctDiff !== null && closePctDiff <= CLOSE_TOLERANCE_PCT,
      stocksMatch: stocksPctDiff !== null && stocksPctDiff <= STOCKS_TOLERANCE_PCT,
    });
  }

  const failedRecords = records.filter((record) => !record.closeMatch || !record.stocksMatch);
  let status: CrossCheckVerdict = 'PASS';
  if (failedRecords.some((record) => !record.closeMatch)) status = 'FAIL_PRICE_MISMATCH';
  else if (failedRecords.some((record) => !record.stocksMatch)) status = 'FAIL_STOCKS_MISMATCH';

  return {
    status,
    checkedAt,
    records,
    failedRecords,
    note: `${records.length}개 표본 중 ${failedRecords.length}개 불일치`,
  };
}
