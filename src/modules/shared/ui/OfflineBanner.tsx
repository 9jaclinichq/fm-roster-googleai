import React, { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';

// Small, self-contained "you're offline" indicator — part of the PWA
// first-slice addition (see docs/PWA_ADDITION_SCOPING.md §2.2/§2.3/§7.2).
// This app has no offline data functionality of any kind
// (databaseService.isMock is hardcoded false, no local cache/write queue —
// see CLAUDE.md's Environment & Supabase Setup section), so an installed
// PWA opened with no network would otherwise show a normal-looking shell
// that silently fails every data call. This banner exists purely to make
// that state honest and visible — it does NOT imply or attempt any real
// offline capability.
export const OfflineBanner: React.FC = () => {
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  if (isOnline) return null;

  return (
    <div
      role="status"
      className="fixed bottom-0 inset-x-0 z-50 bg-amber-50 border-t border-amber-200 text-amber-800 text-xs font-semibold px-4 py-2 flex items-center justify-center gap-1.5 shadow-[0_-1px_4px_rgba(0,0,0,0.05)]"
    >
      <WifiOff size={13} className="text-amber-500 shrink-0" />
      <span>You're offline — reconnect to load your data.</span>
    </div>
  );
};
