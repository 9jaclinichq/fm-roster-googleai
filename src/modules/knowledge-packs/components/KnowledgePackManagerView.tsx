import React, { useState, useEffect } from 'react';
import { databaseService } from '../../../lib/databaseService';
import { KnowledgePack, KnowledgePackCategory, KnowledgePackItem } from '../../../types';
import {
  Library,
  Plus,
  ChevronDown,
  ChevronUp,
  FileText,
  UploadCloud,
  Search,
  RefreshCw,
  AlertTriangle,
} from 'lucide-react';

const CATEGORIES: { value: KnowledgePackCategory; label: string }[] = [
  { value: 'guidelines', label: 'Guidelines' },
  { value: 'templates', label: 'Templates' },
  { value: 'sample_dissertation', label: 'Sample Dissertations' },
  { value: 'past_questions', label: 'Past Questions' },
];

interface KnowledgePackManagerViewProps {
  tenantId: string;
}

export const KnowledgePackManagerView: React.FC<KnowledgePackManagerViewProps> = ({ tenantId }) => {
  const [packs, setPacks] = useState<KnowledgePack[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [expandedPackId, setExpandedPackId] = useState<string | null>(null);
  const [itemsByPack, setItemsByPack] = useState<Record<string, KnowledgePackItem[]>>({});

  // New pack form
  const [newPackTitle, setNewPackTitle] = useState('');
  const [newPackCategory, setNewPackCategory] = useState<KnowledgePackCategory>('guidelines');
  const [newPackDescription, setNewPackDescription] = useState('');
  const [newPackTags, setNewPackTags] = useState('');
  const [newPackFileUrl, setNewPackFileUrl] = useState('');
  const [packError, setPackError] = useState('');
  const [isCreatingPack, setIsCreatingPack] = useState(false);

  // New item form (per expanded pack)
  const [itemTitle, setItemTitle] = useState('');
  const [itemText, setItemText] = useState('');
  const [itemFile, setItemFile] = useState<File | null>(null);
  const [itemError, setItemError] = useState('');
  const [isAddingItem, setIsAddingItem] = useState(false);

  // Search demo
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<KnowledgePackItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  const load = () => {
    setIsLoading(true);
    databaseService.getKnowledgePacks(undefined, tenantId)
      .then(setPacks)
      .catch(err => console.warn('Failed to load knowledge packs:', err))
      .finally(() => setIsLoading(false));
  };

  useEffect(load, [tenantId]);

  const toggleExpand = async (packId: string) => {
    if (expandedPackId === packId) {
      setExpandedPackId(null);
      return;
    }
    setExpandedPackId(packId);
    setItemTitle('');
    setItemText('');
    setItemFile(null);
    setItemError('');
    if (!itemsByPack[packId]) {
      try {
        const items = await databaseService.getKnowledgePackItems(packId);
        setItemsByPack(prev => ({ ...prev, [packId]: items }));
      } catch (err) {
        console.warn('Failed to load pack items:', err);
      }
    }
  };

  const handleCreatePack = async (e: React.FormEvent) => {
    e.preventDefault();
    setPackError('');
    if (!newPackTitle.trim()) {
      setPackError('Title is required.');
      return;
    }
    if (!newPackFileUrl.trim()) {
      setPackError('A resource URL is required for the pack itself (e.g. a shared drive link).');
      return;
    }
    setIsCreatingPack(true);
    try {
      const created = await databaseService.createKnowledgePack({
        title: newPackTitle.trim(),
        category: newPackCategory,
        file_url: newPackFileUrl.trim(),
        description: newPackDescription.trim() || null,
        tags: newPackTags.split(',').map(t => t.trim()).filter(Boolean),
      }, tenantId);
      setPacks(prev => [created, ...prev]);
      setNewPackTitle('');
      setNewPackDescription('');
      setNewPackTags('');
      setNewPackFileUrl('');
    } catch (err) {
      console.warn(err);
      setPackError('Failed to create knowledge pack.');
    } finally {
      setIsCreatingPack(false);
    }
  };

  const handleAddItem = async (packId: string, e: React.FormEvent) => {
    e.preventDefault();
    setItemError('');
    if (!itemTitle.trim()) {
      setItemError('Item title is required.');
      return;
    }
    setIsAddingItem(true);
    try {
      let documentUrl: string | null = null;
      if (itemFile) {
        documentUrl = await databaseService.uploadKnowledgePackDocument(packId, itemFile);
      }
      const created = await databaseService.createKnowledgePackItem({
        pack_id: packId,
        title: itemTitle.trim(),
        document_url: documentUrl,
        extracted_text_content: itemText.trim() || null,
      });
      setItemsByPack(prev => ({ ...prev, [packId]: [created, ...(prev[packId] || [])] }));
      setItemTitle('');
      setItemText('');
      setItemFile(null);
    } catch (err) {
      console.warn(err);
      setItemError('Failed to add item.');
    } finally {
      setIsAddingItem(false);
    }
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    setHasSearched(true);
    try {
      const results = await databaseService.searchKnowledgePackItems(searchQuery.trim());
      setSearchResults(results);
    } catch (err) {
      console.warn(err);
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 space-y-4">
        <div className="flex items-center space-x-2">
          <Search className="text-slate-500" size={16} />
          <h3 className="font-bold text-slate-800 text-sm">Search Indexed Content</h3>
        </div>
        <p className="text-[10px] text-slate-400">
          Keyword search over item text you've pasted below — not AI-powered semantic search.
        </p>
        <form onSubmit={handleSearch} className="flex gap-2">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="e.g. ethical clearance, informed consent..."
            className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:ring-1 focus:ring-slate-950"
          />
          <button
            type="submit"
            disabled={isSearching}
            className="px-4 py-2 bg-slate-950 hover:bg-slate-900 text-white font-bold rounded-xl text-xs shadow-sm transition cursor-pointer"
          >
            {isSearching ? '...' : 'Search'}
          </button>
        </form>
        {hasSearched && (
          searchResults.length === 0 ? (
            <p className="text-xs text-slate-400">No matches found.</p>
          ) : (
            <div className="space-y-1.5">
              {searchResults.map(r => (
                <div key={r.id} className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs">
                  <div className="font-bold text-slate-800">{r.title}</div>
                  {r.extracted_text_content && (
                    <p className="text-slate-500 line-clamp-2 mt-0.5">{r.extracted_text_content}</p>
                  )}
                </div>
              ))}
            </div>
          )
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-2xl shadow-sm p-4 sm:p-6 space-y-3">
          <div className="pb-3 border-b border-slate-100 flex items-center space-x-2">
            <Library className="text-slate-500" size={16} />
            <h3 className="font-bold text-slate-800 text-sm md:text-base">Knowledge Packs ({packs.length})</h3>
          </div>

          {isLoading ? (
            <div className="text-center py-8"><RefreshCw size={20} className="text-slate-400 animate-spin mx-auto" /></div>
          ) : packs.length === 0 ? (
            <div className="text-center py-8 text-slate-400 text-sm">No knowledge packs yet.</div>
          ) : (
            <div className="space-y-2">
              {packs.map(pack => (
                <div key={pack.id} className="border border-slate-200 rounded-xl overflow-hidden">
                  <button
                    onClick={() => toggleExpand(pack.id)}
                    className="w-full flex items-center justify-between p-3 text-left cursor-pointer hover:bg-slate-50"
                  >
                    <div className="min-w-0">
                      <span className="inline-block px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider bg-blue-50 text-blue-700 border border-blue-200 mb-1">
                        {CATEGORIES.find(c => c.value === pack.category)?.label}
                      </span>
                      <div className="font-bold text-slate-900 text-sm truncate">{pack.title}</div>
                    </div>
                    {expandedPackId === pack.id ? <ChevronUp size={16} className="text-slate-400 shrink-0" /> : <ChevronDown size={16} className="text-slate-400 shrink-0" />}
                  </button>

                  {expandedPackId === pack.id && (
                    <div className="p-3 border-t border-slate-100 bg-slate-50/50 space-y-3">
                      {(itemsByPack[pack.id] || []).length === 0 ? (
                        <p className="text-xs text-slate-400">No items in this pack yet.</p>
                      ) : (
                        <div className="space-y-1.5">
                          {(itemsByPack[pack.id] || []).map(item => (
                            <div key={item.id} className="p-2.5 bg-white border border-slate-200 rounded-lg text-xs flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="font-bold text-slate-800 truncate">{item.title}</div>
                                {item.extracted_text_content && (
                                  <p className="text-slate-500 line-clamp-1 mt-0.5">{item.extracted_text_content}</p>
                                )}
                              </div>
                              {item.document_url && (
                                <a href={item.document_url} target="_blank" rel="noreferrer" className="shrink-0 text-slate-400 hover:text-slate-800">
                                  <FileText size={14} />
                                </a>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {itemError && (
                        <div className="bg-rose-50 border border-rose-200 text-rose-800 p-2 rounded-lg text-[10px] flex items-center space-x-1">
                          <AlertTriangle size={11} />
                          <span>{itemError}</span>
                        </div>
                      )}

                      <form onSubmit={(e) => handleAddItem(pack.id, e)} className="space-y-2 pt-2 border-t border-slate-200">
                        <input
                          type="text"
                          value={itemTitle}
                          onChange={(e) => setItemTitle(e.target.value)}
                          placeholder="Item title (e.g. Chapter 3: Ethical Clearance)"
                          className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-medium focus:outline-none focus:ring-1 focus:ring-slate-950"
                        />
                        <textarea
                          rows={2}
                          value={itemText}
                          onChange={(e) => setItemText(e.target.value)}
                          placeholder="Paste extracted text here for search indexing (optional but recommended — there's no automatic OCR/PDF text extraction)"
                          className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-medium focus:outline-none focus:ring-1 focus:ring-slate-950"
                        />
                        <label className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-white hover:bg-slate-100 border border-dashed border-slate-300 rounded-lg text-[10px] font-semibold text-slate-700 cursor-pointer transition">
                          <UploadCloud size={12} className="text-slate-400" />
                          <span>{itemFile ? itemFile.name : 'Attach document (optional)'}</span>
                          <input
                            type="file"
                            accept=".pdf,.doc,.docx,image/jpeg,image/png"
                            className="hidden"
                            onChange={(e) => setItemFile(e.target.files?.[0] || null)}
                          />
                        </label>
                        <button
                          type="submit"
                          disabled={isAddingItem}
                          className="w-full py-2 bg-slate-950 hover:bg-slate-900 disabled:bg-slate-400 text-white font-bold rounded-lg text-[10px] transition cursor-pointer"
                        >
                          {isAddingItem ? 'Adding...' : 'Add Item to Pack'}
                        </button>
                      </form>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 space-y-4">
          <div className="pb-2 border-b border-slate-100 flex items-center space-x-2">
            <Plus size={16} className="text-slate-500" />
            <h4 className="font-bold text-slate-800 text-xs sm:text-sm">New Knowledge Pack</h4>
          </div>

          {packError && (
            <div className="bg-rose-50 border border-rose-200 text-rose-800 p-2.5 rounded-lg text-xs flex items-center space-x-1">
              <AlertTriangle size={12} />
              <span>{packError}</span>
            </div>
          )}

          <form onSubmit={handleCreatePack} className="space-y-3 text-xs sm:text-sm">
            <input
              type="text"
              value={newPackTitle}
              onChange={(e) => setNewPackTitle(e.target.value)}
              placeholder="Pack title (e.g. Dissertation Writing Guidelines)"
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-1 focus:ring-slate-950"
            />
            <select
              value={newPackCategory}
              onChange={(e) => setNewPackCategory(e.target.value as KnowledgePackCategory)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm font-medium focus:outline-none focus:ring-1 focus:ring-slate-950 cursor-pointer"
            >
              {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
            <input
              type="text"
              value={newPackFileUrl}
              onChange={(e) => setNewPackFileUrl(e.target.value)}
              placeholder="Resource URL (shared drive link, etc.)"
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-1 focus:ring-slate-950"
            />
            <textarea
              rows={2}
              value={newPackDescription}
              onChange={(e) => setNewPackDescription(e.target.value)}
              placeholder="Description (optional)"
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-1 focus:ring-slate-950"
            />
            <input
              type="text"
              value={newPackTags}
              onChange={(e) => setNewPackTags(e.target.value)}
              placeholder="Tags, comma-separated"
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-1 focus:ring-slate-950"
            />
            <button
              type="submit"
              disabled={isCreatingPack}
              className="w-full py-2.5 bg-slate-950 hover:bg-slate-900 disabled:bg-slate-400 text-white font-bold rounded-xl text-xs shadow-sm transition cursor-pointer"
            >
              {isCreatingPack ? 'Creating...' : 'Create Pack'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
