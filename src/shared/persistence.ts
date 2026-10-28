export interface PersistenceBatch { tabs: number[]; network: boolean }
interface PersistenceDependencies {
  write(batch: PersistenceBatch): Promise<void>;
  report(error: unknown): void;
  schedule?: (callback: () => void, milliseconds: number) => void;
}

const BATCH_DELAY = 1000;
const MAX_RETRIES = 5;

/** Coalesce storage writes and recover transient failures without an idle polling loop. */
export function createBatchedPersistence(dependencies: PersistenceDependencies): {
  mark(tabId: number, network?: boolean): void;
  forgetTab(tabId: number): void;
} {
  const schedule = dependencies.schedule || ((callback, milliseconds) => { setTimeout(callback, milliseconds); });
  const tabs = new Set<number>();
  let dirty = false;
  let network = false;
  let scheduled = false;
  let writing = false;
  let failures = 0;

  function later(milliseconds: number): void {
    if (scheduled || writing || !dirty) return;
    scheduled = true;
    schedule(() => { scheduled = false; void flush(); }, milliseconds);
  }

  async function flush(): Promise<void> {
    if (writing || !dirty) return;
    const batch = { tabs: [...tabs], network };
    tabs.clear(); dirty = false; network = false; writing = true;
    try {
      await dependencies.write(batch);
      failures = 0;
    } catch (error) {
      dirty = true; network ||= batch.network;
      for (const tabId of batch.tabs) tabs.add(tabId);
      failures++;
      dependencies.report(error);
    } finally {
      writing = false;
      // Six attempts total. Persistent failures stop waking the worker; the next
      // real event starts a new bounded cycle and includes unsaved changes.
      if (dirty && failures <= MAX_RETRIES) later(failures ? BATCH_DELAY * 2 ** (failures - 1) : BATCH_DELAY);
    }
  }

  return {
    mark(tabId, isNetwork = false) {
      dirty = true; network ||= isNetwork;
      if (tabId >= 0) tabs.add(tabId);
      if (!writing && !scheduled && failures > MAX_RETRIES) failures = 0;
      later(BATCH_DELAY);
    },
    forgetTab(tabId) { tabs.delete(tabId); },
  };
}
