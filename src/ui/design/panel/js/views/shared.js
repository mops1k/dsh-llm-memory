/** Helpers shared by several screens. */
import { app } from '../state.js'

/** Ask the current screen to reload its data (set by every mount). */
export function refreshCurrent() {
  app.refresh?.()
}
