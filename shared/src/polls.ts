// Polls (phase 4): proposals chosen from a gap search, shared through a link, voted on with yes / maybe / no.
//
// Two kinds of routes:
// - `/api/polls…` need a login (`Authorization: Bearer <token>`): create, list, and manage a poll by its id
//   (only its creator or an admin).
// - `/api/poll-links/:shareToken…` need only the share link. Everyone with the link sees the poll and can vote:
//   a logged-in account votes as itself (one vote per account, from any device), a guest votes with a name and
//   gets a secret vote key that only their device keeps; the key is sent as the `X-Vote-Key` header to change
//   or withdraw that vote.
//
// All instants are ISO 8601 in UTC; all calendar days are German days ("YYYY-MM-DD"). The server stores the
// share token so the creator and the participants can open the link again; vote keys are stored only as hashes.

/** At most this many proposals per poll. */
export const POLL_MAX_PROPOSALS = 20;
/** At most this many guest votes per poll (account votes do not count). */
export const POLL_MAX_GUEST_VOTES = 100;
/** A person can have at most this many polls that are not yet deleted. */
export const POLLS_PER_USER = 20;
/** At most this many other people as participants (the same limit as a search). */
export const POLL_MAX_PARTICIPANTS = 50;
export const POLL_TITLE_MAX_LENGTH = 80;
export const POLL_NOTE_MAX_LENGTH = 500;
export const VOTE_NAME_MAX_LENGTH = 40;
/** A poll is deleted this many days after its last proposal has ended. */
export const POLL_KEPT_DAYS_AFTER_LAST_PROPOSAL = 30;
/** Guest vote writes (cast, change, withdraw) per address and 15 minutes. Every write counts. */
export const GUEST_VOTE_WRITES_PER_IP = 30;
/** Calendar checks of a poll page (`GET /api/poll-links/:shareToken/calendar-check`) per caller and 15 minutes. Every call counts. */
export const POLL_CALENDAR_CHECKS_PER_CALLER = 60;
/** Longest timed proposal. */
export const POLL_MAX_TIMED_MINUTES = 24 * 60;
/** Longest proposal of whole days. */
export const POLL_MAX_DAYS = 31;
/** Proposals and the deadline lie at most this many days ahead. */
export const POLL_MAX_DAYS_AHEAD = 365;

/** `timed`: proposals with a start and end time (from an hours search). `days`: runs of whole days. */
export type PollKind = "timed" | "days";

export type VoteAnswer = "yes" | "maybe" | "no";

/** A proposal with times: start and end on 15 minutes, start in the future, at most 24 hours long. */
export interface TimedProposalInput {
  start: string;
  end: string;
}

/** A proposal of whole German days, both ends included: tomorrow at the earliest, at most 31 days. */
export interface DaysProposalInput {
  first: string;
  last: string;
}

interface CreatePollBase {
  /** 1 to `POLL_TITLE_MAX_LENGTH` characters after trimming. */
  title: string;
  /** Optional place or note, up to `POLL_NOTE_MAX_LENGTH` characters; empty means none. */
  note?: string;
  /**
   * The other people of the search (account ids). The creator is always a participant; unknown ids (e.g. an
   * account deleted since the search) and duplicates are ignored.
   */
  participants: number[];
  /** After this instant nobody can vote. In the future, at most `POLL_MAX_DAYS_AHEAD` days ahead; null = none. */
  deadline?: string | null;
  /**
   * Hidden votes (phase 10b): only the creator and admins see who voted what; everybody else gets the sums per
   * proposal (`PollView.tally`), which participants have voted (`PollView.votedParticipantIds`) and their own vote.
   * Default false. Send it only when the server lists `hidden_votes` in `HealthResponse.features`: an older server
   * ignores the field and would create an open poll. A server that knows it refuses unknown fields of this request
   * (`validation`, field = the unknown name) instead of ignoring them.
   */
  hidden?: boolean;
}

/**
 * `POST /api/polls` (login) → `PollView` (201). 1 to `POLL_MAX_PROPOSALS` proposals, no two the same. Fails with
 * `poll_limit` (409) when the creator already has `POLLS_PER_USER` polls.
 */
export type CreatePollRequest =
  | (CreatePollBase & { kind: "timed"; proposals: TimedProposalInput[] })
  | (CreatePollBase & { kind: "days"; proposals: DaysProposalInput[] });

/** `PATCH /api/polls/:id` (creator or admin) → `PollView`. Only the given fields change; proposals never do. */
export interface UpdatePollRequest {
  title?: string;
  note?: string;
  /** A new deadline in the future, or null to remove it. */
  deadline?: string | null;
  /** Closed by hand: nobody can vote until it is opened again. */
  closed?: boolean;
  /**
   * `false` reveals the votes of a hidden poll to everyone; this cannot be undone. `true` is accepted only for a
   * poll that is already hidden (no change); for an open poll it fails with `validation`, field `hidden`.
   */
  hidden?: boolean;
}

/** `POST /api/polls/:id/share-link` (creator or admin): a new share token; the old link stops working. */
export interface NewShareLink {
  shareToken: string;
}

export type Proposal = { id: number } & (TimedProposalInput | DaysProposalInput);

/** A person with an account as shown in a poll: only the name and colour. */
export interface PollPerson {
  id: number;
  username: string;
  seedColor: string | null;
}

/** The sums of one proposal: how many votes answered yes, maybe and no (every vote answers every proposal). */
export interface ProposalTally {
  proposalId: number;
  yes: number;
  maybe: number;
  no: number;
}

export interface VoteView {
  id: number;
  /** The guest's name, or the account's current username. */
  name: string;
  /** Set for a vote of an account (shown with a check mark), null for a guest. */
  personId: number | null;
  /** One answer for every proposal, in the order of `PollView.proposals`. */
  answers: { proposalId: number; answer: VoteAnswer }[];
  updatedAt: string;
}

/**
 * `GET /api/poll-links/:shareToken` → `PollView`, for everyone with the link. Sends the login token too, when
 * there is one: then `myVoteId` and `canManage` are filled in. A guest sends their vote key (`X-Vote-Key`) when
 * the device has one for this poll, so a hidden poll still shows them their own vote; an unknown key is ignored.
 */
export interface PollView {
  id: number;
  shareToken: string;
  title: string;
  /** Empty when there is none. */
  note: string;
  kind: PollKind;
  /** In the order the creator chose them. */
  proposals: Proposal[];
  /** Null when the creator's account has been deleted (then only an admin can manage the poll). */
  creator: PollPerson | null;
  /** The people of the search, the creator included, sorted by username without regard to case. */
  participants: PollPerson[];
  /**
   * Account votes first (sorted by username), then guest votes in the order they were cast. When the votes are
   * hidden from this caller (`hidden` and not `canManage`), only the caller's own vote (account vote, or the guest
   * vote whose key came in `X-Vote-Key`), or none.
   */
  votes: VoteView[];
  /**
   * Hidden votes (phase 10b, `CreatePollRequest.hidden`). Added later: an older server does not send it (= false).
   */
  hidden?: boolean;
  /** Only when the votes are hidden from this caller: the sums per proposal, in the order of `proposals`. */
  tally?: ProposalTally[];
  /** Only when the votes are hidden from this caller: the participants (account ids) who have voted. */
  votedParticipantIds?: number[];
  deadline: string | null;
  /** Closed by hand (`UpdatePollRequest.closed`). */
  closed: boolean;
  /** Votes are accepted: not closed by hand, not fixed, and the deadline (if any) has not passed. */
  open: boolean;
  /** The proposal chosen as the final date (`FixPollRequest`), or null while no date is fixed. */
  fixedProposalId: number | null;
  /** When the date was fixed (or changed to another proposal), or null. */
  fixedAt: string | null;
  createdAt: string;
  /** When the poll will be deleted (`POLL_KEPT_DAYS_AFTER_LAST_PROPOSAL` after the last proposal ends). */
  expiresAt: string;
  /** The logged-in caller's own account vote, or null (also for guests). */
  myVoteId: number | null;
  /** The logged-in caller is the creator or an admin. */
  canManage: boolean;
  /**
   * When the creator last sent a reminder (`POST /api/polls/:id/reminders`); only filled for the creator or an
   * admin. Added later: an older server does not send it, so the app must cope with it missing.
   */
  lastReminderAt?: string | null;
}

/** One poll in `GET /api/polls` (login): every poll the caller created, takes part in, or voted in. */
export interface PollSummary {
  id: number;
  shareToken: string;
  title: string;
  kind: PollKind;
  creator: PollPerson | null;
  proposalCount: number;
  voteCount: number;
  deadline: string | null;
  open: boolean;
  /** The proposal chosen as the final date, or null. */
  fixedProposalId: number | null;
  /**
   * The times of the fixed proposal (same shape as in `PollView.proposals`), or null while no date is fixed.
   * Added later: an older server does not send it, so the app must cope with it missing.
   */
  fixedProposal: Proposal | null;
  createdAt: string;
  expiresAt: string;
  /** The caller has an account vote in it. */
  voted: boolean;
  /** Hidden votes (phase 10b). Added later: an older server does not send it (= false). */
  hidden?: boolean;
}

/** `GET /api/polls`: newest first. */
export interface PollList {
  polls: PollSummary[];
}

/** One answer per proposal of the poll, each exactly once. */
export interface VoteAnswersInput {
  answers: { proposalId: number; answer: VoteAnswer }[];
}

/** `PUT /api/poll-links/:shareToken/my-vote` (login) → `PollView`: casts or replaces the account's vote. */
export type AccountVoteRequest = VoteAnswersInput;

/**
 * `POST /api/poll-links/:shareToken/votes` (guest, no login needed) → `GuestVoteCreated` (201).
 * `PUT /api/poll-links/:shareToken/votes/:voteId` with `X-Vote-Key` → `PollView`: changes name and answers.
 * The name: 1 to `VOTE_NAME_MAX_LENGTH` characters after trimming; it may be neither an account's username
 * nor another guest's name in this poll (compared without case) → `vote_name_taken` (409).
 */
export interface GuestVoteRequest extends VoteAnswersInput {
  name: string;
}

/** The device keeps `voteKey` (with the poll's share token) to change or withdraw the vote later. */
export interface GuestVoteCreated {
  voteId: number;
  voteKey: string;
  poll: PollView;
}

/**
 * Fixing the date (phase 5a). The creator or an admin chooses one proposal as the final date; the poll then does
 * not take votes any more (`PollView.open` is false, voting fails with `poll_closed`). `closed` stays a separate
 * flag: un-fixing opens the poll again unless it was closed by hand or its deadline has passed.
 *
 * - `PUT /api/polls/:id/fixed` (creator or admin) body `FixPollRequest` → `PollView`: fixes the proposal, or
 *   changes the fixed date to another proposal. Fixing the proposal that is already fixed changes nothing.
 *   A `proposalId` that is not a proposal of this poll → `validation` with field `proposalId`.
 * - `DELETE /api/polls/:id/fixed` (creator or admin) → `PollView`: removes the fixed date (fine when there is none).
 */
export interface FixPollRequest {
  proposalId: number;
}

/**
 * `POST /api/polls/:id/fix-check` (creator or admin) body `FixPollRequest` → `FixCheck`: reads the calendars of
 * the poll's participants again and tells who would be busy during that proposal. A warning for the screen only;
 * fixing is never blocked by it. Counts against the same limit as a search (`SEARCHES_PER_USER`, bucket of the
 * caller) and needs the calendar key (`calendars_unavailable` otherwise). Never contains titles or times.
 */
export interface FixCheck {
  proposalId: number;
  /** Participants with a busy time that overlaps the proposal (all-day busy events count for whole German days). */
  busy: PollPerson[];
  /** Participants of whom at least one calendar could not be read completely: nothing is known about them. */
  unreadable: PollPerson[];
  /** Participants who have not added a calendar: nothing is known about them either. */
  noCalendar: PollPerson[];
}

/**
 * `GET /api/poll-links/:shareToken/calendar-check` → `PollCalendarCheck`, for everyone with the link (guests too;
 * a login is optional). Reads the calendars of the poll's participants (and of the logged-in caller) right now and
 * tells who is left out and, for a logged-in caller, which proposals are busy in their own calendar. Works while the
 * poll is closed or fixed. Needs the calendar key (`calendars_unavailable` otherwise). Has its own limit
 * (`POLL_CALENDAR_CHECKS_PER_CALLER` per 15 minutes, per account or, for guests, per address; every call counts).
 * Contains nothing from a calendar but these reasons and booleans: never titles or times. An unknown link behaves
 * like `GET /api/poll-links/:shareToken`.
 */
export interface PollCalendarCheck {
  /** Participants (creator included) left out right now: no calendar added, or a calendar that cannot be read completely. In the order of `PollView.participants`. */
  skipped: { person: PollPerson; reason: "no_calendar" | "unreadable" }[];
  /** Null for guests. For a logged-in caller (participant or not): their own calendars. */
  mine: { readable: true; busyProposalIds: number[] } | { readable: false; reason: "no_calendar" | "unreadable" } | null;
}

/**
 * The fixed date as a calendar file, for everyone with the share link (guests too):
 * `GET /api/poll-links/:shareToken/event.ics` → `text/calendar`, sent as a download (`termin.ics`). A poll without
 * a fixed date → `poll_not_fixed` (409). An unknown link behaves like `GET /api/poll-links/:shareToken`.
 *
 * Personal calendar feed, for subscribing from a calendar app. The link contains a secret token and is shown in
 * the profile, so it is stored as is, like the share token:
 * - `GET /api/me/calendar-feed` (login) → `CalendarFeed`: the current token, or null when the feed is off, and
 *   when each kind of calendar app last fetched it (`fetches`).
 * - `POST /api/me/calendar-feed` (login) → `CalendarFeed`: switches the feed on, or renews the token (the old link
 *   stops working).
 * - `DELETE /api/me/calendar-feed` (login) → 204: switches the feed off.
 * - `GET /api/calendar-feeds/:token` (no login; `:token.ics` works too) → `text/calendar`: the fixed date of every
 *   poll the person created, takes part in, or voted in, except polls where the person's own vote on the fixed
 *   proposal is "no". Polls disappear from it when they are deleted. An unknown token → `not_found` (404).
 *
 * The events carry no link to the poll: the server does not know the address of the app's pages.
 */
export interface CalendarFeed {
  token: string | null;
  /**
   * When each kind of calendar app last fetched the feed, newest first (empty while the feed is off or not yet
   * fetched). Optional because the frontend is deployed before the server is updated: an older server omits it.
   */
  fetches?: CalendarFeedFetch[];
}

/** The kind of calendar app, told from its `User-Agent` (only the kind is stored, never the header). */
export type FeedApp = "google" | "apple" | "microsoft" | "other";

export interface CalendarFeedFetch {
  app: FeedApp;
  /** ISO time of the last fetch by this kind of app. */
  at: string;
}

// Further routes, all → `PollView`:
// - `DELETE /api/poll-links/:shareToken/my-vote` (login): withdraws the account's vote.
// - `DELETE /api/poll-links/:shareToken/votes/:voteId` with `X-Vote-Key`: a guest withdraws their vote.
// - `DELETE /api/polls/:id/votes/:voteId` (creator or admin): removes any vote (e.g. nonsense from a stranger).
// - `DELETE /api/polls/:id` (creator or admin) → 204: deletes the poll with all votes.
//
// Errors: an unknown or replaced share link → `poll_invalid` (404, counts against the address like a wrong invite
// link); voting while not `open` → `poll_closed` (409); more than `POLL_MAX_GUEST_VOTES` → `poll_full` (409);
// a wrong vote key or a vote that is not this guest's → `not_found` (404, also counted).
