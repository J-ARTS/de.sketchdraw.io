import { onBeforeUnmount, ref, type Ref } from 'vue';
import type { UpdateBridge, UpdateStatus } from '@/domain';
import { getDesktopBridge } from '@/platform';

/**
 * The update status of the desktop app and the actions on it. `status` stays null in the browser, where there is
 * nothing to update, so a view shows its update section only when it has a value.
 */
export function useAppUpdates(bridge: UpdateBridge | undefined = getDesktopBridge().updates): {
  status: Ref<UpdateStatus | null>;
  /** Reads the status again, for example when a dialog opens. */
  refresh(): void;
  check(): void;
  install(): void;
  setAutoCheck(enabled: boolean): void;
  openReleasePage(): void;
} {
  const status = ref<UpdateStatus | null>(null);
  // A failed call leaves the last known status in place; the desktop app reports problems as a status of their own.
  const take = (answer: Promise<UpdateStatus> | undefined): void => {
    void answer?.then((value) => { status.value = value; }).catch(() => undefined);
  };
  const off = bridge?.onStatus((value) => { status.value = value; });
  onBeforeUnmount(() => off?.());
  take(bridge?.getStatus());
  return {
    status,
    refresh: () => take(bridge?.getStatus()),
    check: () => take(bridge?.check()),
    install: () => take(bridge?.install()),
    setAutoCheck: (enabled) => take(bridge?.setAutoCheck(enabled)),
    openReleasePage: () => { void bridge?.openReleasePage().catch(() => undefined); },
  };
}
