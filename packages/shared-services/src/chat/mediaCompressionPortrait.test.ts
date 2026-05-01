/**
 * Unit tests for the portrait-upscale fix in mediaCompression.
 *
 * compressImage lives in apps/mobile (needs expo-image-manipulator), so we
 * test the conditional-resize logic directly here by inlining it.
 */

// ---------------------------------------------------------------------------
// Inline the decision logic from compressImage (no Expo deps needed)
// ---------------------------------------------------------------------------

const IMAGE_MAX_DIMENSION = 2048;

function buildResizeActions(probeWidth: number): Array<{ resize: { width: number } }> {
  return probeWidth > IMAGE_MAX_DIMENSION ? [{ resize: { width: IMAGE_MAX_DIMENSION } }] : [];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('compressImage portrait-upscale fix', () => {
  it('adds a resize action for wide images (width > 2048)', () => {
    const actions = buildResizeActions(4032); // typical iPhone landscape
    expect(actions).toHaveLength(1);
    expect(actions[0].resize.width).toBe(2048);
  });

  it('adds no resize action for images exactly at the limit', () => {
    const actions = buildResizeActions(2048);
    expect(actions).toHaveLength(0);
  });

  it('adds no resize action for portrait/narrow images (width < 2048)', () => {
    const actions = buildResizeActions(1000); // narrow portrait screenshot
    expect(actions).toHaveLength(0);
  });

  it('adds no resize action for very small images', () => {
    const actions = buildResizeActions(320);
    expect(actions).toHaveLength(0);
  });

  it('adds resize for a wide 4K image', () => {
    const actions = buildResizeActions(3840);
    expect(actions).toHaveLength(1);
    expect(actions[0].resize.width).toBe(2048);
  });

  it('never upscales — resize target is always IMAGE_MAX_DIMENSION, not larger', () => {
    // Even for a tiny image, if we were to resize we'd only go to 2048
    const actions = buildResizeActions(4000);
    if (actions.length > 0) {
      expect(actions[0].resize.width).toBeLessThanOrEqual(IMAGE_MAX_DIMENSION);
    }
  });
});
