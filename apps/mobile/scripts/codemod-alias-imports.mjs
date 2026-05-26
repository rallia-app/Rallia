// Rewrites parent-relative import specifiers ("../x") to the "#/" alias, where
// "#/" === apps/mobile/src. A specifier is rewritten ONLY when it resolves to a
// path inside src/. Anything that resolves outside src/ (e.g. ../../assets/x.png,
// ../../app.json) is left untouched. Same-directory "./x" imports are left
// untouched by convention.
//
// Covers static imports, re-exports (export ... from), dynamic import(), and
// require() calls.
//
// Requires ts-morph:  npm i -D ts-morph
//
// Usage (run from apps/mobile):
//   node scripts/codemod-alias-imports.mjs                      # dry run, all files
//   node scripts/codemod-alias-imports.mjs --limit=5            # eyeball 5 files
//   node scripts/codemod-alias-imports.mjs --filter=screens/Home  # one area
//   node scripts/codemod-alias-imports.mjs --write              # apply to disk

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Project, SyntaxKind } from 'ts-morph';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MOBILE_ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(MOBILE_ROOT, 'src');

const args = process.argv.slice(2);
const WRITE = args.includes('--write');
const filterArg = args.find(a => a.startsWith('--filter='))?.split('=')[1];
const limitArg = args.find(a => a.startsWith('--limit='))?.split('=')[1];
const LIMIT = limitArg ? Number.parseInt(limitArg, 10) : Number.POSITIVE_INFINITY;

// Returns the "#/"-aliased specifier, or null to leave the import unchanged.
function toAlias(fromFile, specifier) {
  const isParentRelative = specifier === '..' || specifier.startsWith('../');
  if (!isParentRelative) return null; // bare modules and ./ stay as-is

  const resolved = path.resolve(path.dirname(fromFile), specifier);
  // Only rewrite targets that live inside src/. Assets, app.json, etc. resolve
  // outside src/ and must keep their relative form.
  const insideSrc = resolved === SRC_DIR || resolved.startsWith(SRC_DIR + path.sep);
  if (!insideSrc) return null;

  const rel = path.relative(SRC_DIR, resolved).split(path.sep).join('/');
  return rel ? `#/${rel}` : '#';
}

// Collect every module-specifier string literal in a source file.
function collectSpecifierLiterals(sf) {
  const literals = [];

  for (const imp of sf.getImportDeclarations()) {
    literals.push(imp.getModuleSpecifier());
  }
  for (const exp of sf.getExportDeclarations()) {
    const ms = exp.getModuleSpecifier();
    if (ms) literals.push(ms);
  }
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = call.getExpression();
    const isDynamicImport = expr.getKind() === SyntaxKind.ImportKeyword;
    const isRequire =
      expr.getKind() === SyntaxKind.Identifier && expr.getText() === 'require';
    if (!isDynamicImport && !isRequire) continue;
    const arg = call.getArguments()[0];
    if (arg && arg.getKind() === SyntaxKind.StringLiteral) literals.push(arg);
  }

  return literals;
}

const project = new Project({ skipAddingFilesFromTsConfig: true });
project.addSourceFilesAtPaths(path.join(SRC_DIR, '**/*.{ts,tsx}'));

let filesTouched = 0;
let rewritten = 0;
let leftOutsideSrc = 0;
let processed = 0;

for (const sf of project.getSourceFiles()) {
  const filePath = sf.getFilePath();
  if (filterArg && !filePath.includes(filterArg)) continue;
  if (processed >= LIMIT) break;
  processed++;

  const changes = [];
  for (const lit of collectSpecifierLiterals(sf)) {
    const value = lit.getLiteralValue();
    const aliased = toAlias(filePath, value);
    if (aliased == null) {
      if (value === '..' || value.startsWith('../')) leftOutsideSrc++;
      continue;
    }
    lit.setLiteralValue(aliased);
    changes.push({ from: value, to: aliased });
    rewritten++;
  }

  if (changes.length > 0) {
    filesTouched++;
    console.log(`\n${path.relative(MOBILE_ROOT, filePath)}`);
    for (const c of changes) console.log(`  ${c.from}  ->  ${c.to}`);
  }
}

if (WRITE) {
  project.saveSync();
  console.log('\nWrote changes to disk.');
} else {
  console.log('\n(dry run - pass --write to apply)');
}

console.log(
  `\nSummary: ${rewritten} specifiers rewritten across ${filesTouched} files; ` +
    `${leftOutsideSrc} parent-relative specifiers left as-is (resolve outside src/).`
);
