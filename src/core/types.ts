// Core domain types. Pure TypeScript: no Firebase, no React.
// Times are stored as wall-clock local strings plus an IANA zone, with UTC
// milliseconds alongside for range queries. All-day events use date strings
// with an exclusive end date (RFC 5545 convention).

export type EventStatus = 'confirmed' | 'tentative' | 'cancelled';
export type Privacy = 'default' | 'private' | 'public';
export type Transparency = 'busy' | 'free';

export interface Reminder {
  minutesBefore: number; // 0 = at time of event
  method?: 'email' | 'push' | 'both';
}

export interface Attendee {
  email: string;
  name?: string;
  role?: string;
  partstat?: string;
}

export interface Attachment {
  title: string;
  url: string;
}

export interface CalendarDoc {
  id: string;
  name: string;
  color: string;
  description?: string;
  visible: boolean;
  archived: boolean;
  defaultReminders: Reminder[];
  sortOrder: number;
  source?: { type: 'local' | 'import'; importBatchId?: string; originalName?: string };
  createdAt?: number;
  updatedAt?: number;
  deletedAt?: number | null;
}

export interface EventDoc {
  id: string;
  calendarId: string;
  title: string;
  description?: string;
  location?: string;
  meetingUrl?: string;
  allDay: boolean;
  /** Timed: "2026-10-12T09:00:00" local wall time. All-day: "2026-10-12". */
  start: string;
  /** Timed: local wall time in endTz (or tz). All-day: exclusive end date. */
  end: string;
  tz: string;
  endTz?: string;
  startUtc: number;
  endUtc: number;
  status: EventStatus;
  privacy: Privacy;
  transparency: Transparency;
  color?: string | null;
  attendees: Attendee[];
  reminders: Reminder[];
  attachments: Attachment[];
  // Recurrence (series master only). Rule stored in floating local time:
  // UNTIL is a local wall-clock value in `tz` ("20261102T085959" or "20261102").
  rrule?: string | null;
  rdates?: string[];
  exdates?: string[];
  /** UTC ms of the end of the last occurrence; null = never ends. */
  seriesEndUtc?: number | null;
  splitFrom?: string | null;
  ical?: { uid: string; sequence?: number; raw?: Record<string, string[]> };
  source?: { type: 'app' | 'import' | 'integration'; importBatchId?: string; id?: string; externalId?: string };
  createdAt?: number;
  updatedAt?: number;
  deletedAt?: number | null;
}

/** A modified or cancelled single occurrence of a series (RECURRENCE-ID). */
export interface OverrideDoc {
  id: string;
  seriesId: string;
  /** Original start of the occurrence, same format as the master's `start`. */
  recurrenceId: string;
  cancelled?: boolean;
  changes: Partial<Pick<EventDoc,
    'title' | 'description' | 'location' | 'meetingUrl' | 'allDay' | 'start' | 'end' | 'tz' | 'endTz' |
    'status' | 'privacy' | 'transparency' | 'color' | 'attendees' | 'reminders' | 'attachments' | 'calendarId'>>;
  ical?: { uid: string; sequence?: number; raw?: Record<string, string[]> };
  source?: EventDoc['source'];
  createdAt?: number;
  updatedAt?: number;
  deletedAt?: number | null;
}

/** A concrete instance shown on the calendar. */
export interface Occurrence {
  key: string; // unique: eventId or eventId::recurrenceId
  eventId: string;
  recurrenceId?: string; // set for occurrences of a series
  isRecurring: boolean;
  isException: boolean;
  calendarId: string;
  title: string;
  description?: string;
  location?: string;
  meetingUrl?: string;
  allDay: boolean;
  start: string;
  end: string;
  tz: string;
  startUtc: number;
  endUtc: number;
  status: EventStatus;
  privacy: Privacy;
  transparency: Transparency;
  color?: string | null;
  attendees: Attendee[];
  reminders: Reminder[];
  attachments: Attachment[];
}

export interface Settings {
  defaultCalendarId?: string;
  weekStart: 0 | 1 | 6;
  timeFormat: '12h' | '24h';
  defaultDurationMin: number;
  defaultReminders: Reminder[];
  /** 'device' follows the phone/computer as you travel. */
  timeZone: string;
  theme: 'system' | 'light' | 'dark';
  defaultView: 'day' | 'week' | 'month' | 'year' | 'agenda';
  /** Show today's date as the app icon badge (iOS needs notification permission). */
  iconBadge: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  weekStart: 1,
  timeFormat: '12h',
  defaultDurationMin: 60,
  defaultReminders: [{ minutesBefore: 15 }],
  timeZone: 'device',
  theme: 'system',
  defaultView: 'month',
  iconBadge: false,
};

export const HOME_TZ = 'Asia/Dubai';
