import React, { useEffect, useState } from 'react';
import { WorkforceCategory } from '../../../../types';
import { databaseService } from '../../../../lib/databaseService';
import { Tags, PlusCircle, AlertTriangle, Lock } from 'lucide-react';

interface CategoryManagerPanelProps {
  tenantId: string;
  adminCode: string;
}

// Standalone panel for the org-defined workforce category vocabulary
// (migration 39) — same pattern as migration 36's org_groups, applied to
// `workforce.category` ('Registrar' / 'Senior Registrar' / 'Medical
// Officer' today, previously a hardcoded global 3-value union). Mirrors
// RoleDelegationPanel.tsx's "Create a Custom Group" sub-form visual style,
// simplified since there's no delegation list here — just category CRUD.
//
// Wired into ChiefDashboardView.tsx's "Categories" tab. Rewiring the
// existing workforce registry / CSV export / role-delegation forms to read
// `category_id` instead of (or alongside) the free-text `category` column
// is still a followup — this panel only manages the vocabulary itself.
export const CategoryManagerPanel: React.FC<CategoryManagerPanelProps> = ({ tenantId, adminCode }) => {
  const [categories, setCategories] = useState<WorkforceCategory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [newCategoryKey, setNewCategoryKey] = useState('');
  const [newCategoryLabel, setNewCategoryLabel] = useState('');
  const [newCategoryDescription, setNewCategoryDescription] = useState('');
  const [newCategoryError, setNewCategoryError] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState('');

  const loadCategories = async () => {
    setIsLoading(true);
    setLoadError('');
    try {
      const data = await databaseService.listWorkforceCategories(tenantId);
      setCategories(data);
    } catch (err) {
      console.warn('Failed to load workforce categories:', err);
      setLoadError('Could not load categories. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (tenantId) {
      loadCategories();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  const handleCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    setNewCategoryError('');

    if (!newCategoryKey.trim() || !newCategoryLabel.trim()) {
      setNewCategoryError('Category key and label are required.');
      return;
    }

    setIsCreating(true);
    try {
      await databaseService.createWorkforceCategory(
        adminCode,
        newCategoryKey.trim(),
        newCategoryLabel.trim(),
        newCategoryDescription.trim()
      );
      setNewCategoryKey('');
      setNewCategoryLabel('');
      setNewCategoryDescription('');
      await loadCategories();
    } catch (err: any) {
      setNewCategoryError(err?.message || 'Failed to create category.');
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeleteCategory = async (category: WorkforceCategory) => {
    if (category.is_system_default) return;
    setDeleteError('');
    setDeletingId(category.id);
    try {
      await databaseService.deleteWorkforceCategory(adminCode, category.id);
      await loadCategories();
    } catch (err: any) {
      setDeleteError(err?.message || 'Failed to delete category.');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* List of categories */}
      <div className="lg:col-span-2 bg-white border border-slate-200 rounded-2xl shadow-sm p-4 sm:p-6 space-y-4">
        <div className="pb-3 border-b border-slate-100 flex items-center space-x-2">
          <Tags className="text-slate-500" size={16} />
          <h3 className="font-bold text-slate-800 text-sm md:text-base">Workforce Categories ({categories.length})</h3>
        </div>

        {loadError && (
          <div className="bg-rose-50 border border-rose-200 text-rose-800 p-2.5 rounded-lg text-xs flex items-center space-x-1">
            <AlertTriangle size={12} />
            <span>{loadError}</span>
          </div>
        )}
        {deleteError && (
          <div className="bg-rose-50 border border-rose-200 text-rose-800 p-2.5 rounded-lg text-xs flex items-center space-x-1">
            <AlertTriangle size={12} />
            <span>{deleteError}</span>
          </div>
        )}

        {isLoading ? (
          <div className="text-center py-8 text-slate-400 text-sm">Loading categories...</div>
        ) : categories.length === 0 ? (
          <div className="text-center py-8 text-slate-400 text-sm">No categories yet.</div>
        ) : (
          <div className="space-y-2">
            {categories.map(category => (
              <div key={category.id} className="p-3 rounded-xl border border-slate-200 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center space-x-2">
                    <span className="font-bold text-slate-900 text-sm truncate">{category.label}</span>
                    {category.is_system_default && (
                      <span className="px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider bg-slate-50 text-slate-600 border border-slate-200 flex items-center gap-1">
                        <Lock size={9} /> Built-in
                      </span>
                    )}
                  </div>
                  {category.description && (
                    <div className="text-[10px] text-slate-500 mt-0.5 truncate">{category.description}</div>
                  )}
                </div>
                {!category.is_system_default && (
                  <button
                    onClick={() => handleDeleteCategory(category)}
                    disabled={deletingId === category.id}
                    className="shrink-0 px-2.5 py-1 rounded-md text-[10px] font-bold border border-rose-200 text-rose-700 bg-rose-50 hover:bg-rose-100 disabled:opacity-50 transition cursor-pointer"
                  >
                    {deletingId === category.id ? 'Deleting...' : 'Delete'}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create a custom category */}
      <div className="space-y-6">
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 space-y-4">
          <div className="pb-2 border-b border-slate-100 flex items-center space-x-2">
            <PlusCircle size={16} className="text-slate-500" />
            <h4 className="font-bold text-slate-800 text-xs sm:text-sm">Create a Custom Category</h4>
          </div>
          <p className="text-[10px] text-slate-400 leading-relaxed">
            Your organization's own grade/category vocabulary — not limited to the 3 built-in defaults. Name it
            however your structure works (e.g. "Associate", "Junior Tech", "Senior Tech").
          </p>

          {newCategoryError && (
            <div className="bg-rose-50 border border-rose-200 text-rose-800 p-2.5 rounded-lg text-xs flex items-center space-x-1">
              <AlertTriangle size={12} />
              <span>{newCategoryError}</span>
            </div>
          )}

          <form onSubmit={handleCreateCategory} className="space-y-3 text-xs sm:text-sm">
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700 uppercase">Category Key</label>
              <input
                type="text"
                value={newCategoryKey}
                onChange={(e) => setNewCategoryKey(e.target.value.toLowerCase())}
                placeholder="e.g. junior_tech"
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm font-medium focus:outline-none focus:ring-1 focus:ring-slate-950"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700 uppercase">Label</label>
              <input
                type="text"
                value={newCategoryLabel}
                onChange={(e) => setNewCategoryLabel(e.target.value)}
                placeholder="e.g. Junior Tech"
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm font-medium focus:outline-none focus:ring-1 focus:ring-slate-950"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700 uppercase">Description (optional)</label>
              <input
                type="text"
                value={newCategoryDescription}
                onChange={(e) => setNewCategoryDescription(e.target.value)}
                placeholder="What this category is for"
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm font-medium focus:outline-none focus:ring-1 focus:ring-slate-950"
              />
            </div>

            <button
              type="submit"
              disabled={isCreating}
              className="w-full py-2.5 bg-white border border-slate-300 hover:bg-slate-50 disabled:bg-slate-100 text-slate-800 font-bold rounded-xl text-xs shadow-sm transition transform active:scale-95 cursor-pointer"
            >
              {isCreating ? 'Creating...' : 'Create Category'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
