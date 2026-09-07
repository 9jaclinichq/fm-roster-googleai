import type { Announcement } from '../../../types';
import type { Meeting, MeetingSeries } from '../../meetings/lib/meetingsService';

export const TEAM_COORDINATION_ROUTES = {
  member: '/workspace/announcements',
  adminAnnouncements: '/chief/dashboard',
  adminMeetings: '/chief/dashboard',
  fullRoster: '/workspace/full-roster',
} as const;

export interface CoordinationAnnouncementSummary {
  id: string;
  title: string;
  category: Announcement['category'];
  pinned: boolean;
  createdAt: string;
  isRead: boolean | null;
}

export interface CoordinationMeetingSummary {
  id: string;
  title: string;
  status: Meeting['status'];
  scheduledAt: string | null;
  seriesName: string;
  hasExternalLink: false;
}

export interface TeamCoordinationProjection {
  activeAnnouncements: CoordinationAnnouncementSummary[];
  pinnedAnnouncements: CoordinationAnnouncementSummary[];
  recentAnnouncements: CoordinationAnnouncementSummary[];
  upcomingMeetings: CoordinationMeetingSummary[];
  nextActionLabel: string;
  nextActionId: string | null;
  nextActionKind: 'announcement' | 'meeting' | 'none';
  emptyStateLabel: string | null;
  lifecycleNote: string;
  meetingLimitation: string | null;
}

const UNSAFE_COORDINATION_PATTERN = new RegExp([
  String.raw`\bhttps?:\/\/`,
  String.raw`\bdrive[.]google[.]com\b`,
  String.raw`\bdocs[.]google[.]com\b`,
  String.raw`\bsupabase[.]co\/storage\b`,
  String.raw`\bpatient\b`,
  String.raw`\bparticipant\b`,
  String.raw`\bhospital_number\b`,
  String.raw`\bclinical narrative\b`,
  String.raw`\braw audit\b`,
  String.raw`\bcontact list\b`,
].join('|'), 'i');

export function containsUnsafeCoordinationMetadata(value: string): boolean {
  return UNSAFE_COORDINATION_PATTERN.test(value);
}

function safeText(value: string, fallback: string): string {
  const trimmed = value.trim();
  if (!trimmed || containsUnsafeCoordinationMetadata(trimmed)) return fallback;
  return trimmed;
}

function dateValue(value: string | null): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function projectTeamCoordination(args: {
  announcements: Announcement[];
  readAnnouncementIds?: Set<string>;
  meetingSeries: MeetingSeries[];
  meetingsBySeriesId: Record<string, Meeting[]>;
  nowIso: string;
  role: 'member' | 'admin';
}): TeamCoordinationProjection {
  const activeAnnouncements = args.announcements
    .map((announcement) => ({
      id: announcement.id,
      title: safeText(announcement.title, 'Announcement'),
      category: announcement.category,
      pinned: announcement.pinned,
      createdAt: announcement.created_at,
      isRead: args.readAnnouncementIds ? args.readAnnouncementIds.has(announcement.id) : null,
    }))
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      const byDate = dateValue(b.createdAt) - dateValue(a.createdAt);
      if (byDate !== 0) return byDate;
      return a.id.localeCompare(b.id);
    });

  const now = Date.parse(args.nowIso);
  const upcomingMeetings = args.meetingSeries
    .flatMap((series) => (args.meetingsBySeriesId[series.id] ?? []).map((meeting) => ({
      id: meeting.id,
      title: safeText(meeting.title, 'Meeting'),
      status: meeting.status,
      scheduledAt: meeting.scheduled_at,
      seriesName: safeText(series.name, 'Meeting series'),
      hasExternalLink: false as const,
    })))
    .filter((meeting) => meeting.status === 'scheduled' && meeting.scheduledAt !== null)
    .filter((meeting) => dateValue(meeting.scheduledAt) >= now)
    .sort((a, b) => {
      const byDate = dateValue(a.scheduledAt) - dateValue(b.scheduledAt);
      if (byDate !== 0) return byDate;
      return a.id.localeCompare(b.id);
    });

  const unreadPinned = activeAnnouncements.find((announcement) => announcement.pinned && announcement.isRead === false);
  const unreadRecent = activeAnnouncements.find((announcement) => announcement.isRead === false);
  const recent = activeAnnouncements[0] ?? null;
  const nextMeeting = upcomingMeetings[0] ?? null;

  let nextActionKind: TeamCoordinationProjection['nextActionKind'] = 'none';
  let nextActionId: string | null = null;
  let nextActionLabel = args.role === 'admin' ? 'Create announcement' : 'No current coordination action';

  if (unreadPinned) {
    nextActionKind = 'announcement';
    nextActionId = unreadPinned.id;
    nextActionLabel = `View pinned ${unreadPinned.category} announcement`;
  } else if (unreadRecent) {
    nextActionKind = 'announcement';
    nextActionId = unreadRecent.id;
    nextActionLabel = `View latest ${unreadRecent.category} announcement`;
  } else if (nextMeeting) {
    nextActionKind = 'meeting';
    nextActionId = nextMeeting.id;
    nextActionLabel = 'View next scheduled meeting';
  } else if (recent) {
    nextActionKind = 'announcement';
    nextActionId = recent.id;
    nextActionLabel = `Review recent ${recent.category} announcement`;
  }

  return {
    activeAnnouncements,
    pinnedAnnouncements: activeAnnouncements.filter((announcement) => announcement.pinned),
    recentAnnouncements: activeAnnouncements.slice(0, 3),
    upcomingMeetings,
    nextActionLabel,
    nextActionId,
    nextActionKind,
    emptyStateLabel: activeAnnouncements.length === 0 && upcomingMeetings.length === 0
      ? 'No current announcements or scheduled meetings are visible for this tenant.'
      : null,
    lifecycleNote: 'Announcements support active/pinned state and persisted read receipts. Scheduled, expired, archived, and draft announcement lifecycles are not modeled.',
    meetingLimitation: 'Meetings support persisted series, scheduled occurrences, minutes, and action items. No persisted meeting location/link field exists yet.',
  };
}
