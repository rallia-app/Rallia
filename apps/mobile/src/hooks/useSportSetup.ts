import { useState, useCallback } from 'react';
import { supabase, Logger } from '@rallia/shared-services';
import { usePlayer } from '@rallia/shared-hooks';
import { useToast } from '@rallia/shared-components';
import { useSport } from '../context';
import { useUserLocation } from './useUserLocation';
import { useTranslation } from './useTranslation';
import { withTimeout, getNetworkErrorMessage } from '../utils/networkTimeout';
import { SheetManager } from 'react-native-actions-sheet';

interface UseSportSetupOptions {
  userId: string;
  onComplete: (sportId: string, sportName: string) => void;
  onCancel: () => void;
}

/**
 * Reusable hook for mandatory first-time sport activation setup flow.
 * Creates player_sport entry, then opens a single wizard sheet with
 * rating + preferences steps. Cleans up if user cancels.
 */
export function useSportSetup({ userId, onComplete, onCancel }: UseSportSetupOptions) {
  const [isSettingUp, setIsSettingUp] = useState(false);

  const toast = useToast();
  const { t } = useTranslation();
  const { location } = useUserLocation();
  const { refetch: refetchPlayer } = usePlayer();
  const { refetch: refetchSportContext } = useSport();

  const startSetup = useCallback(
    async (sportId: string, sportName: 'tennis' | 'pickleball') => {
      if (isSettingUp) return;
      setIsSettingUp(true);

      try {
        // Step 1: Create player_sport entry
        const insertResult = await withTimeout(
          (async () =>
            supabase
              .from('player_sport')
              .insert({
                player_id: userId,
                sport_id: sportId,
                is_active: true,
                is_primary: false,
              })
              .select('id')
              .single())(),
          10000,
          'Failed to create sport profile - connection timeout'
        );

        if (insertResult.error) throw insertResult.error;
        const newPlayerSportId = insertResult.data?.id;
        if (!newPlayerSportId) {
          throw new Error('Failed to create player sport entry');
        }

        // Cleanup function to delete player_sport if setup is cancelled
        const cleanupOnCancel = async () => {
          try {
            await supabase.from('player_sport').delete().eq('id', newPlayerSportId);
            toast.info(t('alerts.sportSetupCancelled'));
          } catch (cleanupError) {
            Logger.error('Failed to cleanup player_sport on cancel', cleanupError as Error, {
              playerSportId: newPlayerSportId,
            });
          }
          setIsSettingUp(false);
          onCancel();
        };

        // Step 2: Open wizard sheet with both rating + preferences steps
        SheetManager.show('sport-setup-wizard', {
          payload: {
            sportName,
            sportId,
            playerSportId: newPlayerSportId,
            userId,
            latitude: location?.latitude ?? null,
            longitude: location?.longitude ?? null,
            onComplete: async () => {
              SheetManager.hide('sport-setup-wizard');

              // Refresh contexts
              await refetchPlayer();
              await refetchSportContext();

              toast.success(t('alerts.sportAdded', { sport: sportName }));

              setIsSettingUp(false);
              onComplete(sportId, sportName);
            },
            onCancel: async () => {
              SheetManager.hide('sport-setup-wizard');
              await cleanupOnCancel();
            },
          },
        });
      } catch (error) {
        Logger.error('Failed to start mandatory sport setup', error as Error, {
          sportId,
          sportName,
        });
        toast.error(getNetworkErrorMessage(error));
        setIsSettingUp(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isSettingUp, userId, location]
  );

  return { startSetup, isSettingUp };
}
