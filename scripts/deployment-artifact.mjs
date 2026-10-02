// Identify the exact static directory tested by the deployment workflow.
// The manifest stays beside dist, never in the publicly uploaded directory.
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';

function identify(dist, manifest, revision) {
  if (!/^[a-f0-9]{40}$/.test(revision ?? '')) throw new Error('Expected a full Git commit SHA');
  const root = resolve(dist), destination = resolve(manifest);
  const manifestRelative = relative(root, destination);
  if (!isAbsolute(manifestRelative) && manifestRelative !== '..' && !manifestRelative.startsWith('..\\') && !manifestRelative.startsWith('../')) {
    throw new Error('Manifest must be outside the Pages upload directory');
  }
  if (!lstatSync(root).isDirectory() || lstatSync(root).isSymbolicLink()) throw new Error('Artifact root must be a real directory');
  const sourcePath = join(root, 'SOURCE.txt'), sourceEntry = lstatSync(sourcePath);
  if (!sourceEntry.isFile() || sourceEntry.isSymbolicLink()) throw new Error('SOURCE.txt must be a regular file');
  const source = readFileSync(sourcePath, 'utf8');
  if (!source.split(/\r?\n/).includes(`https://github.com/Chris0Jeky/MDviewer/tree/${revision}`)) {
    throw new Error(`SOURCE.txt does not identify revision ${revision}`);
  }
  const files = [];
  const visit = (directory, prefix = '') => {
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name), entry = lstatSync(path);
      const key = prefix ? `${prefix}/${name}` : name;
      if (entry.isSymbolicLink()) throw new Error(`Artifact contains a symbolic link: ${key}`);
      if (entry.isDirectory()) visit(path, key);
      else if (entry.isFile()) files.push({ path: key, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') });
      else throw new Error(`Artifact contains a non-regular entry: ${key}`);
    }
  };
  visit(root);
  return { version: 1, revision, files };
}

try {
  const [mode, dist, manifest, revision, ...extra] = process.argv.slice(2);
  if (!['create', 'verify'].includes(mode) || !dist || !manifest || extra.length) {
    throw new Error('Usage: node scripts/deployment-artifact.mjs create|verify <dist> <manifest> <full-sha>');
  }
  if (mode === 'create') {
    const identified = identify(dist, manifest, revision);
    writeFileSync(manifest, JSON.stringify(identified, null, 2) + '\n');
    console.log(`Recorded ${identified.files.length} artifact files for ${revision}`);
  } else {
    const recorded = JSON.parse(readFileSync(manifest, 'utf8'));
    if (recorded.version !== 1 || recorded.revision !== revision) throw new Error('Manifest revision or version does not match this run');
    const identified = identify(dist, manifest, revision);
    // Enumerate the directory, never paths from the downloaded manifest.
    if (JSON.stringify(recorded) !== JSON.stringify(identified)) throw new Error('Artifact files or checksums differ from the tested manifest');
    console.log(`Verified ${identified.files.length} artifact files for ${revision}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
