/* eslint-disable @typescript-eslint/no-var-requires */
const { withGradleProperties } = require('@expo/config-plugins');

/**
 * Bumps the Gradle JVM heap so D8 dex merging can complete.
 * The default (-Xmx2g / Metaspace 512m) OOMs during :app:mergeExtDexDebug
 * with SDK 55 + New Architecture + our full native module set.
 */
const withGradleHeap = config => {
  return withGradleProperties(config, mod => {
    const setProp = (key, value) => {
      const existing = mod.modResults.find(item => item.type === 'property' && item.key === key);
      if (existing) {
        existing.value = value;
      } else {
        mod.modResults.push({ type: 'property', key, value });
      }
    };

    setProp('org.gradle.jvmargs', '-Xmx6g -XX:MaxMetaspaceSize=1g');

    return mod;
  });
};

module.exports = withGradleHeap;
