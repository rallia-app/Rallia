/**
 * Re-export useAuth from AuthContext
 *
 * This uses the mobile-specific AuthProvider which includes:
 * - AppState listener for proper token refresh
 * - Single source of truth for auth state
 * - Session validation
 */
export { useAuth } from '#/context/AuthContext';
export type { AuthContextType, OAuthProvider, AuthResult } from '#/context/AuthContext';
