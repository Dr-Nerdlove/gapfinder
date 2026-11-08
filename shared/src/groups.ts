import { SEARCH_MAX_PEOPLE } from "./gaps.js";

/** A person can keep at most this many groups. */
export const GROUPS_PER_USER = 20;
/** Longest group name, in characters after trimming. */
export const GROUP_NAME_MAX_LENGTH = 40;
/** A group holds other people only (the searcher is always in), so one fewer than a search takes. */
export const GROUP_MAX_MEMBERS = SEARCH_MAX_PEOPLE - 1;

// Groups are private: each person sees only their own. They are a convenience for choosing people on the
// search page, nothing else; nobody is told that they are in somebody's group.

/** One group of the caller. `members` are user ids, never the caller; only people who still have an account. */
export interface Group {
  id: number;
  name: string;
  members: number[];
}

/** `GET /api/groups`: the caller's groups, sorted by name without regard to case. */
export interface GroupList {
  groups: Group[];
}

/** `POST /api/groups` → 201 `Group`. A name already used by another group of the caller is a `validation` on `name`. */
export interface CreateGroupRequest {
  name: string;
  members: number[];
}

/** `PATCH /api/groups/:id` → `Group`. Only the given fields change; `members` replaces the whole list. */
export interface UpdateGroupRequest {
  name?: string;
  members?: number[];
}

// `DELETE /api/groups/:id` → 204. Over the limit: 409 `group_limit`.
