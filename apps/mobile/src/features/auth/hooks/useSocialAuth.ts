/**
 * useSocialAuth Hook
 *
 * Handles native social authentication for Google, Apple, and Facebook.
 * Integrates with Supabase Auth for session management.
 *
 * NOTE: Google and Apple require a development build (not Expo Go).
 * Facebook uses OAuth redirect (expo-web-browser) and works in dev builds.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';
import { supabase } from '../../../lib/supabase';
import { Logger } from '@rallia/shared-services';
import { lightHaptic, successHaptic, warningHaptic } from '@rallia/shared-utils';
import { checkOnboardingStatus, getFriendlyErrorMessage } from '../utils';

// =============================================================================
// TYPES
// =============================================================================

export type SocialProvider = 'google' | 'apple' | 'facebook';

export interface SocialAuthResult {
  success: boolean;
  needsOnboarding: boolean;
  error?: Error;
}

export const FACEBOOK_AUTH_CALLBACK = 'rallia://auth/callback';

/**
 * Parse Supabase OAuth redirect URL (hash fragment) for access_token and refresh_token.
 */
export function parseSessionFromAuthUrl(
  url: string
): { access_token: string; refresh_token: string } | null {
  try {
    const hashIndex = url.indexOf('#');
    if (hashIndex === -1) return null;
    const hash = url.slice(hashIndex + 1);
    const params = new URLSearchParams(hash);
    const access_token = params.get('access_token');
    const refresh_token = params.get('refresh_token');
    if (access_token && refresh_token) {
      return { access_token, refresh_token };
    }
    return null;
  } catch {
    return null;
  }
}

interface UseSocialAuthReturn {
  // State
  isLoading: boolean;
  loadingProvider: SocialProvider | null;
  errorMessage: string;

  // Actions
  signInWithGoogle: () => Promise<SocialAuthResult>;
  signInWithApple: () => Promise<SocialAuthResult>;
  signInWithFacebook: () => Promise<SocialAuthResult>;

  // Utilities
  isAppleSignInAvailable: boolean;
  isNativeBuild: boolean;
}

// =============================================================================
// EXPO GO DETECTION
// =============================================================================

/**
 * Check if we're running in Expo Go (which doesn't support native modules)
 */
function isExpoGo(): boolean {
  return Constants.appOwnership === 'expo';
}

// =============================================================================
// CONFIGURATION
// =============================================================================

// Configure Google Sign-In
const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || '';
const GOOGLE_IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || '';

// Lazy-loaded native modules (only available in dev builds, not Expo Go)
let GoogleSignin: typeof import('@react-native-google-signin/google-signin').GoogleSignin | null =
  null;
let statusCodes: typeof import('@react-native-google-signin/google-signin').statusCodes | null =
  null;
let isSuccessResponse:
  | typeof import('@react-native-google-signin/google-signin').isSuccessResponse
  | null = null;
let isErrorWithCode:
  | typeof import('@react-native-google-signin/google-signin').isErrorWithCode
  | null = null;

let nativeModulesInitialized = false;

/**
 * Initialize native modules lazily (only in dev builds)
 */
async function initializeNativeModules(): Promise<boolean> {
  if (nativeModulesInitialized) return true;
  if (isExpoGo()) {
    Logger.debug('Running in Expo Go - native social auth modules not available');
    return false;
  }

  let googleInitialized = false;

  // Initialize Google Sign-In
  try {
    const googleModule = await import('@react-native-google-signin/google-signin');
    GoogleSignin = googleModule.GoogleSignin;
    statusCodes = googleModule.statusCodes;
    isSuccessResponse = googleModule.isSuccessResponse;
    isErrorWithCode = googleModule.isErrorWithCode;

    // Configure Google Sign-In
    // webClientId is used on both platforms per Supabase docs
    // iosClientId is additionally needed on iOS for the native SDK
    GoogleSignin.configure({
      webClientId: GOOGLE_WEB_CLIENT_ID,
      ...(Platform.OS === 'ios' ? { iosClientId: GOOGLE_IOS_CLIENT_ID } : {}),
      scopes: ['email', 'profile'],
    });

    googleInitialized = true;
    Logger.debug('Google Sign-In initialized successfully');
  } catch (error) {
    Logger.error('Failed to initialize Google Sign-In', error as Error);
  }

  nativeModulesInitialized = googleInitialized;
  Logger.debug('Native social auth modules initialization complete', {
    google: googleInitialized,
  });
  return nativeModulesInitialized;
}

// =============================================================================
// HOOK
// =============================================================================

export function useSocialAuth(): UseSocialAuthReturn {
  const [isLoading, setIsLoading] = useState(false);
  const [loadingProvider, setLoadingProvider] = useState<SocialProvider | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const initAttempted = useRef(false);

  // Check if we're in a native build (not Expo Go)
  const isNativeBuild = !isExpoGo();

  // Check Apple Sign-In availability (iOS 13+ only)
  const isAppleSignInAvailable =
    Platform.OS === 'ios' && AppleAuthentication.isAvailableAsync !== undefined;

  // Initialize native modules on mount (only in dev builds)
  useEffect(() => {
    if (!initAttempted.current && isNativeBuild) {
      initAttempted.current = true;
      initializeNativeModules();
    }
  }, [isNativeBuild]);

  /**
   * Show Expo Go warning
   */
  const showExpoGoWarning = useCallback((provider: string) => {
    setErrorMessage(
      `${provider} Sign-In requires a development build and is not available in Expo Go.`
    );
  }, []);

  /**
   * Sign in with Google using native SDK
   */
  const signInWithGoogle = useCallback(async (): Promise<SocialAuthResult> => {
    // Check for Expo Go
    if (!isNativeBuild) {
      showExpoGoWarning('Google');
      return { success: false, needsOnboarding: false };
    }

    if (!GoogleSignin) {
      setErrorMessage('Google Sign-In not initialized');
      return { success: false, needsOnboarding: false };
    }

    lightHaptic();
    setIsLoading(true);
    setLoadingProvider('google');
    setErrorMessage('');

    try {
      Logger.logUserAction('social_signin_initiated', { provider: 'google' });

      // Check if Google Play Services are available (Android)
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });

      // Generate a secure random nonce (required for production builds on iOS)
      const rawNonce = Array.from(await Crypto.getRandomBytesAsync(32), byte =>
        byte.toString(16).padStart(2, '0')
      ).join('');
      const hashedNonce = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        rawNonce
      );

      // Reconfigure Google Sign-In with the nonce
      GoogleSignin.configure({
        webClientId: GOOGLE_WEB_CLIENT_ID,
        ...(Platform.OS === 'ios' ? { iosClientId: GOOGLE_IOS_CLIENT_ID } : {}),
        scopes: ['email', 'profile'],
        nonce: hashedNonce,
      });

      // Perform sign-in
      const response = await GoogleSignin.signIn();

      if (!isSuccessResponse || !isSuccessResponse(response)) {
        throw new Error('Google sign-in was cancelled or failed');
      }

      const { idToken } = response.data;

      if (!idToken) {
        throw new Error('No ID token received from Google');
      }

      Logger.debug('Google sign-in successful, authenticating with Supabase');

      // Sign in to Supabase with the Google ID token and raw nonce
      const { data, error } = await supabase.auth.signInWithIdToken({
        provider: 'google',
        token: idToken,
        nonce: rawNonce,
      });

      if (error) {
        Logger.error('Supabase Google auth failed', error);
        throw error;
      }

      if (!data.user) {
        throw new Error('No user returned from Supabase');
      }

      Logger.info('Google sign-in completed successfully', { userId: data.user.id });
      successHaptic();

      const needsOnboarding = await checkOnboardingStatus(data.user.id);

      setIsLoading(false);
      setLoadingProvider(null);
      return { success: true, needsOnboarding };
    } catch (error) {
      setIsLoading(false);
      setLoadingProvider(null);

      // Handle Google Sign-In specific error codes
      if (isErrorWithCode && isErrorWithCode(error) && statusCodes) {
        switch (error.code) {
          case statusCodes.SIGN_IN_CANCELLED:
            Logger.debug('Google sign-in cancelled by user');
            return { success: false, needsOnboarding: false };
          case statusCodes.IN_PROGRESS:
            setErrorMessage('A sign-in is already in progress.');
            break;
          case statusCodes.PLAY_SERVICES_NOT_AVAILABLE: {
            setErrorMessage('Google Play Services is required. Please update it and try again.');
            break;
          }
          default: {
            setErrorMessage(getFriendlyErrorMessage(error));
          }
        }
      } else {
        // User cancelled (our throw) or other error - don't show error for cancel
        const msg = error instanceof Error ? error.message : String(error);
        const isCancelled = msg.toLowerCase().includes('cancelled');
        if (isCancelled) {
          Logger.debug('Google sign-in cancelled by user');
          return { success: false, needsOnboarding: false };
        }
        setErrorMessage(getFriendlyErrorMessage(error));
      }

      Logger.error('Google sign-in error', error as Error);
      warningHaptic();
      return { success: false, needsOnboarding: false, error: error as Error };
    }
  }, [isNativeBuild, showExpoGoWarning]);

  /**
   * Sign in with Apple using native SDK (iOS only)
   */
  const signInWithApple = useCallback(async (): Promise<SocialAuthResult> => {
    lightHaptic();
    setIsLoading(true);
    setLoadingProvider('apple');
    setErrorMessage('');

    try {
      Logger.logUserAction('social_signin_initiated', { provider: 'apple' });

      if (Platform.OS !== 'ios') {
        throw new Error('Apple Sign-In is only available on iOS');
      }

      // Generate a secure random nonce
      const rawNonce = Array.from(await Crypto.getRandomBytesAsync(32), byte =>
        byte.toString(16).padStart(2, '0')
      ).join('');

      // Hash the nonce for Apple (SHA-256)
      const hashedNonce = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        rawNonce
      );

      // Request Apple authentication
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
        nonce: hashedNonce,
      });

      if (!credential.identityToken) {
        throw new Error('No identity token received from Apple');
      }

      Logger.debug('Apple sign-in successful, authenticating with Supabase');

      // Sign in to Supabase with the Apple identity token
      const { data, error } = await supabase.auth.signInWithIdToken({
        provider: 'apple',
        token: credential.identityToken,
        nonce: rawNonce, // Send the raw nonce, not the hashed one
      });

      if (error) {
        Logger.error('Supabase Apple auth failed', error);
        throw error;
      }

      if (!data.user) {
        throw new Error('No user returned from Supabase');
      }

      Logger.info('Apple sign-in completed successfully', { userId: data.user.id });
      successHaptic();

      const needsOnboarding = await checkOnboardingStatus(data.user.id);

      setIsLoading(false);
      setLoadingProvider(null);
      return { success: true, needsOnboarding };
    } catch (error) {
      setIsLoading(false);
      setLoadingProvider(null);

      const appleError = error as { code?: string };

      // Handle user cancellation silently
      if (appleError.code === 'ERR_REQUEST_CANCELED') {
        Logger.debug('Apple sign-in cancelled by user');
        return { success: false, needsOnboarding: false };
      }

      setErrorMessage(getFriendlyErrorMessage(error));
      Logger.error('Apple sign-in error', error as Error);
      warningHaptic();
      return { success: false, needsOnboarding: false, error: error as Error };
    }
  }, []);

  /**
   * Sign in with Facebook using OAuth redirect (browser).
   */
  const signInWithFacebook = useCallback(async (): Promise<SocialAuthResult> => {
    if (!isNativeBuild) {
      showExpoGoWarning('Facebook');
      return { success: false, needsOnboarding: false };
    }

    lightHaptic();
    setIsLoading(true);
    setLoadingProvider('facebook');
    setErrorMessage('');

    try {
      Logger.logUserAction('social_signin_initiated', { provider: 'facebook' });

      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'facebook',
        options: {
          redirectTo: FACEBOOK_AUTH_CALLBACK,
          skipBrowserRedirect: true,
        },
      });

      if (error) {
        Logger.error('Supabase Facebook OAuth error', error);
        throw error;
      }

      if (!data?.url) {
        throw new Error('No OAuth URL returned from Supabase');
      }

      const result = await WebBrowser.openAuthSessionAsync(data.url, FACEBOOK_AUTH_CALLBACK);

      if (result.type !== 'success' || !result.url) {
        Logger.debug('Facebook sign-in cancelled or dismissed');
        setIsLoading(false);
        setLoadingProvider(null);
        return { success: false, needsOnboarding: false };
      }

      const sessionParams = parseSessionFromAuthUrl(result.url);
      if (!sessionParams) {
        throw new Error('Could not parse session from redirect URL');
      }

      const { error: sessionError } = await supabase.auth.setSession({
        access_token: sessionParams.access_token,
        refresh_token: sessionParams.refresh_token,
      });

      if (sessionError) {
        Logger.error('Supabase setSession failed after Facebook auth', sessionError);
        throw sessionError;
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        throw new Error('No user after Facebook sign-in');
      }

      Logger.info('Facebook sign-in completed successfully', { userId: user.id });
      successHaptic();

      const needsOnboarding = await checkOnboardingStatus(user.id);

      setIsLoading(false);
      setLoadingProvider(null);
      return { success: true, needsOnboarding };
    } catch (error) {
      setIsLoading(false);
      setLoadingProvider(null);
      setErrorMessage(getFriendlyErrorMessage(error));
      Logger.error('Facebook sign-in error', error as Error);
      warningHaptic();
      return { success: false, needsOnboarding: false, error: error as Error };
    }
  }, [isNativeBuild, showExpoGoWarning]);

  return {
    isLoading,
    loadingProvider,
    errorMessage,
    signInWithGoogle,
    signInWithApple,
    signInWithFacebook,
    isAppleSignInAvailable,
    isNativeBuild,
  };
}

export default useSocialAuth;
