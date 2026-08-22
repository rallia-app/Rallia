/**
 * Sessions pane: the open season's scheduled sessions, and the organizer's create/publish controls.
 */

import React from 'react';
import { View, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@rallia/shared-components';
import type { Season, Session } from '@rallia/shared-services';

import { SESSION_STATUS_KEY, Section, type ScreenColors, type SessionStatus } from './components';
import type { TranslationKey } from '../../../hooks';
import { styles } from './detailStyles';

interface SessionsTabProps {
  colors: ScreenColors;
  t: (key: TranslationKey) => string;
  isOrganizer: boolean;
  openSeason: Season | undefined;
  seasonSessions: Session[];
  /** Renders a session's evening or play window, per formatSessionWhen. */
  formatSessionWhen: (s: Session) => string;
  sessionPill: (status: SessionStatus) => { bg: string; fg: string };
  handleOpenSession: (sessionId: string, name: string) => void;
  handleOpenCreateSession: () => void;
  handlePublishSession: (sessionId: string, version: number) => void;
  isPublishingSession: boolean;
}

export const SessionsTab: React.FC<SessionsTabProps> = ({
  colors,
  t,
  isOrganizer,
  openSeason,
  seasonSessions,
  formatSessionWhen,
  sessionPill,
  handleOpenSession,
  handleOpenCreateSession,
  handlePublishSession,
  isPublishingSession,
}) => (
  <View style={styles.tabContent}>
    {!openSeason ? (
      <Section title={t('leagueDetail.sessions.title')} colors={colors}>
        <View style={styles.participantEmpty}>
          <Text size="sm" color={colors.textMuted} style={styles.sessionEmptyText}>
            {t('leagueDetail.sessions.needOpenSeason')}
          </Text>
        </View>
      </Section>
    ) : (
      <>
        <Section title={t('leagueDetail.sessions.title')} colors={colors}>
          {seasonSessions.length === 0 ? (
            <View style={styles.participantEmpty}>
              <Text size="sm" color={colors.textMuted}>
                {t('leagueDetail.sessions.empty')}
              </Text>
            </View>
          ) : (
            seasonSessions.map(s => {
              const pill = sessionPill(s.status);
              return (
                <TouchableOpacity
                  key={s.id}
                  onPress={() => handleOpenSession(s.id, s.name)}
                  activeOpacity={0.7}
                  style={[styles.seasonRow, { borderBottomColor: colors.border }]}
                  testID={`session-row-${s.id}`}
                >
                  <View style={styles.seasonRowMain}>
                    <Text size="base" weight="semibold" color={colors.text}>
                      {s.name}
                    </Text>
                    <Text size="xs" color={colors.textMuted}>
                      {formatSessionWhen(s)}
                    </Text>
                  </View>
                  <View style={styles.seasonRowActions}>
                    <View style={[styles.seasonStatusPill, { backgroundColor: pill.bg }]}>
                      <Text size="xs" weight="semibold" color={pill.fg}>
                        {t(SESSION_STATUS_KEY[s.status] as TranslationKey)}
                      </Text>
                    </View>
                    {isOrganizer && s.status === 'draft' && (
                      <TouchableOpacity
                        onPress={() => handlePublishSession(s.id, s.version)}
                        disabled={isPublishingSession}
                        testID="cta-publish-session"
                        style={[styles.seasonActionButton, { borderColor: colors.primary }]}
                      >
                        <Text size="sm" weight="semibold" color={colors.primary}>
                          {t('leagueDetail.sessions.publish')}
                        </Text>
                      </TouchableOpacity>
                    )}
                    <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                  </View>
                </TouchableOpacity>
              );
            })
          )}
        </Section>

        {isOrganizer && (
          <TouchableOpacity
            onPress={handleOpenCreateSession}
            style={[styles.primaryButton, { backgroundColor: colors.primary }]}
            testID="cta-create-session"
          >
            <Ionicons name="add-outline" size={20} color="#ffffff" />
            <Text size="base" weight="semibold" color="#ffffff">
              {t('leagueDetail.sessions.submit')}
            </Text>
          </TouchableOpacity>
        )}
      </>
    )}
  </View>
);

export default SessionsTab;
