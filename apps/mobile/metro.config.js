const { getSentryExpoConfig } = require('@sentry/react-native/metro');
const { withNativeWind } = require('nativewind/metro');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

// Use Sentry's config wrapper with a custom getDefaultConfig callback
// so the SVG transformer is set BEFORE Sentry wraps it (preserving debug ID injection)
const config = getSentryExpoConfig(projectRoot, {
  getDefaultConfig: (projRoot, options) => {
    const { getDefaultConfig } = require('expo/metro-config');
    const defaultConfig = getDefaultConfig(projRoot, options);

    // Configure SVG transformer inside the callback so Sentry wraps it correctly
    defaultConfig.transformer = {
      ...defaultConfig.transformer,
      babelTransformerPath: require.resolve('react-native-svg-transformer'),
    };
    defaultConfig.resolver = {
      ...defaultConfig.resolver,
      assetExts: defaultConfig.resolver.assetExts.filter(ext => ext !== 'svg'),
      sourceExts: [...defaultConfig.resolver.sourceExts, 'svg'],
    };

    return defaultConfig;
  },
});

// Monorepo: look for modules in both local and root node_modules
config.resolver = {
  ...config.resolver,
  nodeModulesPaths: [
    path.resolve(projectRoot, 'node_modules'),
    path.resolve(workspaceRoot, 'node_modules'),
  ],
  extraNodeModules: {
    'react-native-web': path.resolve(workspaceRoot, 'node_modules/react-native-web'),
  },
};

// Watch workspace packages
config.watchFolders = [workspaceRoot];

// Apply NativeWind
module.exports = withNativeWind(config);
