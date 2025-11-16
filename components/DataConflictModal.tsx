import React from 'react';
import { Asset } from '../types';

interface ConflictAsset {
  ticker: string;
  exchange: string;
  name: string;
  localAsset: Asset;
  driveAsset: Asset;
}

interface DataConflictModalProps {
  isOpen: boolean;
  conflicts: ConflictAsset[];
  onSelectLocal: () => void;
  onSelectDrive: () => void;
}

const DataConflictModal: React.FC<DataConflictModalProps> = ({
  isOpen,
  conflicts,
  onSelectLocal,
  onSelectDrive,
}) => {
  if (!isOpen || conflicts.length === 0) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        <div className="p-6 border-b border-gray-700">
          <h2 className="text-2xl font-bold text-white mb-2">
            데이터 충돌 감지
          </h2>
          <p className="text-gray-400 text-sm">
            로컬 데이터와 Google Drive 데이터에 동일한 종목이 서로 다른 정보로 존재합니다.
            사용할 데이터를 선택해주세요.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <div className="space-y-4">
            {conflicts.map((conflict, index) => (
              <div
                key={index}
                className="bg-gray-700 rounded-lg p-4 border border-gray-600"
              >
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="text-lg font-semibold text-white">
                      {conflict.name}
                    </h3>
                    <p className="text-sm text-gray-400">
                      {conflict.ticker} ({conflict.exchange})
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* 로컬 데이터 */}
                  <div className="bg-gray-900 rounded p-3 border border-blue-500">
                    <div className="text-xs font-semibold text-blue-400 mb-2 uppercase">
                      로컬 데이터
                    </div>
                    <div className="space-y-1 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-400">수량:</span>
                        <span className="text-white">{conflict.localAsset.quantity}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">매수가:</span>
                        <span className="text-white">
                          {conflict.localAsset.purchasePrice.toLocaleString()}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">매수일:</span>
                        <span className="text-white">{conflict.localAsset.purchaseDate}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">현재가:</span>
                        <span className="text-white">
                          {conflict.localAsset.currentPrice.toLocaleString()}원
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Google Drive 데이터 */}
                  <div className="bg-gray-900 rounded p-3 border border-green-500">
                    <div className="text-xs font-semibold text-green-400 mb-2 uppercase">
                      Google Drive 데이터
                    </div>
                    <div className="space-y-1 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-400">수량:</span>
                        <span className="text-white">{conflict.driveAsset.quantity}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">매수가:</span>
                        <span className="text-white">
                          {conflict.driveAsset.purchasePrice.toLocaleString()}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">매수일:</span>
                        <span className="text-white">{conflict.driveAsset.purchaseDate}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">현재가:</span>
                        <span className="text-white">
                          {conflict.driveAsset.currentPrice.toLocaleString()}원
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="p-6 border-t border-gray-700 bg-gray-750">
          <div className="flex flex-col sm:flex-row gap-3 justify-end">
            <button
              onClick={onSelectLocal}
              className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-md transition duration-300 flex items-center justify-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
              </svg>
              로컬 데이터 사용
            </button>
            <button
              onClick={onSelectDrive}
              className="px-6 py-3 bg-green-600 hover:bg-green-700 text-white font-medium rounded-md transition duration-300 flex items-center justify-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
              </svg>
              Google Drive 데이터 사용
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DataConflictModal;

