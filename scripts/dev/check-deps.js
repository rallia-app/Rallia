#!/usr/bin/env node

/**
 * Dependency Conflict Checker for Monorepo
 *
 * Detects:
 * 1. Version mismatches across workspace package.json files
 * 2. Hoisting conflicts (root node_modules vs local node_modules)
 * 3. Peer dependency warnings
 *
 * Usage: node scripts/check-deps.js [--fix] [--verbose] [--json]
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '../..');
const VERBOSE = process.argv.includes('--verbose');
const FIX_MODE = process.argv.includes('--fix');
const JSON_OUTPUT = process.argv.includes('--json');

// ANSI colors for terminal output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
};

function log(message, color = 'reset') {
  if (!JSON_OUTPUT) {
    console.log(`${colors[color]}${message}${colors.reset}`);
  }
}

function logSection(title) {
  console.log();
  log(`━━━ ${title} ━━━`, 'cyan');
}

/**
 * Find all package.json files in the monorepo
 */
function findPackageJsonFiles() {
  const packages = [];

  // Root package.json
  packages.push({
    name: 'root',
    path: path.join(ROOT_DIR, 'package.json'),
    relativePath: 'package.json',
  });

  // Apps
  const appsDir = path.join(ROOT_DIR, 'apps');
  if (fs.existsSync(appsDir)) {
    fs.readdirSync(appsDir).forEach(app => {
      const pkgPath = path.join(appsDir, app, 'package.json');
      if (fs.existsSync(pkgPath)) {
        packages.push({
          name: `apps/${app}`,
          path: pkgPath,
          relativePath: `apps/${app}/package.json`,
        });
      }
    });
  }

  // Packages
  const packagesDir = path.join(ROOT_DIR, 'packages');
  if (fs.existsSync(packagesDir)) {
    fs.readdirSync(packagesDir).forEach(pkg => {
      const pkgPath = path.join(packagesDir, pkg, 'package.json');
      if (fs.existsSync(pkgPath)) {
        packages.push({
          name: `packages/${pkg}`,
          path: pkgPath,
          relativePath: `packages/${pkg}/package.json`,
        });
      }
    });
  }

  return packages;
}

/**
 * Parse a package.json file and extract all dependencies
 */
function parseDependencies(pkgPath) {
  try {
    const content = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    return {
      name: content.name || 'unknown',
      dependencies: content.dependencies || {},
      devDependencies: content.devDependencies || {},
      peerDependencies: content.peerDependencies || {},
      overrides: content.overrides || {},
    };
  } catch (e) {
    log(`  ⚠ Failed to parse ${pkgPath}: ${e.message}`, 'yellow');
    return null;
  }
}

/**
 * Get the installed version from node_modules
 */
function getInstalledVersion(modulePath) {
  const pkgJsonPath = path.join(modulePath, 'package.json');
  if (fs.existsSync(pkgJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
      return pkg.version;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Normalize version string for comparison (strip ^, ~, etc.)
 */
function normalizeVersion(version) {
  if (!version) return null;
  // Handle workspace protocol
  if (version === '*' || version.startsWith('workspace:')) return 'workspace';
  // Strip version prefixes
  return version.replace(/^[\^~>=<]*/g, '').split(' ')[0];
}

/**
 * Check for version conflicts across package.json files
 */
function checkDeclaredVersionConflicts(packages) {
  const depMap = new Map(); // dep name -> [{ package, version, type }]
  const conflicts = [];

  packages.forEach(({ name, path: pkgPath }) => {
    const pkg = parseDependencies(pkgPath);
    if (!pkg) return;

    const allDeps = [
      ...Object.entries(pkg.dependencies).map(([d, v]) => ({
        dep: d,
        version: v,
        type: 'dependencies',
      })),
      ...Object.entries(pkg.devDependencies).map(([d, v]) => ({
        dep: d,
        version: v,
        type: 'devDependencies',
      })),
    ];

    allDeps.forEach(({ dep, version, type }) => {
      if (!depMap.has(dep)) {
        depMap.set(dep, []);
      }
      depMap.get(dep).push({ package: name, version, type });
    });
  });

  // Find conflicts
  depMap.forEach((entries, depName) => {
    const uniqueVersions = [...new Set(entries.map(e => normalizeVersion(e.version)))].filter(
      v => v && v !== 'workspace'
    );

    if (uniqueVersions.length > 1) {
      conflicts.push({
        dependency: depName,
        versions: entries.filter(e => normalizeVersion(e.version) !== 'workspace'),
      });
    }
  });

  return conflicts;
}

/**
 * Check for hoisting conflicts (root vs local node_modules)
 */
function checkHoistingConflicts(packages) {
  const conflicts = [];
  const rootNodeModules = path.join(ROOT_DIR, 'node_modules');

  // Critical native dependencies that commonly cause issues
  const criticalDeps = [
    'react',
    'react-dom',
    'react-native',
    'react-native-reanimated',
    'react-native-gesture-handler',
    'react-native-screens',
    'react-native-safe-area-context',
    'expo',
    '@react-navigation/native',
  ];

  packages.forEach(({ name, path: pkgPath, relativePath }) => {
    if (name === 'root') return;

    const pkgDir = path.dirname(pkgPath);
    const localNodeModules = path.join(pkgDir, 'node_modules');
    const pkg = parseDependencies(pkgPath);
    if (!pkg) return;

    const allDeps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
    };

    Object.keys(allDeps).forEach(depName => {
      const rootVersion = getInstalledVersion(path.join(rootNodeModules, depName));
      const localVersion = getInstalledVersion(path.join(localNodeModules, depName));

      if (rootVersion && localVersion && rootVersion !== localVersion) {
        const isCritical = criticalDeps.includes(depName);
        conflicts.push({
          dependency: depName,
          package: name,
          rootVersion,
          localVersion,
          critical: isCritical,
        });
      }
    });
  });

  return conflicts;
}

/**
 * Check for native module version mismatches (JS vs Native)
 */
function checkNativeModuleMismatches() {
  const mismatches = [];

  // Check iOS Podfile.lock
  const podfileLock = path.join(ROOT_DIR, 'apps/mobile/ios/Podfile.lock');
  if (fs.existsSync(podfileLock)) {
    const content = fs.readFileSync(podfileLock, 'utf8');

    // Map of pod names to npm package names
    const podToNpm = {
      RNReanimated: 'react-native-reanimated',
      RNGestureHandler: 'react-native-gesture-handler',
      RNScreens: 'react-native-screens',
      RNSVG: 'react-native-svg',
    };

    Object.entries(podToNpm).forEach(([podName, npmName]) => {
      // Extract version from Podfile.lock
      const podMatch = content.match(new RegExp(`- ${podName} \\(([\\d.]+)\\):`));
      if (podMatch) {
        const podVersion = podMatch[1];

        // Get JS version - check both root and mobile node_modules
        const rootVersion = getInstalledVersion(path.join(ROOT_DIR, 'node_modules', npmName));
        const mobileVersion = getInstalledVersion(
          path.join(ROOT_DIR, 'apps/mobile/node_modules', npmName)
        );
        const jsVersion = mobileVersion || rootVersion;

        if (jsVersion && jsVersion !== podVersion) {
          mismatches.push({
            package: npmName,
            jsVersion,
            nativeVersion: podVersion,
            platform: 'iOS',
          });
        }
      }
    });
  }

  return mismatches;
}

/**
 * Suggest fixes for conflicts
 */
function suggestFixes(declaredConflicts, hoistingConflicts, nativeMismatches) {
  const suggestions = [];

  // For declared conflicts, suggest using the highest version
  declaredConflicts.forEach(({ dependency, versions }) => {
    const normalizedVersions = versions
      .map(v => ({ ...v, normalized: normalizeVersion(v.version) }))
      .filter(v => v.normalized);

    const sorted = normalizedVersions.sort((a, b) => {
      const aParts = a.normalized.split('.').map(Number);
      const bParts = b.normalized.split('.').map(Number);
      for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
        const diff = (bParts[i] || 0) - (aParts[i] || 0);
        if (diff !== 0) return diff;
      }
      return 0;
    });

    if (sorted.length > 0) {
      suggestions.push({
        type: 'declared',
        dependency,
        action: `Align all packages to version ${sorted[0].version}`,
        packages: versions.map(v => `${v.package}: ${v.version}`),
      });
    }
  });

  // For hoisting conflicts, suggest removing local version
  hoistingConflicts.forEach(({ dependency, package: pkg, rootVersion, localVersion }) => {
    suggestions.push({
      type: 'hoisting',
      dependency,
      action: `Remove local node_modules/${dependency} from ${pkg}, or update package.json to match root version (${rootVersion})`,
      detail: `Root: ${rootVersion}, Local: ${localVersion}`,
    });
  });

  // For native mismatches
  nativeMismatches.forEach(({ package: pkg, jsVersion, nativeVersion, platform }) => {
    suggestions.push({
      type: 'native',
      dependency: pkg,
      action: `Run 'pod update' in apps/mobile/ios to sync native code with JS version`,
      detail: `JS: ${jsVersion}, ${platform} Native: ${nativeVersion}`,
    });
  });

  return suggestions;
}

/**
 * Check for peer dependency issues
 */
function checkPeerDependencies(packages) {
  const issues = [];

  packages.forEach(({ name, path: pkgPath }) => {
    const pkg = parseDependencies(pkgPath);
    if (!pkg || !pkg.peerDependencies || Object.keys(pkg.peerDependencies).length === 0) {
      return;
    }

    // Check if peer dependencies are satisfied
    Object.entries(pkg.peerDependencies).forEach(([peerDep, peerVersion]) => {
      // Check if this peer dependency is installed in the package's dependencies
      const hasDirectDep = pkg.dependencies[peerDep] || pkg.devDependencies[peerDep];

      if (!hasDirectDep) {
        // Check if it's available in root or parent workspaces
        const rootNodeModules = path.join(ROOT_DIR, 'node_modules');
        const pkgDir = path.dirname(pkgPath);
        const localNodeModules = path.join(pkgDir, 'node_modules');

        const rootInstalled = getInstalledVersion(path.join(rootNodeModules, peerDep));
        const localInstalled = getInstalledVersion(path.join(localNodeModules, peerDep));

        if (!rootInstalled && !localInstalled) {
          issues.push({
            package: name,
            peerDependency: peerDep,
            requiredVersion: peerVersion,
            issue: 'missing',
          });
        }
      }
    });
  });

  return issues;
}

/**
 * Main execution
 */
function main() {
  if (FIX_MODE) {
    log('⚠ --fix mode is not yet implemented', 'yellow');
    log('  This feature will automatically fix dependency conflicts in the future.\n', 'dim');
  }

  if (JSON_OUTPUT) {
    // JSON mode - collect all data and output as JSON
    const packages = findPackageJsonFiles();
    const declaredConflicts = checkDeclaredVersionConflicts(packages);
    const hoistingConflicts = checkHoistingConflicts(packages);
    const nativeMismatches = checkNativeModuleMismatches();
    const peerDependencyIssues = checkPeerDependencies(packages);

    const criticalHoisting = hoistingConflicts.filter(c => c.critical);
    const totalIssues =
      declaredConflicts.length +
      criticalHoisting.length +
      nativeMismatches.length +
      peerDependencyIssues.length;

    const output = {
      success: totalIssues === 0,
      totalIssues,
      declaredConflicts,
      hoistingConflicts: criticalHoisting,
      nativeMismatches,
      peerDependencyIssues,
      timestamp: new Date().toISOString(),
    };

    console.log(JSON.stringify(output, null, 2));
    process.exit(totalIssues === 0 ? 0 : 1);
    return;
  }

  log('\n🔍 Monorepo Dependency Conflict Checker\n', 'bold');

  const packages = findPackageJsonFiles();
  log(`Found ${packages.length} packages to analyze`, 'dim');

  // 1. Check declared version conflicts
  logSection('Declared Version Conflicts');
  const declaredConflicts = checkDeclaredVersionConflicts(packages);

  if (declaredConflicts.length === 0) {
    log('  ✓ No version conflicts in package.json files', 'green');
  } else {
    declaredConflicts.forEach(({ dependency, versions }) => {
      log(`  ✗ ${dependency}`, 'red');
      versions.forEach(({ package: pkg, version, type }) => {
        log(`    • ${pkg} (${type}): ${version}`, 'dim');
      });
    });
  }

  // 2. Check hoisting conflicts
  logSection('Hoisting Conflicts (node_modules)');
  const hoistingConflicts = checkHoistingConflicts(packages);

  if (hoistingConflicts.length === 0) {
    log('  ✓ No hoisting conflicts detected', 'green');
  } else {
    const critical = hoistingConflicts.filter(c => c.critical);
    const nonCritical = hoistingConflicts.filter(c => !c.critical);

    if (critical.length > 0) {
      log('\n  🚨 Critical conflicts (likely to cause runtime errors):', 'red');
      critical.forEach(({ dependency, package: pkg, rootVersion, localVersion }) => {
        log(`    ✗ ${dependency} in ${pkg}`, 'red');
        log(`      Root: ${rootVersion} ← Metro uses this`, 'dim');
        log(`      Local: ${localVersion} ← Native build uses this`, 'dim');
      });
    }

    if (nonCritical.length > 0 && VERBOSE) {
      log('\n  ⚠ Other hoisting differences:', 'yellow');
      nonCritical.forEach(({ dependency, package: pkg, rootVersion, localVersion }) => {
        log(`    • ${dependency} in ${pkg}: root=${rootVersion}, local=${localVersion}`, 'dim');
      });
    }
  }

  // 3. Check native module mismatches
  logSection('Native Module Mismatches (JS vs Native)');
  const nativeMismatches = checkNativeModuleMismatches();

  if (nativeMismatches.length === 0) {
    log('  ✓ JS and native versions are in sync', 'green');
  } else {
    nativeMismatches.forEach(({ package: pkg, jsVersion, nativeVersion, platform }) => {
      log(`  ✗ ${pkg}`, 'red');
      log(`    JS version: ${jsVersion}`, 'dim');
      log(`    ${platform} native: ${nativeVersion}`, 'dim');
    });
  }

  // 4. Check peer dependencies
  logSection('Peer Dependency Issues');
  const peerDependencyIssues = checkPeerDependencies(packages);

  if (peerDependencyIssues.length === 0) {
    log('  ✓ All peer dependencies are satisfied', 'green');
  } else {
    peerDependencyIssues.forEach(({ package: pkg, peerDependency, requiredVersion }) => {
      log(`  ✗ ${pkg}`, 'red');
      log(`    Missing peer dependency: ${peerDependency}@${requiredVersion}`, 'dim');
    });
  }

  // 5. Summary and suggestions
  const totalIssues =
    declaredConflicts.length +
    hoistingConflicts.filter(c => c.critical).length +
    nativeMismatches.length +
    peerDependencyIssues.length;

  logSection('Summary');
  if (totalIssues === 0) {
    log('  ✓ No dependency conflicts found! 🎉', 'green');
    process.exit(0);
  } else {
    log(`  Found ${totalIssues} issue(s) that may cause problems:\n`, 'yellow');

    const suggestions = suggestFixes(
      declaredConflicts,
      hoistingConflicts.filter(c => c.critical),
      nativeMismatches
    );

    // Add peer dependency suggestions
    peerDependencyIssues.forEach(({ package: pkg, peerDependency, requiredVersion }) => {
      suggestions.push({
        type: 'peer',
        dependency: peerDependency,
        action: `Install ${peerDependency}@${requiredVersion} in ${pkg} or ensure it's available in root dependencies`,
        detail: `Required by ${pkg}`,
      });
    });
    suggestions.forEach((s, i) => {
      log(`  ${i + 1}. ${s.dependency}`, 'yellow');
      log(`     ${s.action}`, 'dim');
      if (s.detail) log(`     ${s.detail}`, 'dim');
    });

    log('\n  💡 Quick fixes:', 'cyan');
    log('     • For hoisting: rm -rf apps/mobile/node_modules/<package> && npm install', 'dim');
    log('     • For iOS native: cd apps/mobile/ios && pod update <PodName>', 'dim');
    log('     • For version alignment: update package.json to use same version', 'dim');

    process.exit(1);
  }
}

main();
