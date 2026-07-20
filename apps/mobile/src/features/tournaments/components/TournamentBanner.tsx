/**
 * TournamentBanner
 *
 * Every tournament banner renders in the same 2.4:1 box, so cards in a list and
 * heroes across tournaments all share one shape.
 *
 * 2.4:1 is not arbitrary: the bundled fallback art and the official Série 1
 * banners are all 1080x450, so the artwork the app ships renders with zero
 * crop. Organizer uploads vary wildly (square and 4:3 are common in practice),
 * and those get a center crop — which is what a banner box does to any image
 * that isn't already banner-shaped. Rendering each image at its own ratio was
 * tried and looked broken: it made every card a different height and turned
 * square uploads into very tall, heavily cropped panels.
 */

import React from 'react';
import type { ImageStyle, StyleProp } from 'react-native';
import { Image } from 'react-native';
import { getTournamentLogoUrl } from '@rallia/shared-utils';

import { DEFAULT_TOURNAMENT_BANNER } from '../defaultBanner';

/** Display ratio for every tournament banner. Matches the bundled art (1080x450)
 *  and the wizard's upload cropper, so first-party banners are never cropped. */
export const TOURNAMENT_BANNER_ASPECT = 2.4;

export const TournamentBanner: React.FC<{
  logoUrl: string | null;
  style?: StyleProp<ImageStyle>;
}> = ({ logoUrl, style }) => {
  const uri = logoUrl ? (getTournamentLogoUrl(logoUrl) ?? logoUrl) : null;
  return (
    <Image
      source={uri ? { uri } : DEFAULT_TOURNAMENT_BANNER}
      // `height: undefined` is load-bearing: a require()d asset carries its
      // intrinsic width/height as default styles, and aspectRatio is ignored
      // when both are set — the bundled banner rendered 450pt tall until this
      // cleared it. Remote {uri} images have no intrinsic size, so they were
      // unaffected, which is why only default-banner tournaments looked wrong.
      style={[{ width: '100%', height: undefined, aspectRatio: TOURNAMENT_BANNER_ASPECT }, style]}
      resizeMode="cover"
    />
  );
};

export default TournamentBanner;
