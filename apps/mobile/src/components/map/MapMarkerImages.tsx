import React, { memo } from 'react';
import { View, StyleSheet } from 'react-native';
import Mapbox from '@rnmapbox/maps';
import { Ionicons } from '@expo/vector-icons';
import { primary, accent, base } from '@rallia/design-system';
import { SportIcon } from '../SportIcon';

interface MapMarkerImagesProps {
  isDark: boolean;
}

/** Shared glass marker RN view — rasterized once into the GL texture atlas. */
function GlassMarkerImage({
  color,
  glowColor,
  isDark,
  children,
  isSelected,
}: {
  color: string;
  glowColor: string;
  isDark: boolean;
  children: React.ReactNode;
  isSelected?: boolean;
}) {
  const size = isSelected ? 52 : 48;
  const bodySize = isSelected ? 40 : 36;
  const bodyRadius = bodySize / 2;

  return (
    <View style={styles.container} collapsable={false}>
      {/* Glow ring */}
      <View
        style={[
          styles.glow,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: glowColor,
          },
          isSelected && {
            borderWidth: 2,
            borderColor: isDark ? `${base.white}40` : `${color}80`,
          },
        ]}
      >
        {/* Glass body */}
        <View
          style={[
            styles.body,
            {
              width: bodySize,
              height: bodySize,
              borderRadius: bodyRadius,
              backgroundColor: isDark ? `${color}B3` : `${color}CC`,
              borderColor: isDark ? `${base.white}30` : `${base.white}60`,
            },
          ]}
        >
          {/* Specular highlight */}
          <View
            style={[
              styles.highlight,
              {
                borderTopLeftRadius: bodyRadius,
                borderTopRightRadius: bodyRadius,
                backgroundColor: isDark ? `${base.white}15` : `${base.white}30`,
              },
            ]}
          />
          {children}
        </View>
      </View>
      {/* Bottom dot */}
      <View style={[styles.dot, { backgroundColor: isDark ? `${color}CC` : color }]} />
    </View>
  );
}

/** Glass cluster bubble — rasterized into the GL texture atlas (no icon, no bottom dot). */
function GlassClusterImage({
  color,
  glowColor,
  isDark,
  size,
}: {
  color: string;
  glowColor: string;
  isDark: boolean;
  size: 'sm' | 'md' | 'lg';
}) {
  const outerSize = size === 'lg' ? 64 : size === 'md' ? 54 : 46;
  const bodySize = size === 'lg' ? 50 : size === 'md' ? 42 : 36;
  const bodyRadius = bodySize / 2;

  return (
    <View
      style={{
        width: outerSize,
        height: outerSize,
        alignItems: 'center',
        justifyContent: 'center',
      }}
      collapsable={false}
    >
      {/* Glow ring */}
      <View
        style={[
          styles.glow,
          {
            width: outerSize,
            height: outerSize,
            borderRadius: outerSize / 2,
            backgroundColor: glowColor,
            borderWidth: 2,
            borderColor: isDark ? `${base.white}25` : `${color}40`,
          },
        ]}
      >
        {/* Glass body */}
        <View
          style={[
            styles.body,
            {
              width: bodySize,
              height: bodySize,
              borderRadius: bodyRadius,
              backgroundColor: isDark ? `${color}B3` : `${color}CC`,
              borderColor: isDark ? `${base.white}30` : `${base.white}60`,
            },
          ]}
        >
          {/* Specular highlight — shorter than marker highlight to keep text centered */}
          <View
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: bodySize * 0.35,
              borderTopLeftRadius: bodyRadius,
              borderTopRightRadius: bodyRadius,
              backgroundColor: isDark ? `${base.white}15` : `${base.white}25`,
            }}
          />
        </View>
      </View>
    </View>
  );
}

function MapMarkerImagesInner({ isDark }: MapMarkerImagesProps) {
  const primaryColor = isDark ? primary[400] : primary[500];
  const accentColor = isDark ? accent[400] : accent[500];
  const primaryGlow = isDark ? `${primary[400]}30` : `${primary[500]}20`;
  const accentGlow = isDark ? `${accent[400]}30` : `${accent[500]}20`;

  return (
    <Mapbox.Images>
      <Mapbox.Image name="marker-facility">
        <GlassMarkerImage color={primaryColor} glowColor={primaryGlow} isDark={isDark}>
          <Ionicons name="business" size={16} color={base.white} />
        </GlassMarkerImage>
      </Mapbox.Image>

      <Mapbox.Image name="marker-facility-selected">
        <GlassMarkerImage color={primaryColor} glowColor={primaryGlow} isDark={isDark} isSelected>
          <Ionicons name="business" size={18} color={base.white} />
        </GlassMarkerImage>
      </Mapbox.Image>

      <Mapbox.Image name="marker-match-tennis">
        <GlassMarkerImage color={accentColor} glowColor={accentGlow} isDark={isDark}>
          <SportIcon sportName="tennis" size={16} color={base.white} />
        </GlassMarkerImage>
      </Mapbox.Image>

      <Mapbox.Image name="marker-match-pickleball">
        <GlassMarkerImage color={accentColor} glowColor={accentGlow} isDark={isDark}>
          <SportIcon sportName="pickleball" size={16} color={base.white} />
        </GlassMarkerImage>
      </Mapbox.Image>

      {/* Cluster bubbles — 3 sizes × 2 colors */}
      <Mapbox.Image name="cluster-facility-sm">
        <GlassClusterImage color={primaryColor} glowColor={primaryGlow} isDark={isDark} size="sm" />
      </Mapbox.Image>
      <Mapbox.Image name="cluster-facility-md">
        <GlassClusterImage color={primaryColor} glowColor={primaryGlow} isDark={isDark} size="md" />
      </Mapbox.Image>
      <Mapbox.Image name="cluster-facility-lg">
        <GlassClusterImage color={primaryColor} glowColor={primaryGlow} isDark={isDark} size="lg" />
      </Mapbox.Image>
      <Mapbox.Image name="cluster-match-sm">
        <GlassClusterImage color={accentColor} glowColor={accentGlow} isDark={isDark} size="sm" />
      </Mapbox.Image>
      <Mapbox.Image name="cluster-match-md">
        <GlassClusterImage color={accentColor} glowColor={accentGlow} isDark={isDark} size="md" />
      </Mapbox.Image>
      <Mapbox.Image name="cluster-match-lg">
        <GlassClusterImage color={accentColor} glowColor={accentGlow} isDark={isDark} size="lg" />
      </Mapbox.Image>
    </Mapbox.Images>
  );
}

export const MapMarkerImages = memo(MapMarkerImagesInner);

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
  },
  glow: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  highlight: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 16,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 3,
  },
});
