<script lang="ts">
  import type { PollCalendarCheck, PollView, UpdatePollRequest } from "@lueckenfueller/shared";
  import { onMount } from "svelte";
  import * as api from "../lib/api";
  import type { ApiResult } from "../lib/api";
  import { fixedProposal, reviewCheck, serverCanFix, type CheckReview } from "../lib/fix-date";
  import { guestVoteFor, lastGuestName, liveGuestVote } from "../lib/guest-votes";
  import { buildPollLink } from "../lib/links";
  import { isServerNight } from "../lib/server-night";
  import { errorMessage } from "../lib/messages";
  import { hintFor, pollSkippedNotices } from "../lib/poll-calendar";
  import { submitVote, withdrawVote } from "../lib/poll-actions";
  import { nextScreen, statusText, updatedText, type AnswerMap, type PollScreen } from "../lib/poll-view";
  import { startPolling } from "../lib/polling";
  import { replanFromPoll, replanHandover } from "../lib/replan";
  import { navigate } from "../lib/router";
  import { pollWaitingText } from "../lib/sleep-notice";
  import { session, sessionState } from "../lib/session.svelte";
  import Button from "../components/Button.svelte";
  import Card from "../components/Card.svelte";
  import ConfirmDialog from "../components/ConfirmDialog.svelte";
  import LinkBox from "../components/LinkBox.svelte";
  import OfflineNotice from "../components/OfflineNotice.svelte";
  import Page from "../components/Page.svelte";
  import FixDate from "../components/polls/FixDate.svelte";
  import FixedDate from "../components/polls/FixedDate.svelte";
  import PollManage from "../components/polls/PollManage.svelte";
  import Reminder from "../components/polls/Reminder.svelte";
  import PollResults from "../components/polls/PollResults.svelte";
  import VoteForm from "../components/polls/VoteForm.svelte";

  interface Props {
    token: string;
  }

  let { token }: Props = $props();

  const loggedIn = $derived(sessionState.user !== null);
  let screen = $state<PollScreen>({ phase: "loading" });
  let busy = $state(false);
  let voteProblem = $state("");
  let manageProblem = $state("");
  let fixProblem = $state("");
  let removing = $state<{ id: number; name: string } | null>(null);
  /** Every answer of the server gets a number; an answer that arrives after a newer one is dropped. */
  let newest = 0;
  let applied = 0;

  /** The calendar check, loaded once per page visit while the poll is open. Any problem: nothing is shown. */
  let calendarCheck = $state<PollCalendarCheck | null>(null);
  let checkAsked = false;

  async function loadCalendarCheck(): Promise<void> {
    checkAsked = true;
    const forToken = token;
    const result = await session.run((o) => api.pollCalendarCheck(forToken, o));
    if (result.ok && forToken === token) calendarCheck = result.data;
  }

  /** Asks the server and shows the answer. Answers that were overtaken by a newer one are ignored. */
  async function refresh(): Promise<void> {
    const mine = ++newest;
    const result = await session.run((o) => api.getPollByLink(token, o));
    if (mine < applied) return;
    applied = mine;
    screen = nextScreen(screen, result, new Date());
  }

  /** Shows the answer of an action (which is the new state of the poll). */
  function show(poll: PollView): void {
    applied = ++newest;
    screen = { phase: "ready", poll, updatedAt: new Date(), offline: false, problem: "" };
  }

  // A different poll link (same page): start over.
  $effect(() => {
    token;
    screen = { phase: "loading" };
    calendarCheck = null;
    checkAsked = false;
    voteProblem = manageProblem = fixProblem = "";
    void refresh();
    return startPolling(refresh);
  });

  onMount(() => {
    const onVisible = (): void => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  });

  const poll = $derived(screen.phase === "ready" ? screen.poll : null);
  const stored = $derived(poll ? liveGuestVote(poll, guestVoteFor(token)) : null);
  const ownVoteId = $derived(poll ? (loggedIn ? poll.myVoteId : (stored?.voteId ?? null)) : null);
  const locked = $derived(sessionState.offline);
  const fixed = $derived(poll ? fixedProposal(poll) : null);

  // Once the poll is loaded and open (not on every refresh).
  $effect(() => {
    if (poll?.open && !checkAsked) void loadCalendarCheck();
  });

  const notices = $derived(calendarCheck ? pollSkippedNotices(calendarCheck, sessionState.user?.id ?? null) : []);

  const deps = { run: session.run };

  async function vote(name: string, answers: AnswerMap): Promise<void> {
    if (!poll || busy) return;
    busy = true;
    voteProblem = "";
    const outcome = await submitVote(poll, { loggedIn, name, answers, stored: guestVoteFor(token) }, deps);
    busy = false;
    if (outcome.kind === "done") show(outcome.poll);
    else voteProblem = outcome.kind === "problem" ? outcome.text : errorMessage(outcome.failure);
    // A closed poll or a name that is taken: the state may have changed, so look again.
    if (outcome.kind === "failed" && outcome.failure.kind === "error") void refresh();
  }

  async function withdraw(): Promise<void> {
    if (!poll || busy) return;
    busy = true;
    voteProblem = "";
    const outcome = await withdrawVote(poll, { loggedIn, stored: guestVoteFor(token) }, deps);
    busy = false;
    if (outcome.kind === "done") show(outcome.poll);
    else voteProblem = outcome.kind === "problem" ? outcome.text : errorMessage(outcome.failure);
  }

  /** "Nochmal planen": a new search with the same people; title and note come along. */
  function replan(): void {
    const me = sessionState.user;
    if (!poll || !me) return;
    replanHandover.set(replanFromPoll(poll, me.id));
    navigate("#/suche");
  }

  /** Runs a management call; the answer is the new poll. */
  async function manage<T>(call: () => Promise<ApiResult<T>>, done: (data: T) => void): Promise<void> {
    if (busy) return;
    busy = true;
    manageProblem = "";
    const result = await call();
    busy = false;
    if (result.ok) done(result.data);
    else manageProblem = errorMessage(result);
  }

  const update = (changes: UpdatePollRequest): Promise<void> =>
    manage(() => session.run((o) => api.updatePoll(poll!.id, changes, o)), show);

  const newLink = (): Promise<void> =>
    manage(
      () => session.run((o) => api.newPollShareLink(poll!.id, o)),
      (data) => navigate(`#/abstimmung/${encodeURIComponent(data.shareToken)}`, { replace: true }),
    );

  const remove = (): Promise<void> =>
    manage(
      () => session.run((o) => api.deletePoll(poll!.id, o)),
      () => navigate("#/abstimmungen", { replace: true }),
    );

  /** Deletes the poll but keeps its fixed date in the calendar. An older server does not know the route yet. */
  async function removeKeepingDate(): Promise<void> {
    if (busy) return;
    busy = true;
    manageProblem = "";
    const result = await session.run((o) => api.removePollKeepingDate(poll!.id, o));
    busy = false;
    if (result.ok) navigate("#/abstimmungen", { replace: true });
    else if (result.kind === "error" && result.status === 404 && result.code === "not_found")
      manageProblem = "Der Server kennt „Termin behalten“ noch nicht, er wird bald aktualisiert. Versuch es später noch einmal oder lösche alles.";
    else manageProblem = errorMessage(result);
  }

  /** The check before fixing. A failed check never stops the person: the dialog then says so. */
  async function check(proposalId: number): Promise<CheckReview> {
    return reviewCheck(await session.run((o) => api.checkFix(poll!.id, { proposalId }, o)));
  }

  /** Runs a call for fixing or un-fixing; the answer is the new poll. */
  async function changeFixed(call: () => Promise<ApiResult<PollView>>): Promise<void> {
    if (busy) return;
    busy = true;
    fixProblem = "";
    const result = await call();
    busy = false;
    if (result.ok) show(result.data);
    else fixProblem = errorMessage(result);
  }

  const fix = (proposalId: number): Promise<void> => changeFixed(() => session.run((o) => api.fixPoll(poll!.id, { proposalId }, o)));
  const unfix = (): Promise<void> => changeFixed(() => session.run((o) => api.unfixPoll(poll!.id, o)));

  async function removeVote(): Promise<void> {
    const target = removing;
    removing = null;
    if (!target) return;
    await manage(() => session.run((o) => api.removePollVote(poll!.id, target.id, o)), show);
  }
</script>

<Page title={poll?.title ?? "Abstimmung"} subtitle={poll ? "" : "Wann passt es dir?"} back={loggedIn}>
  <OfflineNotice onretry={refresh} />

  {#if screen.phase === "loading"}
    <Card><p aria-live="polite">Einen Moment …</p></Card>
  {:else if screen.phase === "waiting"}
    <Card title="Die Abstimmung kann gerade nicht geladen werden">
      <p>{pollWaitingText(isServerNight(new Date()), sessionState.offline)}</p>
    </Card>
  {:else if screen.phase === "gone"}
    <Card title="Diese Abstimmung gibt es nicht mehr">
      <p>Der Link ist abgelaufen, wurde erneuert oder die Abstimmung wurde gelöscht. Frag nach einem neuen Link.</p>
    </Card>
  {:else if screen.phase === "failed"}
    <Card title="Das hat nicht geklappt">
      <p>{screen.message}</p>
      <div><Button variant="tonal" onclick={refresh}>Erneut versuchen</Button></div>
    </Card>
  {:else if poll}
    <Card>
      {#if poll.creator}<p>Von {poll.creator.username}</p>{/if}
      {#if poll.note}<p class="note">{poll.note}</p>{/if}
      <p class="status" class:closed={!poll.open && !fixed}>{statusText(poll)}</p>
      <p class="updated" aria-live="polite">
        {#if screen.offline}
          Der Server ist gerade nicht erreichbar. Stand von {updatedText(screen.updatedAt)} Uhr.
        {:else}
          Zuletzt aktualisiert um {updatedText(screen.updatedAt)} Uhr, alle 30 Sekunden neu.
        {/if}
        {#if screen.problem}<span class="problem"> {screen.problem}</span>{/if}
      </p>
    </Card>

    {#if fixed}
      <FixedDate {poll} proposal={fixed} {locked} {loggedIn} />
    {/if}

    <PollResults {poll} busy={busy || locked} onremove={poll.canManage ? (id, name) => (removing = { id, name }) : undefined} />

    {#if poll.open && notices.length > 0}
      <Card tone="notice" title="Nicht berücksichtigt">
        <ul class="plain">
          {#each notices as notice (notice)}<li>{notice}</li>{/each}
        </ul>
      </Card>
    {/if}

    {#if poll.open}
      <VoteForm
        {poll}
        {loggedIn}
        voteId={ownVoteId}
        initialName={lastGuestName()}
        {busy}
        {locked}
        problem={voteProblem}
        onsubmit={vote}
        onwithdraw={withdraw}
        hintFor={hintFor(calendarCheck, poll)}
      />
    {:else if !fixed}
      <Card tone="notice"><p>{statusText(poll)}. Abstimmen geht nicht mehr.</p></Card>
    {/if}

    {#if screen.phase === "ready"}
      <Reminder {poll} now={screen.updatedAt} {locked} onsent={refresh} />
    {/if}

    {#if poll.canManage && serverCanFix(poll)}
      <FixDate {poll} {busy} {locked} problem={fixProblem} oncheck={check} onfix={fix} onunfix={unfix} />
    {/if}

    <Card title="Link weitergeben" help="pollShare">
      <LinkBox
        label="Link zur Abstimmung"
        link={buildPollLink(poll.shareToken)}
        note="Wer den Link hat, kann abstimmen – auch ohne Konto."
        shareText="Stimm mit ab: {poll.title}"
      />
    </Card>

    {#if poll.canManage}
      <PollManage {poll} {busy} {locked} problem={manageProblem} onupdate={update} onnewlink={newLink} ondelete={remove} ondeletekeepdate={removeKeepingDate} onreplan={replan} />
    {/if}
  {/if}
</Page>

<ConfirmDialog
  open={removing !== null}
  title="Stimme löschen?"
  text="Die Stimme von {removing?.name ?? ''} wird gelöscht. Diese Person kann danach neu abstimmen."
  confirmLabel="Stimme löschen"
  {busy}
  onconfirm={removeVote}
  oncancel={() => (removing = null)}
/>

<style>
  .note {
    white-space: pre-wrap;
  }

  .status {
    font-weight: 600;
  }

  .status.closed {
    color: var(--md-sys-color-error);
  }

  .plain {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .updated {
    font-size: 0.875rem;
  }

  .problem {
    color: var(--md-sys-color-error);
    font-weight: 500;
  }
</style>
