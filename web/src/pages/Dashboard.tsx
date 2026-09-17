import { useAuth } from '../auth/AuthProvider'
import { AppLauncher } from '../components/AppLauncher'
import { LazyLobby } from '../lobby/LazyLobby'

/**
 * The signed-in surface: the same Aicountly Lobby a visitor sees, plus the
 * cross-product app launcher and a way out.
 *
 * Nothing about signing in changed — the portal round-trip in AuthProvider is
 * untouched, and this page still only renders once it has succeeded.
 */
export default function Dashboard() {
  const { signOut } = useAuth()

  return (
    <LazyLobby
      actions={
        <button type="button" className="lobby-button" onClick={signOut}>
          Log out
        </button>
      }
    >
      <AppLauncher />
    </LazyLobby>
  )
}
