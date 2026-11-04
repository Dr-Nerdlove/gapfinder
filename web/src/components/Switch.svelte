<script lang="ts">
  interface Props {
    label: string;
    checked: boolean;
    disabled?: boolean;
    onchange: (checked: boolean) => void;
  }

  let { label, checked, disabled = false, onchange }: Props = $props();
</script>

<label class="switch" class:disabled>
  <span class="label">{label}</span>
  <input type="checkbox" role="switch" {checked} {disabled} onchange={(event) => onchange(event.currentTarget.checked)} />
  <span class="track" aria-hidden="true"><span class="thumb"></span></span>
</label>

<style>
  .switch {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    min-height: 48px;
    cursor: pointer;
  }

  .switch.disabled {
    cursor: not-allowed;
    opacity: 0.38;
  }

  .label {
    flex: 1;
  }

  /* The real checkbox covers the whole row, so the touch target is the full width and at least 48px high. */
  input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    opacity: 0;
    cursor: inherit;
  }

  .track {
    flex: none;
    position: relative;
    box-sizing: border-box;
    width: 52px;
    height: 32px;
    border: 2px solid var(--md-sys-color-outline);
    border-radius: 16px;
    background: var(--md-sys-color-surface-variant);
    transition: background 0.15s, border-color 0.15s;
  }

  .thumb {
    position: absolute;
    top: 50%;
    left: 6px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--md-sys-color-outline);
    transform: translateY(-50%);
    transition: left 0.15s, width 0.15s, height 0.15s, background 0.15s;
  }

  input:checked + .track {
    border-color: var(--md-sys-color-primary);
    background: var(--md-sys-color-primary);
  }

  input:checked + .track .thumb {
    left: 22px;
    width: 24px;
    height: 24px;
    background: var(--md-sys-color-on-primary);
  }

  input:focus-visible + .track {
    outline: 3px solid var(--md-sys-color-primary);
    outline-offset: 3px;
  }

  @media (prefers-reduced-motion: reduce) {
    .track,
    .thumb {
      transition: none;
    }
  }
</style>
