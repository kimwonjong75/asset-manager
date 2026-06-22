import React, { useState, useEffect, useCallback } from 'react';
import {
  getGeminiApiKey,
  setGeminiApiKey,
  getGeminiModel,
  setGeminiModel,
  fetchAvailableModels,
  DEFAULT_GEMINI_MODEL,
  type GeminiModelInfo,
} from '../services/geminiSettings';

const AiSettingsSection: React.FC = () => {
  const [keyDraft, setKeyDraft] = useState<string>('');
  const [savedKey, setSavedKey] = useState<string>('');
  const [showKey, setShowKey] = useState<boolean>(false);
  const [model, setModel] = useState<string>(DEFAULT_GEMINI_MODEL);
  const [models, setModels] = useState<GeminiModelInfo[]>([]);
  const [status, setStatus] = useState<string>('');
  const [loadingModels, setLoadingModels] = useState<boolean>(false);

  useEffect(() => {
    const k = getGeminiApiKey();
    setSavedKey(k);
    setKeyDraft(k);
    setModel(getGeminiModel());
  }, []);

  const loadModels = useCallback(async (key: string) => {
    if (!key) return;
    setLoadingModels(true);
    setStatus('모델 목록을 불러오는 중...');
    try {
      const list = await fetchAvailableModels(key);
      setModels(list);
      setStatus(list.length ? `${list.length}개 모델 사용 가능` : '사용 가능한 모델이 없습니다.');
      // 현재 선택 모델이 목록에 없으면 첫 번째로 보정
      if (list.length && !list.some((m) => m.id === getGeminiModel())) {
        setModel(list[0].id);
        setGeminiModel(list[0].id);
      }
    } catch (e) {
      setModels([]);
      setStatus(e instanceof Error ? `오류: ${e.message}` : '모델 목록 조회 실패');
    } finally {
      setLoadingModels(false);
    }
  }, []);

  // 저장된 키가 있으면 진입 시 모델 자동 로드
  useEffect(() => {
    if (savedKey) loadModels(savedKey);
  }, [savedKey, loadModels]);

  const handleSaveKey = () => {
    const k = keyDraft.trim();
    setGeminiApiKey(k);
    setSavedKey(k);
    setStatus(k ? '키가 저장되었습니다.' : '키가 삭제되었습니다.');
    if (!k) setModels([]);
  };

  const handleModelChange = (id: string) => {
    setModel(id);
    setGeminiModel(id);
  };

  return (
    <div className="bg-gray-800 rounded-lg shadow-lg">
      <div className="px-6 py-5 border-b border-gray-700">
        <h2 className="text-xl font-bold text-white">AI 설정 (Gemini)</h2>
        <p className="text-gray-400 text-sm mt-1">
          AI 시세·검색·분석 기능에 사용할 본인의 Gemini API 키를 입력합니다.
        </p>
      </div>

      <div className="px-6 py-4 space-y-4">
        {/* API 키 */}
        <div className="bg-gray-900 rounded-lg p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-white font-medium text-sm">내 Gemini API 키</span>
            <a
              href="https://aistudio.google.com/apikey"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-primary hover:underline"
            >
              키 발급받기 ↗
            </a>
          </div>
          <div className="flex items-center gap-2">
            <input
              type={showKey ? 'text' : 'password'}
              value={keyDraft}
              onChange={(e) => setKeyDraft(e.target.value)}
              placeholder="AIza..."
              autoComplete="off"
              className="flex-1 bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white text-sm font-mono"
            />
            <button
              onClick={() => setShowKey((v) => !v)}
              className="text-xs px-2 py-2 rounded bg-gray-700 text-gray-300 hover:bg-gray-600 transition"
            >
              {showKey ? '숨김' : '표시'}
            </button>
            <button
              onClick={handleSaveKey}
              className="text-sm px-3 py-2 rounded bg-primary text-white hover:opacity-90 transition"
            >
              저장
            </button>
          </div>
          <p className="text-gray-500 text-xs">
            🔒 이 키는 <b>이 브라우저(localStorage)에만</b> 저장됩니다. 서버 전송·Google Drive 동기화·깃 업로드에 포함되지 않습니다.
          </p>
        </div>

        {/* 모델 선택 */}
        <div className="bg-gray-900 rounded-lg p-4 space-y-2">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0">
              <span className="text-white font-medium text-sm">사용 모델</span>
              <p className="text-gray-400 text-xs mt-0.5">
                입력한 키로 조회한 실제 사용 가능한 모델 중에서 선택합니다.
                <br />
                ※ 시세·종목검색은 Google Search 그라운딩을 사용하므로 이를 지원하는 모델(Flash/Pro 등)을 권장합니다.
              </p>
            </div>
            <button
              onClick={() => loadModels(savedKey)}
              disabled={!savedKey || loadingModels}
              className="text-xs px-2 py-1 rounded bg-gray-700 text-gray-300 hover:bg-gray-600 transition disabled:opacity-40"
            >
              {loadingModels ? '불러오는 중...' : '모델 새로고침'}
            </button>
          </div>

          {models.length > 0 ? (
            <select
              value={model}
              onChange={(e) => handleModelChange(e.target.value)}
              className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white text-sm"
            >
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName} ({m.id})
                </option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={model}
              onChange={(e) => handleModelChange(e.target.value)}
              placeholder={DEFAULT_GEMINI_MODEL}
              className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white text-sm font-mono"
            />
          )}
          <div className="text-xs text-gray-500">
            현재 선택: <span className="font-mono text-gray-300">{model}</span>
          </div>
        </div>

        {status && <div className="text-xs text-gray-400">{status}</div>}
      </div>
    </div>
  );
};

export default AiSettingsSection;
