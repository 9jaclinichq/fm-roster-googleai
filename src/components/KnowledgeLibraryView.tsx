import React, { useState, useEffect, useMemo } from 'react';
import { databaseService } from '../lib/databaseService';
import { KnowledgePack, KnowledgePackCategory } from '../types';
import { Library, Search, Download, RefreshCw, FileText, BookOpen, ClipboardCheck, FileQuestion } from 'lucide-react';

const CATEGORIES: { value: KnowledgePackCategory; label: string; icon: React.ReactNode }[] = [
  { value: 'guidelines', label: 'Guidelines', icon: <ClipboardCheck size={13} /> },
  { value: 'templates', label: 'Templates', icon: <FileText size={13} /> },
  { value: 'sample_dissertation', label: 'Sample Dissertations', icon: <BookOpen size={13} /> },
  { value: 'past_questions', label: 'Past Questions', icon: <FileQuestion size={13} /> },
];

export const KnowledgeLibraryView: React.FC = () => {
  const [packs, setPacks] = useState<KnowledgePack[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [categoryFilter, setCategoryFilter] = useState<KnowledgePackCategory | 'All'>('All');
  const [searchQuery, setSearchQuery] = useState<string>('');

  useEffect(() => {
    databaseService.getKnowledgePacks()
      .then(setPacks)
      .catch(err => console.warn('Failed to load knowledge packs:', err))
      .finally(() => setIsLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return packs.filter(p => {
      const matchesCategory = categoryFilter === 'All' || p.category === categoryFilter;
      const matchesSearch = !q || p.title.toLowerCase().includes(q) || (p.description || '').toLowerCase().includes(q) || p.tags.some(t => t.toLowerCase().includes(q));
      return matchesCategory && matchesSearch;
    });
  }, [packs, categoryFilter, searchQuery]);

  return (
    <div className="max-w-5xl mx-auto my-8 px-4 space-y-6">
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
        <div className="flex items-center space-x-2 mb-4">
          <Library className="text-slate-500" size={18} />
          <h2 className="font-bold text-slate-900 text-lg tracking-tight">Knowledge Library</h2>
        </div>

        <div className="relative mb-3">
          <Search size={14} className="text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search resources..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-500"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setCategoryFilter('All')}
            className={`px-3 py-1 rounded-full text-xs font-bold border transition cursor-pointer ${
              categoryFilter === 'All' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
            }`}
          >
            All
          </button>
          {CATEGORIES.map(cat => (
            <button
              key={cat.value}
              onClick={() => setCategoryFilter(cat.value)}
              className={`inline-flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs font-bold border transition cursor-pointer ${
                categoryFilter === cat.value ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              {cat.icon}
              <span>{cat.label}</span>
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-12 bg-white border border-slate-200 rounded-2xl">
          <RefreshCw size={28} className="text-slate-400 animate-spin mx-auto mb-2" />
          <p className="text-sm text-slate-500">Loading resources...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 bg-white border border-slate-200 rounded-2xl text-slate-400">
          <Library size={28} className="mx-auto mb-2" />
          <p className="text-sm font-medium">
            {packs.length === 0 ? 'No resources have been added to the library yet.' : 'No resources match your filters.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(pack => (
            <div key={pack.id} className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 flex flex-col justify-between space-y-3">
              <div>
                <span className="inline-block px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider bg-blue-50 text-blue-700 border border-blue-200">
                  {CATEGORIES.find(c => c.value === pack.category)?.label || pack.category}
                </span>
                <h3 className="font-bold text-slate-900 text-sm mt-2">{pack.title}</h3>
                {pack.description && <p className="text-xs text-slate-500 mt-1 line-clamp-3">{pack.description}</p>}
                {pack.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {pack.tags.map(tag => (
                      <span key={tag} className="text-[9px] font-semibold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                        #{tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <a
                href={pack.file_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center justify-center space-x-1.5 px-3 py-2 bg-slate-950 hover:bg-slate-900 text-white rounded-xl text-xs font-bold shadow-sm transition cursor-pointer"
              >
                <Download size={13} />
                <span>Download</span>
              </a>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
