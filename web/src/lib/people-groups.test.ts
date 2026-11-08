import type { Group, Person } from "@lueckenfueller/shared";
import { describe, expect, it } from "vitest";
import { addGroupToChoice, canSaveAsGroup, filterPeople, groupFullyChosen, groupLabel, knownMembers } from "./people-groups";

const person = (id: number, username: string): Person => ({ id, username, seedColor: null });
const people = [person(1, "Anna K."), person(2, "ben m."), person(3, "Özlem")];
const group: Group = { id: 7, name: "Spieleabend", members: [2, 3, 99] };

describe("filterPeople", () => {
  it("keeps everyone for an empty search", () => {
    expect(filterPeople(people, "  ")).toEqual(people);
  });
  it("finds a part of a name without regard to case", () => {
    expect(filterPeople(people, " BEN").map((p) => p.id)).toEqual([2]);
    expect(filterPeople(people, "k.").map((p) => p.id)).toEqual([1]);
    expect(filterPeople(people, "özl").map((p) => p.id)).toEqual([3]);
  });
  it("finds nobody for an unknown name", () => {
    expect(filterPeople(people, "xyz")).toEqual([]);
  });
});

describe("groups in the choice", () => {
  it("ignores members who have no account any more", () => {
    expect(knownMembers(group, people)).toEqual([2, 3]);
    expect(groupLabel(group, people)).toBe("Spieleabend (2)");
  });
  it("adds to the choice and keeps what was chosen", () => {
    expect(addGroupToChoice([1, 2], group, people)).toEqual([1, 2, 3]);
  });
  it("knows when a group is chosen completely", () => {
    expect(groupFullyChosen([2], group, people)).toBe(false);
    expect(groupFullyChosen([3, 2, 1], group, people)).toBe(true);
    expect(groupFullyChosen([1], { ...group, members: [] }, people)).toBe(false);
  });
  it("saves a choice only when it holds someone and fits", () => {
    expect(canSaveAsGroup([])).toBe(false);
    expect(canSaveAsGroup([1])).toBe(true);
    expect(canSaveAsGroup(Array.from({ length: 50 }, (_, i) => i))).toBe(false);
  });
});
