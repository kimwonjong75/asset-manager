import React, { useState, useEffect, useMemo, useRef } from 'react';
import { WatchlistItem, normalizeExchange } from '../types';
import { getAllowedCategories, inferCategoryIdFromExchange } from '../types/category';
import { searchSymbols } from '../services/symbolListService';
import { usePortfolio } from '../contexts/PortfolioContext';
import { useConfirm } from '../hooks/useConfirm';
import ConfirmDialog from './common/ConfirmDialog';
import Modal from './common/Modal';
import Button from './common/Button';
import { Trash2 } from 'lucide-react';

const WatchlistEditModal: React.FC = () => {
  const { modal, actions, data } = usePortfolio();
  const categories = data.categoryStore.categories;
  const item = modal.editingWatchItem;
  const isOpen = !!item;
  const onClose = actions.closeEditWatchItem;
  const { confirm, confirmRequest } = useConfirm();

  const [ticker, setTicker] = useState('');
  const [exchange, setExchange] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState<number>(2);
  const [notes, setNotes] = useState('');

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<{ ticker: string; name: string; exchange: string }[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const initialRef = useRef({ ticker: '', name: '', category: 0, notes: '' });

  useEffect(() => {
    if (item) {
      setTicker(item.ticker);
      setExchange(item.exchange);
      setName(item.name);
      setCategory(item.categoryId);
      setNotes(item.notes || '');
      setSearchQuery('');
      setSearchResults([]);
      initialRef.current = {
        ticker: item.ticker,
        name: item.name,
        category: item.categoryId,
        notes: item.notes || '',
      };
    }
  }, [item]);

  const isDirty = useMemo(() => (
    ticker !== initialRef.current.ticker ||
    name !== initialRef.current.name ||
    category !== initialRef.current.category ||
    notes !== initialRef.current.notes
  ), [ticker, name, category, notes]);

  const handleClose = () => {
    if (!isDirty) { onClose(); return; }
    void confirm('변경사항이 저장되지 않습니다. 닫으시겠습니까?').then(ok => {
      if (ok) onClose();
    });
  };

  if (!isOpen || !item) return null;

  const handleSearchChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const q = e.target.value;
    setSearchQuery(q);
    if (!q || q.length < 2) {
      setSearchResults([]);
      return;
    }
    setIsSearching(true);
    try {
      const results = await searchSymbols(q);
      setSearchResults(results);
    } catch {
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  const applySymbol = async (r: { ticker: string; name: string; exchange: string }) => {
    const ex = normalizeExchange(r.exchange);
    const catId = inferCategoryIdFromExchange(ex, categories);
    const ok = await confirm(`티커를 '${ticker || '(비어있음)'}'에서 '${r.ticker}'로 변경하시겠습니까?`);
    if (ok) {
      setTicker(r.ticker);
      setName(r.name);
      setExchange(ex);
      setCategory(catId);
    }
    setSearchQuery('');
    setSearchResults([]);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ticker || !name) return;

    const updated: WatchlistItem = {
      ...item,
      ticker,
      exchange,
      name,
      categoryId: category,
      notes: notes || undefined,
    };
    actions.updateWatchItem(updated);
    onClose();
  };

  const handleDelete = async () => {
    const ok = await confirm(`'${item.name}' 종목을 관심종목에서 삭제하시겠습니까?`, {
      title: '관심종목 삭제', confirmLabel: '삭제', tone: 'danger',
    });
    if (ok) {
      actions.deleteWatchItem(item.id);
      onClose();
    }
  };

  const inputClasses = "w-full bg-gray-700 border border-gray-600 rounded-md py-2 px-3 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition";
  const labelClasses = "block text-sm font-medium text-gray-300 mb-1";

  return (
    <>
    {/* 모달 닫기 보호(RULES.md §8): Esc·백드롭·X 모두 dirty 확인 래퍼 handleClose */}
    <Modal
      open={isOpen}
      onClose={handleClose}
      title={`관심종목 수정: ${item.name}`}
      size="md"
      footer={
        <>
          <Button variant="danger" icon={<Trash2 />} onClick={handleDelete} className="mr-auto">삭제</Button>
          <Button variant="secondary" onClick={handleClose}>취소</Button>
          <Button type="submit" form="watchlist-edit-form" variant="primary">저장</Button>
        </>
      }
    >
        <form id="watchlist-edit-form" onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className={labelClasses}>자산 구분</label>
            <select value={category} onChange={(e) => setCategory(Number(e.target.value))} className={inputClasses}>
              {getAllowedCategories(categories).map((cat) => (
                <option key={cat.id} value={cat.id}>{cat.name}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClasses}>거래소/시장</label>
              <input value={exchange} readOnly className="w-full bg-gray-600 border border-gray-500 rounded-md py-2 px-3 text-gray-300 cursor-not-allowed" />
            </div>
            <div>
              <label className={labelClasses}>티커 (종목코드)</label>
              <input type="text" value={ticker} onChange={(e) => setTicker(e.target.value)} className={inputClasses} required />
              <div className="mt-2">
                <label className={labelClasses}>티커/종목 검색</label>
                <input type="text" value={searchQuery} onChange={handleSearchChange} placeholder="예: AAPL 또는 회사명" className={inputClasses} />
                {isSearching && <p className="text-xs text-gray-400 mt-1">검색 중...</p>}
                {searchResults.length > 0 && (
                  <ul className="mt-1 bg-gray-700 border border-gray-600 rounded-md max-h-40 overflow-y-auto">
                    {searchResults.map((r) => (
                      <li key={`${r.ticker}-${r.exchange}`} className="px-3 py-2 cursor-pointer hover:bg-gray-600" onMouseDown={() => applySymbol(r)}>
                        <div className="text-white font-semibold">{r.name} ({r.ticker})</div>
                        <div className="text-xs text-gray-300">{r.exchange}</div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
          <div>
            <label className={labelClasses}>메모</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClasses} rows={2} placeholder="종목에 대한 메모..." />
          </div>

        </form>
    </Modal>
    {confirmRequest && <ConfirmDialog {...confirmRequest} />}
    </>
  );
};

export default WatchlistEditModal;
