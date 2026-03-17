const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * Expo config plugin to fix Sentry _SentryPrivate module error
 * Sets APPLICATION_EXTENSION_API_ONLY=NO for Sentry pod
 *
 * Based on: https://docs.sentry.io/platforms/react-native/troubleshooting/
 */
const withSentryDynamicFramework = config => {
  return withDangerousMod(config, [
    'ios',
    async config => {
      const podfilePath = path.join(config.modRequest.platformProjectRoot, 'Podfile');

      if (fs.existsSync(podfilePath)) {
        let podfileContent = fs.readFileSync(podfilePath, 'utf8');

        // Check if we already added the fix
        if (podfileContent.includes('Fix Sentry _SentryPrivate')) {
          return config;
        }

        // Add post_install hook to set APPLICATION_EXTENSION_API_ONLY for Sentry
        const sentryFix = `
      # Fix Sentry _SentryPrivate module error
      if target.name == 'Sentry'
        config.build_settings['APPLICATION_EXTENSION_API_ONLY'] = 'NO'
      end`;

        // Find and modify the post_install block
        if (podfileContent.includes('post_install do |installer|')) {
          // Insert after "target.build_configurations.each do |config|"
          podfileContent = podfileContent.replace(
            /(target\.build_configurations\.each do \|config\|)/,
            `$1${sentryFix}`
          );
        } else {
          // No post_install exists, add one before final 'end'
          podfileContent = podfileContent.replace(
            /^end\s*$/m,
            `  post_install do |installer|
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |config|${sentryFix}
      end
    end
  end
end`
          );
        }

        fs.writeFileSync(podfilePath, podfileContent);
      }

      return config;
    },
  ]);
};

module.exports = withSentryDynamicFramework;
