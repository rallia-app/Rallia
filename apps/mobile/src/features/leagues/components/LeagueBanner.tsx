/**
 * LeagueBanner
 *
 * Every league banner renders in the same 2.4:1 box, so cards in a list and
 * the detail hero share one shape — the league twin of TournamentBanner, and
 * the same ratio so both modules' cards sit together visually.
 */

import React from 'react';
import type { ImageStyle, StyleProp } from 'react-native';
import { Image } from 'react-native';
import { getLeagueLogoUrl } from '@rallia/shared-utils';

import { DEFAULT_LEAGUE_BANNER } from '../defaultBanner';

/** Display ratio for every league banner. Matches TOURNAMENT_BANNER_ASPECT. */
export const LEAGUE_BANNER_ASPECT = 2.4;

export const LeagueBanner: React.FC<{
  logoUrl: string | null;
  style?: StyleProp<ImageStyle>;
}> = ({ logoUrl, style }) => {
  const uri = logoUrl ? (getLeagueLogoUrl(logoUrl) ?? logoUrl) : null;
  return (
    <Image
      source={uri ? { uri } : DEFAULT_LEAGUE_BANNER}
      // `height: undefined` is load-bearing: a require()d asset carries its
      // intrinsic width/height as default styles, and aspectRatio is ignored
      // when both are set — see TournamentBanner for the full story.
      style={[{ width: '100%', height: undefined, aspectRatio: LEAGUE_BANNER_ASPECT }, style]}
      resizeMode="cover"
    />
  );
};

export default LeagueBanner;
