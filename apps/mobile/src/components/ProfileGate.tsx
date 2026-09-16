/**
 * ProfileGate - blocks the app while the signed-in user's profile is unresolved.
 *
 * Every "is this player onboarded?" read in the app comes from the profile.
 * While that profile is still loading or could not be fetched, the answer is
 * unknown, and rendering the app anyway shows a veteran the guest / not-yet-
 * onboarded UI and lets them act on it. This overlay covers the whole surface
 * until the profile resolves: it retries with backoff, on reconnect and on
 * foreground, offers a manual retry, and (after repeated failures while
 * online) a sign-out escape hatch. It never routes into the onboarding wizard.
 *
 * Rendered as a sibling above the app tree, not instead of it, so navigation
 * state survives a mid-session block. Under the native splash it is invisible;
 * once the splash hides (SplashGate's 5 s safety timeout included) it is what
 * the user sees.
 */

import React, { useCallback, useEffect, useRef, useState, type PropsWithChildren } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Heading, Spinner, Text, useNetwork } from '@rallia/shared-components';
import { useProfile, type ProfileStatus } from '@rallia/shared-hooks';
import { Logger } from '@rallia/shared-services';
import { spacingPixels } from '@rallia/design-system';

import { useAuth, useThemeStyles, useTranslation } from '#/hooks';
import { useOverlay } from '#/context';
import { profileGateShown, profileGateResolved } from '#/services/analytics';

import { ThemeLogo } from './ThemeLogo';

const RETRY_BASE_MS = 1000;
const RETRY_MAX_MS = 15000;
const SIGN_OUT_AFTER_ATTEMPTS = 3;

type BlockedStatus = Extract<ProfileStatus, 'loading' | 'unavailable'>;

function isBlockedStatus(status: ProfileStatus): status is BlockedStatus {
  return status === 'loading' || status === 'unavailable';
}

export function ProfileGate({ children }: PropsWithChildren) {
  const { session } = useAuth();
  const { status } = useProfile();

  const blocked = !!session && isBlockedStatus(status);

  return (
    <>
      {children}
      {blocked ? <ProfileGateOverlay status={status} /> : null}
    </>
  );
}

// Mounted only while blocked, so retry state starts fresh on every episode.
function ProfileGateOverlay({ status }: { status: BlockedStatus }) {
  const { signOut } = useAuth();
  const { refetch } = useProfile();
  const { isOffline } = useNetwork();
  const { isSplashComplete } = useOverlay();
  const { colors } = useThemeStyles();
  const { t } = useTranslation();

  const [attempts, setAttempts] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const attemptsRef = useRef(0);
  const mountedAtRef = useRef(0);
  const reportedRef = useRef(false);
  const outcomeRef = useRef<'resolved' | 'signed_out'>('resolved');
  const wasOfflineRef = useRef(isOffline);

  const retry = useCallback(() => {
    attemptsRef.current += 1;
    setAttempts(attemptsRef.current);
    void refetch();
  }, [refetch]);

  // Exponential backoff while the fetch keeps failing.
  useEffect(() => {
    if (status !== 'unavailable') return;
    const delay = Math.min(RETRY_BASE_MS * 2 ** attempts, RETRY_MAX_MS);
    const timer = setTimeout(retry, delay);
    return () => clearTimeout(timer);
  }, [status, attempts, retry]);

  // Retry right away when connectivity comes back.
  useEffect(() => {
    if (wasOfflineRef.current && !isOffline && status === 'unavailable') retry();
    wasOfflineRef.current = isOffline;
  }, [isOffline, status, retry]);

  // And when the app returns to the foreground.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active' && status === 'unavailable') retry();
    });
    return () => subscription.remove();
  }, [status, retry]);

  // Report once, and only once the user can actually see the overlay.
  useEffect(() => {
    if (!isSplashComplete || reportedRef.current) return;
    reportedRef.current = true;
    Logger.warn('Profile gate shown: onboarding status unresolved', { status, offline: isOffline });
    profileGateShown({ status, offline: isOffline });
  }, [isSplashComplete, status, isOffline]);

  useEffect(() => {
    mountedAtRef.current = Date.now();
    return () => {
      if (!reportedRef.current) return;
      profileGateResolved({
        outcome: outcomeRef.current,
        duration_ms: Date.now() - mountedAtRef.current,
        attempts: attemptsRef.current,
      });
    };
  }, []);

  const handleRetry = useCallback(() => {
    setRetrying(true);
    attemptsRef.current += 1;
    setAttempts(attemptsRef.current);
    void refetch().finally(() => setRetrying(false));
  }, [refetch]);

  const handleSignOut = useCallback(() => {
    outcomeRef.current = 'signed_out';
    void signOut();
  }, [signOut]);

  // Once a fetch has failed, keep the error layout through automatic retries
  // instead of flickering back to the spinner every backoff step.
  const showError = status === 'unavailable' || attempts > 0;
  const showSignOut = attempts >= SIGN_OUT_AFTER_ATTEMPTS && !isOffline;

  return (
    <View
      style={[styles.overlay, { backgroundColor: colors.background }]}
      accessibilityViewIsModal
      testID="profile-gate"
    >
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.content}>
          <ThemeLogo width={140} height={42} style={styles.logo} />

          {showError ? (
            <>
              <Heading level={3} align="center">
                {t('profileGate.unavailable.title')}
              </Heading>
              <Text variant="body" color={colors.textMuted} align="center">
                {isOffline
                  ? t('profileGate.unavailable.descriptionOffline')
                  : t('profileGate.unavailable.description')}
              </Text>
            </>
          ) : (
            <>
              <Spinner size="lg" />
              <Text variant="caption" color={colors.textMuted} align="center">
                {t('profileGate.loading')}
              </Text>
            </>
          )}
        </View>

        {showError ? (
          <View style={styles.footer}>
            <Button
              variant="primary"
              size="lg"
              fullWidth
              loading={retrying || status === 'loading'}
              onPress={handleRetry}
            >
              {t('profileGate.unavailable.retry')}
            </Button>
            {showSignOut ? (
              <Button variant="ghost" size="md" fullWidth onPress={handleSignOut}>
                {t('profileGate.unavailable.signOut')}
              </Button>
            ) : null}
          </View>
        ) : null}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    // Below the OfflineIndicator banner (9998), above everything else.
    zIndex: 9997,
    elevation: 9997,
  },
  safeArea: {
    flex: 1,
    paddingHorizontal: spacingPixels[6],
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacingPixels[4],
  },
  logo: {
    marginBottom: spacingPixels[4],
  },
  footer: {
    gap: spacingPixels[2],
    paddingBottom: spacingPixels[6],
  },
});

export default ProfileGate;
