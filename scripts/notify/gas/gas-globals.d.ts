// scripts/notify/gas/gas-globals.d.ts
// ---------------------------------------------------------------------------
// Google Apps Script 런타임 전역의 최소 앰비언트 타입 선언.
// 이 프로젝트는 `@types/google-apps-script`를 새로 설치하지 않는다(브리프: esbuild만 추가 허용) —
// `entry.ts`가 실제로 호출하는 표면만 손으로 선언한다. `tsconfig.json`에 include/exclude가 없어
// `npm test`/`npm run build`의 `tsc --noEmit`이 이 폴더도 그대로 타입검사하므로 여기서 통과해야 한다.
// 완전한 GAS API가 아니라 entry.ts가 실제로 쓰는 메서드만 담았다 — 새 메서드가 필요해지면 여기 추가한다.

interface GasProperties {
  getProperty(key: string): string | null;
  setProperty(key: string, value: string): void;
  deleteProperty(key: string): void;
  getProperties(): Record<string, string>;
}

declare const PropertiesService: {
  getScriptProperties(): GasProperties;
};

interface GasHttpResponse {
  getResponseCode(): number;
  getContentText(): string;
}

interface GasUrlFetchParams {
  method?: 'get' | 'post' | 'put' | 'delete';
  headers?: Record<string, string>;
  payload?: string;
  contentType?: string;
  muteHttpExceptions?: boolean;
  followRedirects?: boolean;
}

declare const UrlFetchApp: {
  fetch(url: string, params?: GasUrlFetchParams): GasHttpResponse;
};

interface GasTextOutput {
  setMimeType(mimeType: string): GasTextOutput;
}

declare const ContentService: {
  createTextOutput(text: string): GasTextOutput;
  MimeType: { JSON: string; TEXT: string };
};

interface GasHtmlOutput {
  setTitle(title: string): GasHtmlOutput;
}

declare const HtmlService: {
  createHtmlOutput(html: string): GasHtmlOutput;
};

interface GasBlob {
  getDataAsString(charset?: string): string;
}

interface GasDriveFile {
  getId(): string;
  setContent(content: string): GasDriveFile;
  getBlob(): GasBlob;
}

declare const DriveApp: {
  createFile(name: string, content: string, mimeType?: string): GasDriveFile;
  getFileById(id: string): GasDriveFile;
};

interface GasTrigger {
  getHandlerFunction(): string;
}

interface GasClockTriggerBuilder {
  everyHours(n: number): GasClockTriggerBuilder;
  everyMinutes(n: number): GasClockTriggerBuilder;
  everyDays(n: number): GasClockTriggerBuilder;
  atHour(hour: number): GasClockTriggerBuilder;
  create(): GasTrigger;
}

interface GasTriggerBuilder {
  timeBased(): GasClockTriggerBuilder;
}

declare const ScriptApp: {
  newTrigger(functionName: string): GasTriggerBuilder;
  getProjectTriggers(): GasTrigger[];
  deleteTrigger(trigger: GasTrigger): void;
  getService(): { getUrl(): string };
};

declare const MailApp: {
  sendEmail(recipient: string, subject: string, body: string): void;
};

interface GasUser {
  getEmail(): string;
}

declare const Session: {
  getEffectiveUser(): GasUser;
};

declare const Utilities: {
  sleep(ms: number): void;
};

/** doGet 이벤트 — 실제 GAS 타입의 부분집합(entry.ts가 쓰는 필드만). */
interface GasDoGetEvent {
  parameter: Record<string, string>;
}

/** doPost 이벤트 — 실제 GAS 타입의 부분집합. `postData`는 브라우저가 body를 실었을 때만 존재. */
interface GasDoPostEvent {
  parameter: Record<string, string>;
  postData?: { contents: string; type: string; length: number; name: string };
}
