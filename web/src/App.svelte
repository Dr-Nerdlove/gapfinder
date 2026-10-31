<script lang="ts">
  import { onMount } from "svelte";
  import NotFound from "./pages/NotFound.svelte";
  import Start from "./pages/Start.svelte";
  import { type Route, watchRoute } from "./lib/router";

  let route = $state<Route>({ name: "start" });

  onMount(() => watchRoute((next) => (route = next)));
</script>

<main>
  {#if route.name === "start"}
    <Start />
  {:else}
    <NotFound />
  {/if}
</main>

<style>
  main {
    max-width: 40rem;
    margin: 0 auto;
    padding: calc(var(--gutter) + env(safe-area-inset-top)) calc(var(--gutter) + env(safe-area-inset-right))
      calc(var(--gutter) + env(safe-area-inset-bottom)) calc(var(--gutter) + env(safe-area-inset-left));
  }
</style>
