import React, { useState, useRef, useCallback } from 'react';
import { Currency, BulkUploadResult } from '../types';
import { usePortfolio } from '../contexts/PortfolioContext';
import { getAllowedCategories, EXCHANGE_MAP_BY_BASE_TYPE, BASE_TYPE_LABELS } from '../types/category';

const BulkUploadModal: React.FC = () => {
  const { modal, actions, data } = usePortfolio();
  const categories = data.categoryStore.categories;
  const allowedCats = getAllowedCategories(categories);
  const isOpen = modal.bulkUploadOpen;
  const onClose = actions.closeBulkUpload;
  const onFileUpload = actions.uploadCsv;
  const [view, setView] = useState<'instructions' | 'loading' | 'results'>('instructions');
  const [result, setResult] = useState<BulkUploadResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const resetModal = useCallback(() => {
    setView('instructions');
    setResult(null);
    onClose();
  }, [onClose]);

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setView('loading');
    try {
      const uploadResult = await onFileUpload(file);
      setResult(uploadResult);
      setView('results');
    } catch (e: unknown) {
       const reason = e instanceof Error ? e.message : '알 수 없는 오류';
       setResult({ successCount: 0, failedCount: 0, errors: [{ ticker: '파일 처리 오류', reason }] });
       setView('results');
    }
    
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleDownloadTemplate = () => {
    const csvHeader = "ticker,exchange,quantity,purchasePrice,purchaseDate,category,currency\n";
    const csvExample = `AAPL,NASDAQ,10,150,2023-01-15,미국주식,${Currency.USD}\n005930,"KRX (코스피/코스닥)",20,70000,2023-03-22,한국주식,${Currency.KRW}\n`;
    const csvContent = csvHeader + csvExample;
    const blob = new Blob([`\uFEFF${csvContent}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'portfolio_template.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };
  
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-70 flex justify-center items-center z-50" onClick={resetModal} role="dialog" aria-modal="true">
      <div className="bg-gray-800 p-6 rounded-lg shadow-xl w-full max-w-3xl" onClick={(e) => e.stopPropagation()}>
        {view === 'instructions' && (
          <div>
            <h2 className="text-2xl font-bold text-white mb-4">CSV 일괄 등록</h2>
            <p className="text-gray-400 mb-4">CSV 파일을 사용하여 여러 자산을 한 번에 등록할 수 있습니다. 아래 형식을 준수해주세요.</p>
            <div className="bg-gray-900 p-4 rounded-md mb-4">
              <p className="text-sm text-gray-300 font-mono">ticker,exchange,quantity,purchasePrice,purchaseDate,category,currency</p>
              <p className="text-sm text-gray-500 font-mono mt-2">AAPL,NASDAQ,10,150.00,2023-01-15,미국주식,USD</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                <div className="text-sm text-gray-400 space-y-2">
                    <p><strong className="text-gray-200">필수 헤더:</strong> <code>ticker, exchange, quantity, purchasePrice, purchaseDate, category, currency</code> 순서로 작성해야 합니다.</p>
                    <p><strong className="text-gray-200">category 값:</strong> <code>{allowedCats.map(c => c.name).join(', ')}</code> 중 하나여야 합니다.</p>
                    <p><strong className="text-gray-200">currency 값:</strong> <code>{Object.values(Currency).join(', ')}</code> 중 하나여야 합니다.</p>
                </div>
                <div className="text-sm">
                    <strong className="text-gray-200">사용 가능한 Exchange 값:</strong>
                    <div className="max-h-32 overflow-y-auto bg-gray-900 p-2 mt-1 rounded-md text-gray-400 text-xs">
                        {Object.entries(EXCHANGE_MAP_BY_BASE_TYPE).map(([baseType, exchanges]) => (
                            <div key={baseType} className="mb-1">
                                <span className="font-semibold text-gray-300">{BASE_TYPE_LABELS[baseType as keyof typeof BASE_TYPE_LABELS]}:</span>
                                <span className="font-mono ml-2">{exchanges.join(', ')}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            <input type="file" ref={fileInputRef} onChange={handleFileSelect} accept=".csv,text/csv" className="hidden" />
            <div className="flex justify-between items-center mt-8">
              <button onClick={handleDownloadTemplate} className="text-primary hover:text-primary-light transition font-medium">양식 다운로드</button>
              <div className="flex gap-4">
                 <button onClick={resetModal} className="bg-gray-600 hover:bg-gray-500 text-white font-medium py-2 px-4 rounded-md transition duration-300">취소</button>
                 <button onClick={handleUploadClick} className="bg-primary hover:bg-primary-dark text-white font-bold py-2 px-4 rounded-md transition duration-300">파일 선택하여 업로드</button>
              </div>
            </div>
          </div>
        )}
        {view === 'loading' && (
          <div className="flex flex-col items-center justify-center p-8 h-64">
            <svg className="animate-spin h-10 w-10 text-white mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <p className="text-xl text-white">자산 정보를 처리 중입니다...</p>
            <p className="text-gray-400 mt-2">등록할 자산 수에 따라 몇 분 정도 소요될 수 있습니다.</p>
          </div>
        )}
        {view === 'results' && result && (
          <div>
            <h2 className="text-2xl font-bold text-white mb-4">일괄 등록 결과</h2>
            <div className="flex gap-4 mb-4 text-center">
               <div className="bg-success/20 text-success p-4 rounded-lg flex-1">
                    <p className="text-sm">성공</p>
                    <p className="text-3xl font-bold">{result.successCount}</p>
               </div>
               <div className="bg-danger/20 text-danger p-4 rounded-lg flex-1">
                    <p className="text-sm">실패</p>
                    <p className="text-3xl font-bold">{result.failedCount}</p>
               </div>
            </div>
            {result.errors.length > 0 && (
                <div className="mt-4">
                    <h3 className="text-lg font-semibold text-white mb-2">실패 내역</h3>
                    <div className="max-h-48 overflow-y-auto bg-gray-900 p-3 rounded-md">
                        <ul className="space-y-2 text-sm">
                            {result.errors.map((err, index) => (
                                <li key={index} className="flex justify-between items-center p-2 rounded bg-gray-700">
                                    <span className="font-mono text-red-400 font-semibold">{err.ticker}</span>
                                    <span className="text-gray-300 text-right">{err.reason}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                </div>
            )}
            <div className="mt-8 flex justify-end">
                 <button onClick={resetModal} className="bg-primary hover:bg-primary-dark text-white font-bold py-2 px-4 rounded-md transition duration-300">확인</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default BulkUploadModal;
