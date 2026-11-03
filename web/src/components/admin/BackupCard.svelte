<script lang="ts">
  import type { BackupStatus } from "@lueckenfueller/shared";
  import * as api from "../../lib/api";
  import { backupProblems } from "../../lib/backup-status";
  import { formatDateTime } from "../../lib/format";
  import { session } from "../../lib/session.svelte";
  import Card from "../Card.svelte";

  /** Null until known; stays null when the server is asleep or older (404): then the card is not shown. */
  let status = $state<BackupStatus | null>(null);

  $effect(() => {
    let current = true;
    void session.run((o) => api.getBackupStatus(o)).then((result) => {
      if (current) status = result.ok ? result.data : null;
    });
    return () => {
      current = false;
    };
  });

  const problems = $derived(status ? backupProblems(status, new Date()) : null);

  interface Line {
    label: string;
    at: string | null;
    overdue: boolean;
  }

  const lines = $derived<Line[]>(
    status && problems
      ? [
          { label: "Letztes Backup", at: status.lastBackupAt, overdue: problems.backupOverdue },
          { label: "Kopie nach Windows", at: status.lastCopyAt, overdue: problems.copyOverdue },
          { label: "Letzte Probe-Wiederherstellung", at: status.lastCheckAt, overdue: problems.checkOverdue },
        ]
      : [],
  );
</script>

{#if status && problems}
  <Card title="Sicherung" tone={problems.any ? "notice" : "plain"}>
    {#if problems.unknown}
      <p>
        Der Stand der Sicherung ist unbekannt. Entweder ist die Sicherung noch nicht eingerichtet, oder die VM hat die
        neuen Dateien noch nicht: Dann muss dort die Einrichtung noch einmal laufen (<code>setup.sh</code>, Anleitung
        „When the files in deploy/vm/ change“ in <code>docs/server-setup.md</code>).
      </p>
    {:else}
      <ul>
        {#each lines as line (line.label)}
          <li class:overdue={line.overdue}>
            <strong>{line.label}</strong>
            <span>{line.at ? formatDateTime(line.at) : "noch nie"}{line.overdue ? " – überfällig" : ""}</span>
          </li>
        {/each}
      </ul>
      {#if problems.checkOverdue}
        <p>
          Die Probe-Wiederherstellung ist fällig. Sie läuft in der VM und ändert nichts:
        </p>
        <p><code>sudo lueckenfueller-backup check</code></p>
      {/if}
    {/if}
  </Card>
{/if}

<style>
  ul {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    display: flex;
    flex-direction: column;
  }

  li.overdue span {
    font-weight: 600;
  }

  span {
    font-size: 0.875rem;
  }

  code {
    overflow-wrap: anywhere;
  }
</style>
