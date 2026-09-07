import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  containsUnsafeCoordinationMetadata,
  projectTeamCoordination,
  TEAM_COORDINATION_ROUTES,
} from '../src/modules/announcements/lib/teamCoordination';
import type { Announcement } from '../src/types';
import type { Meeting, MeetingSeries } from '../src/modules/meetings/lib/meetingsService';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const announcement = (overrides: Partial<Announcement>): Announcement => ({
  id: 'announcement',
  title: 'Monthly roster update',
  body: 'Roster has been published',
  category: 'Roster',
  pinned: false,
  created_by: null,
  created_by_workforce_id: null,
  created_at: '2026-09-01T10:00:00.000Z',
  updated_at: '2026-09-01T10:00:00.000Z',
  ...overrides,
});

const series = (overrides: Partial<MeetingSeries>): MeetingSeries => ({
  id: 'series-current',
  tenant_id: 'tenant-current',
  doctor_id: null,
  name: 'Monthly team meeting',
  description: null,
  agenda_template: { items: [] },
  is_system_default: false,
  created_by_workforce_id: null,
  created_at: '2026-09-01T10:00:00.000Z',
  ...overrides,
});

const meeting = (overrides: Partial<Meeting>): Meeting => ({
  id: 'meeting-current',
  meeting_series_id: 'series-current',
  tenant_id: 'tenant-current',
  doctor_id: null,
  title: 'September coordination',
  scheduled_at: '2026-09-10T10:00:00.000Z',
  agenda: { items: [] },
  minutes: null,
  status: 'scheduled',
  created_at: '2026-09-01T10:00:00.000Z',
  ...overrides,
});

const memberProjection = projectTeamCoordination({
  announcements: [
    announcement({ id: 'regular', created_at: '2026-09-01T10:00:00.000Z' }),
    announcement({ id: 'pinned-unread', category: 'Exam', pinned: true, created_at: '2026-09-02T10:00:00.000Z' }),
    announcement({ id: 'unsafe', title: 'Patient update https://example.com/private', created_at: '2026-09-03T10:00:00.000Z' }),
  ],
  readAnnouncementIds: new Set(['regular']),
  meetingSeries: [series({})],
  meetingsBySeriesId: {
    'series-current': [
      meeting({ id: 'future-meeting', scheduled_at: '2026-09-10T10:00:00.000Z' }),
      meeting({ id: 'past-meeting', scheduled_at: '2026-09-01T10:00:00.000Z' }),
      meeting({ id: 'completed-meeting', scheduled_at: '2026-09-12T10:00:00.000Z', status: 'completed' }),
    ],
  },
  nowIso: '2026-09-07T10:00:00.000Z',
  role: 'member',
});

assert(memberProjection.activeAnnouncements.map((item) => item.id).join(',') === 'pinned-unread,unsafe,regular', 'orders pinned first then newest');
assert(memberProjection.activeAnnouncements.find((item) => item.id === 'unsafe')?.title === 'Announcement', 'sanitizes unsafe announcement titles');
assert(memberProjection.upcomingMeetings.map((item) => item.id).join(',') === 'future-meeting', 'shows only future scheduled meetings');
assert(memberProjection.upcomingMeetings[0].hasExternalLink === false, 'does not invent meeting links');
assert(memberProjection.nextActionKind === 'announcement', 'prioritizes unread pinned announcements');
assert(memberProjection.nextActionId === 'pinned-unread', 'targets pinned unread announcement');
assert(memberProjection.nextActionLabel === 'View pinned Exam announcement', 'derives deterministic member next action');
assert(memberProjection.lifecycleNote.includes('Scheduled, expired, archived, and draft announcement lifecycles are not modeled'), 'states unsupported lifecycle honestly');
assert(memberProjection.meetingLimitation?.includes('No persisted meeting location/link field exists yet'), 'states meeting link/location limitation');

const meetingOnlyProjection = projectTeamCoordination({
  announcements: [],
  meetingSeries: [series({})],
  meetingsBySeriesId: { 'series-current': [meeting({ id: 'next-meeting' })] },
  nowIso: '2026-09-07T10:00:00.000Z',
  role: 'member',
});
assert(meetingOnlyProjection.nextActionKind === 'meeting', 'prioritizes next meeting when no announcements exist');
assert(meetingOnlyProjection.nextActionLabel === 'View next scheduled meeting', 'derives meeting action from structured status/date');

const emptyProjection = projectTeamCoordination({
  announcements: [],
  meetingSeries: [],
  meetingsBySeriesId: {},
  nowIso: '2026-09-07T10:00:00.000Z',
  role: 'member',
});
assert(emptyProjection.emptyStateLabel === 'No current announcements or scheduled meetings are visible for this tenant.', 'has honest empty state');
assert(emptyProjection.nextActionKind === 'none', 'empty member state has no fake action');

const adminProjection = projectTeamCoordination({
  announcements: [],
  meetingSeries: [],
  meetingsBySeriesId: {},
  nowIso: '2026-09-07T10:00:00.000Z',
  role: 'admin',
});
assert(adminProjection.nextActionLabel === 'Create announcement', 'admin empty state uses existing create action');

assert(containsUnsafeCoordinationMetadata('participant contact list'), 'detects participant/contact-list data');
assert(containsUnsafeCoordinationMetadata('https://example.com/private'), 'detects private URL-shaped data');

assert(TEAM_COORDINATION_ROUTES.member === '/workspace/announcements', 'member route is real');
assert(TEAM_COORDINATION_ROUTES.adminAnnouncements === '/chief/dashboard', 'admin announcements route is real');
assert(TEAM_COORDINATION_ROUTES.fullRoster === '/workspace/full-roster', 'full roster route is real');

const board = readFileSync(resolve(process.cwd(), 'src/modules/announcements/components/AnnouncementBoardView.tsx'), 'utf8');
assert(board.includes('databaseService.getAnnouncements(tenantId)'), 'member announcements are tenant-scoped');
assert(board.includes('databaseService.getAnnouncementReadsForWorkforce(resident.id)'), 'read receipts remain persisted');
assert(board.includes('listMeetingSeries({ tenantId })'), 'member meetings use tenant-scoped meeting series');
assert(!board.includes('localStorage'), 'member board does not use localStorage authority');
assert(!board.includes('service_role'), 'member board does not use browser service-role access');

const admin = readFileSync(resolve(process.cwd(), 'src/modules/org-admin/components/dashboard/AnnouncementsAdminPanel.tsx'), 'utf8');
assert(admin.includes('handleCreateAnnouncement') && admin.includes('handleToggleAnnouncementPin'), 'admin keeps existing create/manage actions');
assert(!admin.includes('localStorage') && !admin.includes('service_role'), 'admin panel does not add storage or service role authority');

const app = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');
assert(app.includes('currentResident ?') && app.includes('<AnnouncementBoardView resident={currentResident}'), 'ordinary member route does not receive admin controls');
const chiefDashboard = readFileSync(resolve(process.cwd(), 'src/modules/org-admin/components/ChiefDashboardView.tsx'), 'utf8');
assert(chiefDashboard.includes('<AnnouncementsAdminPanel') && chiefDashboard.includes("activeTab === 'announcements'"), 'admin controls remain on chief dashboard only');

for (const file of [
  'src/modules/announcements/lib/teamCoordination.ts',
  'src/modules/announcements/components/AnnouncementBoardView.tsx',
  'src/modules/org-admin/components/dashboard/AnnouncementsAdminPanel.tsx',
].map((relative) => resolve(process.cwd(), relative))) {
  const contents = readFileSync(file, 'utf8');
  assert(!/Olanipekun|Federal Secretariat Clinic|Ikolaba|UCH|Family Medicine|Chief Resident|9jaclinic|tenant_id\s*[:=]\s*['"][^'"]+|workforce_id\s*[:=]\s*['"][^'"]+|SUPABASE_SERVICE|gapi|googleapis|drive\.files|docs\.documents|localStorage/i.test(contents), `${file} must not hardcode people/tenants or add browser storage/Drive/service-role surfaces`);
}

console.log('team coordination v1 verifier passed');
