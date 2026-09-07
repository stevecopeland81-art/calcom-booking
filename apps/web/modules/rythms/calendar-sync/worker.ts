import { runDueSyncs, workerAvailable } from "./service";

const state = globalThis as typeof globalThis & { rythmsBusySyncWorker?: boolean };
export function startCalendarSyncWorker() {
  if (state.rythmsBusySyncWorker || !workerAvailable()) return;
  state.rythmsBusySyncWorker = true;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runDueSyncs();
    } catch {
      console.error("Rythms calendar sync worker could not reach its database.");
    } finally {
      running = false;
    }
  };
  setTimeout(() => void tick(), 5_000).unref();
  setInterval(() => void tick(), 30_000).unref();
}
