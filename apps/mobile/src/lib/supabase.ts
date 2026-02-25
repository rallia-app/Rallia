/**
 * Mobile-specific Supabase configuration
 *
 * Configures the shared-services Supabase client for React Native with:
 * - AsyncStorage for session persistence
 * - URL polyfill for fetch compatibility
 * - Proper auth settings for mobile
 *
 * IMPORTANT: This file must be imported FIRST in App.tsx (before any other
 * imports that use @rallia/shared-services or @rallia/shared-hooks) to ensure
 * the Supabase client is configured before any hooks or components use it.
 *
 * @see https://supabase.com/docs/guides/auth/quickstarts/with-expo-react-native-social-auth
 */
import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { configureSupabaseStorage, setTourStorageAdapter } from '@rallia/shared-services';
import { setHooksStorageAdapter } from '@rallia/shared-hooks';

/**
 * Configure the shared-services Supabase client with AsyncStorage
 *
 * This configures the single Supabase client used throughout the app.
 * All shared hooks (usePlayerSports, PlayerContext, etc.) and the
 * AuthContext will use this same configured client.
 *
 * The configureSupabaseStorage function recreates the client with
 * AsyncStorage as the storage adapter, ensuring session persistence
 * works correctly in React Native.
 */
const configuredClient = configureSupabaseStorage(AsyncStorage);

/**
 * Configure storage adapters for shared packages
 *
 * This ensures all shared-services and shared-hooks that need persistence
 * (tour progress, analytics time range, etc.) use AsyncStorage on mobile.
 */
setTourStorageAdapter(AsyncStorage);
setHooksStorageAdapter(AsyncStorage);

// Export the configured client for use in the mobile app
export const supabase = configuredClient;
