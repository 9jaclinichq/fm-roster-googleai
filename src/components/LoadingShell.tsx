import React from 'react';
import { RefreshCw } from 'lucide-react';

// Suspense fallback shown while a lazy-loaded route chunk downloads.
export const LoadingShell: React.FC = () => (
  <div className="max-w-3xl mx-auto my-12 p-8 text-center bg-white border border-slate-200 rounded-2xl shadow-sm">
    <RefreshCw size={32} className="text-slate-500 animate-spin mx-auto mb-3" />
    <p className="text-sm font-medium text-slate-600">Loading...</p>
  </div>
);
