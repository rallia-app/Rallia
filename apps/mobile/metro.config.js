const { getSentryExpoConfig } = require('@sentry/react-native/metro');
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

// Packages that MUST resolve to a single physical copy across the workspace.
// npm auto-installs peerDependencies in npm 7+, so workspace packages like
// shared-hooks end up with their own physical copy of @tanstack/react-query
// even with version overrides in place. Same version, different files →
// different module instances → different React Contexts → useQueryClient()
// throws "No QueryClient set". This resolver re-anchors singleton imports to
// apps/mobile's copy so every importer lands on the same physical module.
const SINGLETON_PACKAGES = ['@tanstack/react-query', '@tanstack/query-core'];
const singletonOrigin = path.join(projectRoot, '_metro_singleton_origin.js');

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
  resolveRequest: (context, moduleName, platform) => {
    const isSingleton = SINGLETON_PACKAGES.some(
      pkg => moduleName === pkg || moduleName.startsWith(`${pkg}/`)
    );
    if (isSingleton) {
      return context.resolveRequest(
        { ...context, originModulePath: singletonOrigin },
        moduleName,
        platform
      );
    }
    return context.resolveRequest(context, moduleName, platform);
  },
};

// Watch workspace packages (extend Expo defaults rather than replace)
config.watchFolders = [...(config.watchFolders ?? []), workspaceRoot];

module.exports = config;
