<script lang="ts">
  import { APK_DOWNLOAD_URL } from "../lib/app-update";
  import {
    INSTALL_HINT_ANDROID_TEXT,
    INSTALL_HINT_IOS_TEXT,
    INSTALL_HINT_TITLE,
    dismissInstallHint,
    installHintDismissed,
    installHintKind,
  } from "../lib/install-hint";
  import { isAndroidApp } from "../lib/native";
  import { detectEnv, platformOf } from "../lib/push";
  import Button from "./Button.svelte";
  import Card from "./Card.svelte";

  const kind = installHintKind(
    platformOf(navigator.userAgent, navigator.maxTouchPoints),
    detectEnv(navigator, window).isStandalone,
    isAndroidApp(),
  );
  let hidden = $state(installHintDismissed());

  function dismiss() {
    dismissInstallHint();
    hidden = true;
  }
</script>

{#if kind && !hidden}
  <Card title={INSTALL_HINT_TITLE}>
    <p>{kind === "ios" ? INSTALL_HINT_IOS_TEXT : INSTALL_HINT_ANDROID_TEXT}</p>
    <div class="actions">
      {#if kind === "android"}
        <Button external href={APK_DOWNLOAD_URL}>Android-App herunterladen</Button>
      {/if}
      <Button variant="tonal" onclick={dismiss}>Nicht mehr zeigen</Button>
    </div>
  </Card>
{/if}

<style>
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
</style>
