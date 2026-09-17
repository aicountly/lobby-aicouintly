/**
 * Picks the adapter the reception desk talks to.
 *
 * `demo` is the default and is what a fresh clone runs. Switching to `live` is
 * a deliberate build-time choice (VITE_LOBBY_SERVICE_MODE=live), and there is
 * no runtime path from one to the other: the interface holds whichever adapter
 * this returns and cannot reach the other one.
 */
import { LOBBY_SERVICE_MODE } from '../lobbyConfig'
import { demoAdapter } from './demoAdapter'
import { liveAdapter } from './liveAdapter'
import type { LobbyServiceAdapter } from './types'

export function getLobbyServices(): LobbyServiceAdapter {
  return LOBBY_SERVICE_MODE === 'live' ? liveAdapter : demoAdapter
}

export { describeIntegrations } from './liveAdapter'
export type { IntegrationStatus } from './liveAdapter'
