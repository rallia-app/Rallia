# Expo App Updates: OTA vs Full Build

## Two Types of Updates

|              | OTA Update (EAS Update)    | Full Build (EAS Build)             |
| ------------ | -------------------------- | ---------------------------------- |
| What changes | JS, styles, images, assets | Native code, dependencies          |
| Store review | No                         | Yes                                |
| User action  | Auto (on next launch)      | Manual store update                |
| Speed        | Seconds to ship            | Minutes to build + days for review |

## When You MUST Do a Full Build

- Adding a package with native modules (e.g. `expo-camera`, `react-native-*`)
- Modifying `app.json` (permissions, plugins, bundle ID)
- Changing the Expo SDK version
- Any change that requires `npx expo prebuild`

## When OTA Is Enough

- Bug fixes in JS/TS logic
- UI changes
- Adding pure-JS packages
- New screens or features with no native dependencies

## Full Build Release Workflow

```bash
# 1. Bump version in app.json (and ios.buildNumber / android.versionCode)
# 2. Build
eas build --platform ios --profile production

# 3. Submit to store
eas submit --platform ios
```

Users on older builds are prompted to update via the App Store / Play Store normally.

## Runtime Version — Prevent OTA Crashes

If you push an OTA update that relies on a new native module, users on the old build will **crash**. Prevent this with `runtimeVersion`:

```json
// app.json
{
  "expo": {
    "runtimeVersion": {
      "policy": "appVersion"
    }
  }
}
```

This ties OTA compatibility to your `version` string. OTA updates built against `1.2.0` will **only** be delivered to users running the `1.2.0` binary — never to users still on `1.1.0`.

### Alternative: `fingerprint` policy

More precise — uses `@expo/fingerprint` to hash all native dependencies automatically. No risk of forgetting to bump the version.

```json
{
  "expo": {
    "runtimeVersion": {
      "policy": "fingerprint"
    }
  }
}
```

## Recommended Cadence

- **Monthly** (or as needed): full build for native changes → submit to stores
- **Anytime**: OTA updates for JS-only changes between builds
