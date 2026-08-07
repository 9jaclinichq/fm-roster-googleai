import React, { useState, useEffect, useMemo } from 'react';
import { databaseService } from '../lib/databaseService';
import { ActivityMatrixDay } from '../types';
import { Activity, RefreshCw } from 'lucide-react';

interface ResidentActivityGraphProps {
  workforceId: string;
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function intensityClass(count: number): string {
  if (count === 0) return 'bg-slate-100';
  if (count === 1) return 'bg-blue-200';
  if (count <= 3) return 'bg-blue-400';
  if (count <= 6) return 'bg-blue-600';
  return 'bg-blue-800';
}

function buildWeeks(days: ActivityMatrixDay[]): (ActivityMatrixDay | null)[][] {
  if (days.length === 0) return [];
  const firstDate = new Date(days[0].activity_date + 'T00:00:00Z');
  const firstDow = firstDate.getUTCDay(); // 0 = Sunday
  const padded: (ActivityMatrixDay | null)[] = [...Array(firstDow).fill(null), ...days];
  const weeks: (ActivityMatrixDay | null)[][] = [];
  for (let i = 0; i < padded.length; i += 7) {
    weeks.push(padded.slice(i, i + 7));
  }
  return weeks;
}

export const ResidentActivityGraph: React.FC<ResidentActivityGraphProps> = ({ workforceId }) => {
  const [days, setDays] = useState<ActivityMatrixDay[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    databaseService.getResidentActivityMatrix(workforceId)
      .then(setDays)
      .catch(err => console.warn('Failed to load activity matrix:', err))
      .finally(() => setIsLoading(false));
  }, [workforceId]);

  const weeks = useMemo(() => buildWeeks(days), [days]);
  const totalCount = useMemo(() => days.reduce((sum, d) => sum + d.activity_count, 0), [days]);

  const monthLabelForWeek = (week: (ActivityMatrixDay | null)[], weekIndex: number): string | null => {
    const firstRealDay = week.find(d => d !== null);
    if (!firstRealDay) return null;
    const date = new Date(firstRealDay.activity_date + 'T00:00:00Z');
    if (date.getUTCDate() > 7) return null; // only label the week a month starts in
    if (weekIndex === 0) return MONTH_LABELS[date.getUTCMonth()];
    return MONTH_LABELS[date.getUTCMonth()];
  };

  if (isLoading) {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 text-center">
        <RefreshCw size={20} className="text-slate-400 animate-spin mx-auto" />
      </div>
    );
  }

  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center space-x-2">
          <Activity className="text-slate-500" size={16} />
          <h3 className="font-bold text-slate-800 text-sm">Activity — Last 365 Days</h3>
        </div>
        <span className="text-xs text-slate-500 font-semibold">{totalCount} contribution{totalCount === 1 ? '' : 's'}</span>
      </div>

      <div className="overflow-x-auto">
        <div className="inline-flex gap-[3px]" style={{ minWidth: `${weeks.length * 13}px` }}>
          {weeks.map((week, wi) => (
            <div key={wi} className="flex flex-col gap-[3px] relative">
              {wi === 0 || monthLabelForWeek(week, wi) !== monthLabelForWeek(weeks[wi - 1] || [], wi - 1) ? (
                <span className="absolute -top-4 left-0 text-[9px] text-slate-400 font-semibold whitespace-nowrap">
                  {monthLabelForWeek(week, wi) || ''}
                </span>
              ) : null}
              {week.map((day, di) => (
                <div
                  key={di}
                  title={day ? `${day.activity_date}: ${day.activity_count} activit${day.activity_count === 1 ? 'y' : 'ies'}` : ''}
                  className={`h-[10px] w-[10px] rounded-sm ${day ? intensityClass(day.activity_count) : 'bg-transparent'}`}
                />
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-end space-x-1.5 mt-3">
        <span className="text-[9px] text-slate-400">Less</span>
        {[0, 1, 2, 4, 7].map(c => (
          <div key={c} className={`h-[10px] w-[10px] rounded-sm ${intensityClass(c)}`} />
        ))}
        <span className="text-[9px] text-slate-400">More</span>
      </div>
    </div>
  );
};
