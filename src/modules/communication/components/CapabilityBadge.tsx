import React from 'react';
import { ShieldCheck } from 'lucide-react';
import { CAPABILITY_BADGES, TenantCapability } from '../lib/communicationDomain';

interface CapabilityBadgeProps {
  capability: TenantCapability;
}

export const CapabilityBadge: React.FC<CapabilityBadgeProps> = ({ capability }) => {
  const badge = CAPABILITY_BADGES[capability];
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-700"
      title={badge.description}
      aria-label={`${badge.label}: ${badge.description}`}
    >
      <ShieldCheck size={11} aria-hidden="true" />
      {badge.label}
    </span>
  );
};
