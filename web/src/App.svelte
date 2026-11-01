<script lang="ts">
  import { onMount } from "svelte";
  import Admin from "./pages/Admin.svelte";
  import Invite from "./pages/Invite.svelte";
  import Login from "./pages/Login.svelte";
  import NotFound from "./pages/NotFound.svelte";
  import PasswordReset from "./pages/PasswordReset.svelte";
  import Profile from "./pages/Profile.svelte";
  import Start from "./pages/Start.svelte";
  import { navigate, type Route, watchRoute } from "./lib/router";
  import { sessionState } from "./lib/session.svelte";

  let route = $state<Route>({ name: "start" });

  onMount(() => watchRoute((next) => (route = next)));

  // Someone who is logged in has nothing to do on the login page.
  $effect(() => {
    if (route.name === "login" && sessionState.user) navigate("#/");
  });
</script>

<main>
  {#if route.name === "start"}
    <Start />
  {:else if route.name === "login"}
    <Login />
  {:else if route.name === "invite"}
    <Invite token={route.token} />
  {:else if route.name === "password-reset"}
    <PasswordReset token={route.token} />
  {:else if route.name === "profile"}
    {#if sessionState.user}<Profile />{:else}<Login />{/if}
  {:else if route.name === "admin"}
    {#if sessionState.user}<Admin />{:else}<Login />{/if}
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
