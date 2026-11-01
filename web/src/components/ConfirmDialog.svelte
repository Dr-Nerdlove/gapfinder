<script lang="ts">
  import Button from "./Button.svelte";

  interface Props {
    open: boolean;
    title: string;
    text: string;
    confirmLabel: string;
    busy?: boolean;
    onconfirm: () => void;
    oncancel: () => void;
  }

  let { open, title, text, confirmLabel, busy = false, onconfirm, oncancel }: Props = $props();
  let dialog = $state<HTMLDialogElement>();
  const id = $props.id();

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  });
</script>

<dialog bind:this={dialog} aria-labelledby="{id}-title" oncancel={oncancel}>
  <h2 id="{id}-title">{title}</h2>
  <p>{text}</p>
  <div class="actions">
    <Button variant="text" disabled={busy} onclick={oncancel}>Abbrechen</Button>
    <Button variant="danger" disabled={busy} onclick={onconfirm}>{confirmLabel}</Button>
  </div>
</dialog>

<style>
  dialog {
    width: min(28rem, calc(100vw - 32px));
    padding: 24px;
    border: 0;
    border-radius: var(--radius-card);
    background: var(--md-sys-color-surface-container-high, var(--md-sys-color-surface));
    color: var(--md-sys-color-on-surface);
  }

  dialog::backdrop {
    background: rgb(0 0 0 / 0.5);
  }

  h2 {
    font-size: 1.25rem;
    font-weight: 600;
    margin-bottom: 8px;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 24px;
  }
</style>
