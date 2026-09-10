export const TENANT_VOCABULARY_DEFAULTS: Record<string, string> = {
  org_name: 'Organisation',
  org_short_name: 'Organisation',
  tenant_type: 'Professional organisation',
  member: 'Member',
  members: 'Members',
  admin: 'Organisation Administrator',
  admin_dashboard: 'Organisation Dashboard',
  senior_reviewer: 'Reviewer',
  senior_reviewers: 'Reviewers',
  schedule: 'Schedule',
  assignment: 'Assignment',
  rotation: 'Assignment',
  submission: 'Work Submission',
  collection_cycle: 'Submission Cycle',
  professional_development: 'Professional Development',
  dissertation: 'Research Project',
  case_report: 'Case',
  viva: 'Assessment',
};

export const TENANT_SETUP_VOCABULARY_KEYS = [
  'org_name',
  'org_short_name',
  'tenant_type',
  'member',
  'members',
  'admin',
  'admin_dashboard',
  'schedule',
  'assignment',
  'submission',
  'collection_cycle',
  'professional_development',
] as const;

export type TenantSetupVocabularyKey = typeof TENANT_SETUP_VOCABULARY_KEYS[number];

export const TENANT_SETUP_LABELS: Record<TenantSetupVocabularyKey, string> = {
  org_name: 'Organisation display name',
  org_short_name: 'Organisation short name',
  tenant_type: 'Organisation type or profile',
  member: 'Member (singular)',
  members: 'Members (plural)',
  admin: 'Administrator role label',
  admin_dashboard: 'Administrator dashboard label',
  schedule: 'Schedule label',
  assignment: 'Assignment label',
  submission: 'Submission label',
  collection_cycle: 'Submission cycle label',
  professional_development: 'Professional development label',
};

export function resolveTenantVocabulary(
  overrides: Record<string, string> | null | undefined,
  key: string,
  fallback?: string,
): string {
  const configured = overrides?.[key]?.trim();
  return configured || fallback || TENANT_VOCABULARY_DEFAULTS[key] || key;
}

export function hasUnsafeTenantVocabularyMarkup(value: string): boolean {
  return /[<>\u0000-\u001f\u007f]/u.test(value);
}
