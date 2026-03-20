/**
 * Bundle Analysis Script for React Native (Expo)
 * Analyzes exported bundle to identify optimization opportunities
 */

const fs = require('fs');
const path = require('path');

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

function formatPercentage(value) {
  return (value * 100).toFixed(2) + '%';
}

function analyzeDirectory(dir, results = { files: [], totalSize: 0 }) {
  if (!fs.existsSync(dir)) {
    console.log(`${colors.yellow}⚠️  Directory not found: ${dir}${colors.reset}`);
    return results;
  }

  const items = fs.readdirSync(dir);

  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stats = fs.statSync(fullPath);

    if (stats.isDirectory()) {
      analyzeDirectory(fullPath, results);
    } else if (stats.isFile()) {
      const ext = path.extname(item);
      const size = stats.size;

      results.files.push({
        path: fullPath,
        name: item,
        size: size,
        ext: ext,
        dir: path.dirname(fullPath),
      });
      results.totalSize += size;
    }
  }

  return results;
}

function analyzeBundle() {
  console.log(
    `\n${colors.bright}${colors.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`
  );
  console.log(
    `${colors.bright}${colors.cyan}  📊 Rallia Mobile App - Bundle Analysis${colors.reset}`
  );
  console.log(
    `${colors.bright}${colors.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}\n`
  );

  const distDir = path.join(__dirname, 'dist');

  if (!fs.existsSync(distDir)) {
    console.log(
      `${colors.red}❌ No dist folder found. Please run: npx expo export first${colors.reset}\n`
    );
    return;
  }

  const results = analyzeDirectory(distDir);
  const { files, totalSize } = results;

  // Group by file type
  const byType = files.reduce((acc, file) => {
    const type = file.ext || 'no-extension';
    if (!acc[type]) {
      acc[type] = { count: 0, size: 0, files: [] };
    }
    acc[type].count++;
    acc[type].size += file.size;
    acc[type].files.push(file);
    return acc;
  }, {});

  // Sort by size
  const sortedTypes = Object.entries(byType)
    .sort(([, a], [, b]) => b.size - a.size)
    .map(([type, data]) => ({
      type,
      ...data,
      percentage: data.size / totalSize,
    }));

  // Print summary
  console.log(
    `${colors.bright}📦 Total Bundle Size:${colors.reset} ${colors.green}${formatBytes(totalSize)}${colors.reset}`
  );
  console.log(`${colors.bright}📁 Total Files:${colors.reset} ${files.length}\n`);

  // Print by file type
  console.log(`${colors.bright}${colors.blue}File Type Breakdown:${colors.reset}`);
  console.log(`${'─'.repeat(80)}`);
  console.log(
    `${colors.bright}Type${' '.repeat(12)}Count${' '.repeat(5)}Size${' '.repeat(12)}Percentage${colors.reset}`
  );
  console.log(`${'─'.repeat(80)}`);

  sortedTypes.forEach(({ type, count, size, percentage }) => {
    const typeStr = type.padEnd(15);
    const countStr = count.toString().padEnd(10);
    const sizeStr = formatBytes(size).padEnd(15);
    const percStr = formatPercentage(percentage);

    const color = percentage > 0.3 ? colors.red : percentage > 0.1 ? colors.yellow : colors.green;
    console.log(`${typeStr}${countStr}${color}${sizeStr}${percStr}${colors.reset}`);
  });

  console.log(`${'─'.repeat(80)}\n`);

  // Find largest files
  const largestFiles = files
    .sort((a, b) => b.size - a.size)
    .slice(0, 10)
    .map(file => ({
      ...file,
      percentage: file.size / totalSize,
    }));

  console.log(`${colors.bright}${colors.blue}Top 10 Largest Files:${colors.reset}`);
  console.log(`${'─'.repeat(80)}`);
  console.log(`${colors.bright}File Name${' '.repeat(45)}Size${' '.repeat(8)}%${colors.reset}`);
  console.log(`${'─'.repeat(80)}`);

  largestFiles.forEach(({ name, size, percentage }) => {
    const nameStr = (name.length > 50 ? '...' + name.slice(-47) : name).padEnd(50);
    const sizeStr = formatBytes(size).padEnd(12);
    const percStr = formatPercentage(percentage);

    const color = percentage > 0.05 ? colors.red : percentage > 0.02 ? colors.yellow : colors.green;
    console.log(`${nameStr}${color}${sizeStr}${percStr}${colors.reset}`);
  });

  console.log(`${'─'.repeat(80)}\n`);

  // Analyze JavaScript bundles
  const jsBundles = files.filter(f => f.ext === '.js' || f.ext === '.bundle');
  const totalJsSize = jsBundles.reduce((sum, f) => sum + f.size, 0);

  console.log(`${colors.bright}${colors.blue}JavaScript Bundle Analysis:${colors.reset}`);
  console.log(
    `${colors.bright}Total JS Size:${colors.reset} ${colors.yellow}${formatBytes(totalJsSize)}${colors.reset} (${formatPercentage(totalJsSize / totalSize)} of total)`
  );
  console.log(`${colors.bright}JS Files:${colors.reset} ${jsBundles.length}\n`);

  // Recommendations
  console.log(`${colors.bright}${colors.cyan}💡 Optimization Recommendations:${colors.reset}\n`);

  const recommendations = [];

  if (totalJsSize / totalSize > 0.5) {
    recommendations.push(
      `${colors.yellow}⚠${colors.reset}  JavaScript bundles are >50% of total size. Consider code splitting or lazy loading.`
    );
  }

  const largeJsFiles = jsBundles.filter(f => f.size > 500000); // >500KB
  if (largeJsFiles.length > 0) {
    recommendations.push(
      `${colors.yellow}⚠${colors.reset}  ${largeJsFiles.length} JavaScript file(s) >500KB detected. Review for unused dependencies.`
    );
  }

  const imageFiles = files.filter(f => ['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(f.ext));
  const totalImageSize = imageFiles.reduce((sum, f) => sum + f.size, 0);
  if (totalImageSize / totalSize > 0.3) {
    recommendations.push(
      `${colors.yellow}⚠${colors.reset}  Images are >30% of total size. Consider optimization or using WebP format.`
    );
  }

  const fontFiles = files.filter(f => ['.ttf', '.otf', '.woff', '.woff2'].includes(f.ext));
  const totalFontSize = fontFiles.reduce((sum, f) => sum + f.size, 0);
  if (totalFontSize > 1000000) {
    recommendations.push(
      `${colors.yellow}⚠${colors.reset}  Font files are >${formatBytes(1000000)}. Consider subsetting or using system fonts.`
    );
  }

  if (recommendations.length === 0) {
    console.log(
      `${colors.green}✅ Bundle size looks good! No major optimization opportunities detected.${colors.reset}\n`
    );
  } else {
    recommendations.forEach(rec => console.log(rec));
    console.log();
  }

  // Performance metrics
  console.log(`${colors.bright}${colors.cyan}📈 Performance Metrics:${colors.reset}\n`);

  const metrics = [
    {
      label: 'Bundle Size',
      value: formatBytes(totalSize),
      status: totalSize < 10000000 ? 'good' : totalSize < 20000000 ? 'warning' : 'critical',
    },
    {
      label: 'JS Bundle',
      value: formatBytes(totalJsSize),
      status: totalJsSize < 5000000 ? 'good' : totalJsSize < 10000000 ? 'warning' : 'critical',
    },
    {
      label: 'Asset Files',
      value: files.length.toString(),
      status: files.length < 200 ? 'good' : files.length < 500 ? 'warning' : 'critical',
    },
  ];

  metrics.forEach(({ label, value, status }) => {
    const statusIcon =
      status === 'good'
        ? `${colors.green}✅`
        : status === 'warning'
          ? `${colors.yellow}⚠️`
          : `${colors.red}❌`;
    console.log(`${statusIcon}  ${label.padEnd(15)} ${value}${colors.reset}`);
  });

  console.log(
    `\n${colors.bright}${colors.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`
  );
  console.log(
    `${colors.bright}${colors.cyan}  📝 Report generated: ${new Date().toLocaleString()}${colors.reset}`
  );
  console.log(
    `${colors.bright}${colors.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}\n`
  );

  // Generate JSON report
  const report = {
    generatedAt: new Date().toISOString(),
    summary: {
      totalSize,
      totalFiles: files.length,
      totalSizeFormatted: formatBytes(totalSize),
    },
    byType: sortedTypes,
    largestFiles: largestFiles.map(({ name, size, percentage, path: filePath }) => ({
      name,
      size,
      sizeFormatted: formatBytes(size),
      percentage,
      path: filePath,
    })),
    javascript: {
      totalSize: totalJsSize,
      totalSizeFormatted: formatBytes(totalJsSize),
      count: jsBundles.length,
      percentage: totalJsSize / totalSize,
    },
    recommendations: recommendations.map(rec => rec.replace(/\x1b\[[0-9;]*m/g, '')), // Remove color codes
  };

  fs.writeFileSync(path.join(__dirname, 'bundle-report.json'), JSON.stringify(report, null, 2));

  console.log(`${colors.green}✅ JSON report saved to: bundle-report.json${colors.reset}\n`);
}

// Run analysis
analyzeBundle();
