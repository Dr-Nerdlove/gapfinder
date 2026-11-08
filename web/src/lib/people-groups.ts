import { GROUP_MAX_MEMBERS, type Group, type Person } from "@lueckenfueller/shared";

/** The people whose name contains `query` (ignoring case and surrounding blanks). An empty query keeps everyone. */
export function filterPeople(people: readonly Person[], query: string): Person[] {
  const needle = query.normalize("NFC").trim().toLowerCase();
  if (needle === "") return [...people];
  return people.filter((p) => p.username.toLowerCase().includes(needle));
}

/** The members of a group that still have an account here, in the group's order. */
export function knownMembers(group: Group, people: readonly Person[]): number[] {
  const known = new Set(people.map((p) => p.id));
  return group.members.filter((id) => known.has(id));
}

/** Tapping a group adds its people to the choice; nobody is taken away. */
export function addGroupToChoice(chosen: readonly number[], group: Group, people: readonly Person[]): number[] {
  return [...new Set([...chosen, ...knownMembers(group, people)])];
}

/** True when every (known) member of the group is chosen already, so a tap would change nothing. */
export function groupFullyChosen(chosen: readonly number[], group: Group, people: readonly Person[]): boolean {
  const members = knownMembers(group, people);
  return members.length > 0 && members.every((id) => chosen.includes(id));
}

/** "Spieleabend (4)". */
export function groupLabel(group: Group, people: readonly Person[]): string {
  return `${group.name} (${knownMembers(group, people).length})`;
}

/** A choice can be saved as a group when it holds someone and fits the limit. */
export function canSaveAsGroup(chosen: readonly number[]): boolean {
  return chosen.length > 0 && chosen.length <= GROUP_MAX_MEMBERS;
}
