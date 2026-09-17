/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string
  readonly VITE_APP_NAME: string
  readonly VITE_APP_ENV: string
  /** Portal authentication_jump key. Defaults to the hostname's product. */
  readonly VITE_PRODUCT_KEY: string
  /** Overrides the login portal origin. For local development only. */
  readonly VITE_PORTAL_LOGIN_URL: string
  /** GA4 measurement ID for this product. Analytics is disabled when unset. */
  readonly VITE_GA4_SAAS_RECEPTIONIST_MEASUREMENT_ID?: string
  /** Generic GA4 measurement ID fallback, checked when the product-specific one is unset. */
  readonly VITE_GA4_MEASUREMENT_ID?: string

  /** Path served as the public, sign-in-free visitor lobby. Empty withdraws it. */
  readonly VITE_LOBBY_PUBLIC_PATH?: string
  /** `demo` (default) or `live`. Which service adapter the reception desk uses. */
  readonly VITE_LOBBY_SERVICE_MODE?: string
  /** Base URL of the Aicountly Appointments API. Appointments owns booking. */
  readonly VITE_LOBBY_APPOINTMENTS_API_BASE_URL?: string
  /** Path on this product's own API that fronts the reception AI. Never a key. */
  readonly VITE_LOBBY_RECEPTION_AI_PATH?: string
  /** Optional runtime asset manifest for replacing procedural 3D placeholders. */
  readonly VITE_LOBBY_ASSET_MANIFEST_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
