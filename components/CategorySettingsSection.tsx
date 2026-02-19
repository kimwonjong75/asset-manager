import React, { useState } from 'react';
import { usePortfolio } from '../contexts/PortfolioContext';
import { CategoryBaseType, BASE_TYPE_LABELS, EXCHANGE_MAP_BY_BASE_TYPE } from '../types/category';

const ALL_BASE_TYPES: CategoryBaseType[] = [
  'KOREAN_STOCK', 'US_STOCK', 'FOREIGN_STOCK', 'OTHER_FOREIGN_STOCK',
  'KOREAN_BOND', 'US_BOND', 'PHYSICAL_ASSET', 'CRYPTOCURRENCY', 'CASH',
];

const CategorySettingsSection: React.FC = () => {
  const { data, actions } = usePortfolio();
  const categories = data.categoryStore.categories;

  // 인라인 이름 편집
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');

  // 새 카테고리 추가
  const [newName, setNewName] = useState('');
  const [newBaseType, setNewBaseType] = useState<CategoryBaseType>('OTHER_FOREIGN_STOCK');
  const [showAddForm, setShowAddForm] = useState(false);

  // 삭제 확인
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [reassignId, setReassignId] = useState<number | null>(null);

  const startEdit = (id: number, currentName: string) => {
    setEditingId(id);
    setEditName(currentName);
  };

  const saveEdit = () => {
    if (editingId === null || !editName.trim()) return;
    const duplicate = categories.find(c => c.id !== editingId && c.name === editName.trim());
    if (duplicate) {
      alert('이미 같은 이름의 카테고리가 있습니다.');
      return;
    }
    actions.renameCategory(editingId, editName.trim());
    setEditingId(null);
    setEditName('');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditName('');
  };

  const handleAdd = () => {
    if (!newName.trim()) return;
    const duplicate = categories.find(c => c.name === newName.trim());
    if (duplicate) {
      alert('이미 같은 이름의 카테고리가 있습니다.');
      return;
    }
    actions.addCategory(newName.trim(), newBaseType);
    setNewName('');
    setShowAddForm(false);
  };

  const startDelete = (id: number) => {
    setDeletingId(id);
    // 재할당 대상: 같은 baseType의 다른 카테고리, 없으면 첫 번째 카테고리
    const cat = categories.find(c => c.id === id);
    const sameBase = categories.find(c => c.id !== id && c.baseType === cat?.baseType);
    setReassignId(sameBase?.id ?? categories.find(c => c.id !== id)?.id ?? 1);
  };

  const confirmDelete = () => {
    if (deletingId === null || reassignId === null) return;
    const cat = categories.find(c => c.id === deletingId);
    const target = categories.find(c => c.id === reassignId);
    if (!window.confirm(
      `"${cat?.name}" 카테고리를 삭제하고, 소속 자산을 "${target?.name}"(으)로 이동하시겠습니까?`
    )) return;
    actions.deleteCategory(deletingId, reassignId);
    setDeletingId(null);
    setReassignId(null);
  };

  const cancelDelete = () => {
    setDeletingId(null);
    setReassignId(null);
  };

  const sorted = [...categories].sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <div className="bg-gray-800 rounded-lg shadow-lg">
      {/* 헤더 */}
      <div className="px-6 py-5 border-b border-gray-700 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">자산 카테고리 관리</h2>
          <p className="text-gray-400 text-sm mt-1">카테고리 이름을 변경하거나 새 카테고리를 추가합니다.</p>
        </div>
        {!showAddForm && (
          <button
            onClick={() => setShowAddForm(true)}
            className="text-sm px-3 py-1.5 bg-primary hover:bg-primary-dark text-white rounded-md transition"
          >
            + 추가
          </button>
        )}
      </div>

      <div className="px-6 py-4 space-y-3">
        {/* 새 카테고리 추가 폼 */}
        {showAddForm && (
          <div className="bg-gray-900 rounded-lg p-4 space-y-3">
            <div className="flex items-center gap-3">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="카테고리 이름"
                className="flex-1 bg-gray-700 border border-gray-600 rounded-md py-1.5 px-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                autoFocus
              />
              <select
                value={newBaseType}
                onChange={(e) => setNewBaseType(e.target.value as CategoryBaseType)}
                className="bg-gray-700 border border-gray-600 rounded-md py-1.5 px-2 text-white text-sm"
              >
                {ALL_BASE_TYPES.map(bt => (
                  <option key={bt} value={bt}>{BASE_TYPE_LABELS[bt]}</option>
                ))}
              </select>
            </div>
            <p className="text-xs text-gray-400">
              기본 유형: 거래소 매핑을 결정합니다. 예) {EXCHANGE_MAP_BY_BASE_TYPE[newBaseType].join(', ')}
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setShowAddForm(false); setNewName(''); }}
                className="text-sm px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-md transition"
              >
                취소
              </button>
              <button
                onClick={handleAdd}
                disabled={!newName.trim()}
                className="text-sm px-3 py-1.5 bg-primary hover:bg-primary-dark text-white rounded-md transition disabled:opacity-50"
              >
                추가
              </button>
            </div>
          </div>
        )}

        {/* 카테고리 목록 */}
        {sorted.map((cat) => (
          <div
            key={cat.id}
            className="flex items-center justify-between bg-gray-900 rounded-lg px-4 py-3"
          >
            <div className="flex items-center gap-3 flex-1 min-w-0">
              {editingId === cat.id ? (
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveEdit();
                    if (e.key === 'Escape') cancelEdit();
                  }}
                  className="bg-gray-700 border border-primary rounded-md py-1 px-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary w-40"
                  autoFocus
                />
              ) : (
                <span className="text-white text-sm font-medium truncate">{cat.name}</span>
              )}
              <span className="text-xs text-gray-500 flex-shrink-0">
                {BASE_TYPE_LABELS[cat.baseType]}
              </span>
              {cat.isDefault && (
                <span className="text-xs text-gray-600 flex-shrink-0">기본</span>
              )}
            </div>

            <div className="flex items-center gap-2 flex-shrink-0 ml-2">
              {/* 삭제 확인 모드 */}
              {deletingId === cat.id ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400">이동:</span>
                  <select
                    value={reassignId ?? ''}
                    onChange={(e) => setReassignId(Number(e.target.value))}
                    className="bg-gray-700 border border-gray-600 rounded py-1 px-1 text-white text-xs"
                  >
                    {categories.filter(c => c.id !== cat.id).map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                  <button
                    onClick={confirmDelete}
                    className="text-xs px-2 py-1 bg-red-600 hover:bg-red-500 text-white rounded transition"
                  >
                    확인
                  </button>
                  <button
                    onClick={cancelDelete}
                    className="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition"
                  >
                    취소
                  </button>
                </div>
              ) : editingId === cat.id ? (
                <>
                  <button
                    onClick={saveEdit}
                    className="text-xs px-2 py-1 bg-primary hover:bg-primary-dark text-white rounded transition"
                  >
                    저장
                  </button>
                  <button
                    onClick={cancelEdit}
                    className="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition"
                  >
                    취소
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => startEdit(cat.id, cat.name)}
                    className="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition"
                  >
                    이름변경
                  </button>
                  {!cat.isDefault && (
                    <button
                      onClick={() => startDelete(cat.id)}
                      className="text-xs px-2 py-1 bg-gray-700 hover:bg-red-600 text-gray-300 hover:text-white rounded transition"
                    >
                      삭제
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default CategorySettingsSection;
