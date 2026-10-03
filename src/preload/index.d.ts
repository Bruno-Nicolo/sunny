import type { LepisApi } from '../shared/contracts'

declare global {
  interface Window {
    lepis: LepisApi
  }
}
