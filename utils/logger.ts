// 중앙 로깅 유틸리티
// - 프로덕션 빌드: warn/error만 출력
// - 개발 환경: 모든 레벨 출력
// - 모듈명 자동 프리픽스

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const IS_PROD = import.meta.env.PROD;
const MIN_LEVEL: LogLevel = IS_PROD ? 'warn' : 'debug';

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[MIN_LEVEL];
}

export function createLogger(module: string) {
  const prefix = `[${module}]`;

  return {
    debug: (...args: unknown[]) => { if (shouldLog('debug')) console.log(prefix, ...args); },
    info: (...args: unknown[]) => { if (shouldLog('info')) console.log(prefix, ...args); },
    warn: (...args: unknown[]) => { if (shouldLog('warn')) console.warn(prefix, ...args); },
    error: (...args: unknown[]) => { if (shouldLog('error')) console.error(prefix, ...args); },
  };
}
