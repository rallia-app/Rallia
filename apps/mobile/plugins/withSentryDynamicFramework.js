const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * Expo config plugin to fix Sentry _SentryPrivate module error
 * Forces Sentry pod to build as a dynamic framework to properly generate Swift modules
 *
 * Based on: https://github.com/getsentry/sentry-react-native/issues/3322
 */
const withSentryDynamicFramework = config => {
  return withDangerousMod(config, [
    'ios',
    async config => {
      const podfilePath = path.join(config.modRequest.platformProjectRoot, 'Podfile');

      if (fs.existsSync(podfilePath)) {
        let podfileContent = fs.readFileSync(podfilePath, 'utf8');

        // Check if we already added the fix
        if (podfileContent.includes('Force Sentry to use dynamic framework')) {
          return config;
        }

        // Add pre_install hook to configure Sentry as dynamic framework
        const preInstallFix = `
  # Force Sentry to use dynamic framework to fix _SentryPrivate module error
  pre_install do |installer|
    installer.pod_targets.each do |pod|
      if pod.name.eql?('Sentry') || pod.name.start_with?('Sentry/')
        def pod.build_type
          Pod::BuildType.dynamic_framework
        end
      end
    end
  end
`;

        // Insert before the target block
        if (podfileContent.includes('target ')) {
          podfileContent = podfileContent.replace(
            /(target\s+['"][^'"]+['"]\s+do)/,
            `${preInstallFix}\n$1`
          );
        } else {
          // Fallback: add after platform declaration
          podfileContent = podfileContent.replace(
            /(platform\s+:ios[^\n]+\n)/,
            `$1${preInstallFix}\n`
          );
        }

        fs.writeFileSync(podfilePath, podfileContent);
      }

      return config;
    },
  ]);
};

module.exports = withSentryDynamicFramework;
