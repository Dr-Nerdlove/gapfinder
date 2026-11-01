<script lang="ts">
  interface Props {
    kind?: "error" | "success";
    text: string;
  }

  let { kind = "error", text }: Props = $props();
</script>

<!-- The region stays in the page so screen readers announce text that appears later. -->
<p class="message" class:error={kind === "error" && !!text} class:success={kind === "success" && !!text} aria-live="polite">
  {text}
</p>

<style>
  /* An empty message takes no room: the two flex gaps around it (16px each) shrink to one. */
  .message:not(.error):not(.success) {
    margin: -8px 0;
  }

  .error {
    color: var(--md-sys-color-error);
    font-weight: 500;
  }

  .success {
    color: var(--md-sys-color-primary);
    font-weight: 500;
  }
</style>
