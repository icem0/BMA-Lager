// Sync-Store: hält den aktuellen Sync-Status aus dem Worker.
// Wird in AppShell als Status-Indikator angezeigt.

import { defineStore } from 'pinia'
import { ref } from 'vue'
import {
  getSyncStatus,
  onSyncStatus,
  startSyncWorker,
  stopSyncWorker,
  type SyncStatus,
} from '../services/sync/worker'

export const useSyncStore = defineStore('sync', () => {
  const status = ref<SyncStatus>(getSyncStatus())

  function bind(): void {
    onSyncStatus((next) => {
      status.value = next
    })
  }

  function start(opts: {
    apiBase: string
    getToken: () => string | null
    intervalSek?: number
  }): void {
    bind()
    startSyncWorker(opts)
  }

  function stop(): void {
    stopSyncWorker()
  }

  return { status, start, stop, bind }
})
