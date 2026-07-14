/**
 * Version sync script
 * Usage: node scripts/sync-version.js <version> (e.g., 2.3.0)
 *
 * Writes the given version into:
 *   - chrome/manifest.json
 *   - firefox/manifest.json
 *   - tampermonkey/*.user.js  (@version header; auto-detects any .user.js file)
 *
 * Never hand-edit the version in those three places again — pass the new
 * version here and run this script instead.
 */

const fs = require('fs');
const path = require('path');

const version = process.argv[2];

if (!version) {
  console.error('Missing version argument. Usage: node scripts/sync-version.js <version>');
  process.exit(1);
}

// Require plain x.y.z numeric format — compatible with Chrome, Firefox, and Tampermonkey.
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`Invalid version format: "${version}". Expected x.y.z, e.g. 2.3.0`);
  process.exit(1);
}

const ROOT = path.resolve(__dirname, '..');

/** Update the "version" field in a manifest.json */
function syncManifest(dir) {
  const manifestPath = path.join(ROOT, dir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    console.warn(`Skipped: ${dir}/manifest.json not found`);
    return;
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const oldVersion = manifest.version;
  manifest.version = version;
  // Keep 2-space indent and trailing newline to avoid reformatting the file.
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`OK  ${dir}/manifest.json: ${oldVersion} -> ${version}`);
}

/** Update the @version header in the .user.js file under tampermonkey/ */
function syncUserscript() {
  const dir = path.join(ROOT, 'tampermonkey');
  if (!fs.existsSync(dir)) {
    console.warn('Skipped: tampermonkey directory not found');
    return;
  }
  const userscriptFile = fs.readdirSync(dir).find((f) => f.endsWith('.user.js'));
  if (!userscriptFile) {
    console.warn('Skipped: no .user.js file found under tampermonkey/');
    return;
  }
  const filePath = path.join(dir, userscriptFile);
  const content = fs.readFileSync(filePath, 'utf8');
  
  const match = content.match(/\/\/ @version\s+(.+)/);
  const oldVersion = match ? match[1].trim() : '(not found)';

  if (!content.match(/\/\/ @version\s+/)) {
    console.error(`No "// @version" line found in ${userscriptFile} — check the header format`);
    process.exit(1);
  }
  
  const newContent = content.replace(/(\/\/ @version\s+).*/, `$1${version}`);

  fs.writeFileSync(filePath, newContent);
  console.log(`OK  tampermonkey/${userscriptFile}: ${oldVersion} -> ${version}`);
}

console.log(`\nSyncing version -> ${version}\n`);
syncManifest('chrome');
syncManifest('firefox');
syncUserscript();
console.log('\nDone. Review with git diff before committing.\n');
