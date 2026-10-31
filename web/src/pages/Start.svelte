<script lang="ts">
  import ServerStatus from "../components/ServerStatus.svelte";
</script>

<header>
  <h1>Lückenfüller</h1>
  <p class="subtitle">Gemeinsame freie Zeit finden</p>
</header>

<ServerStatus />

<style>
  header {
    padding: 48px 0 24px;
  }

  h1 {
    font-size: 2.25rem;
    line-height: 1.2;
    font-weight: 600;
    color: var(--md-sys-color-primary);
  }

  .subtitle {
    margin-top: 4px;
    font-size: 1.125rem;
    color: var(--md-sys-color-on-surface-variant);
  }
</style>
