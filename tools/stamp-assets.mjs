import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function withVersion(specifier, version, extensions) {
  if (/^(?:[a-z]+:|\/\/|#)/i.test(specifier)) return specifier;
  const hashAt = specifier.indexOf('#');
  const hash = hashAt >= 0 ? specifier.slice(hashAt) : '';
  const beforeHash = hashAt >= 0 ? specifier.slice(0, hashAt) : specifier;
  const queryAt = beforeHash.indexOf('?');
  const pathname = queryAt >= 0 ? beforeHash.slice(0, queryAt) : beforeHash;
  if (!extensions.some(extension => pathname.endsWith(extension))) return specifier;
  const params = new URLSearchParams(queryAt >= 0 ? beforeHash.slice(queryAt + 1) : '');
  params.set('v', version);
  return pathname + '?' + params + hash;
}

function stampHtml(source, version) {
  return source.replace(/(\b(?:src|href)=)(["'])([^"']+)(\2)/g, (whole, attribute, quote, specifier) =>
    attribute + quote + withVersion(specifier, version, ['.js', '.css']) + quote);
}

function stampJavaScript(source, version) {
  const stamp = specifier => withVersion(specifier, version, ['.js']);
  return source
    .replace(/(\bfrom\s*|\bimport\s*\(\s*)(["'])([^"']+)(\2)/g,
      (whole, prefix, quote, specifier) => prefix + quote + stamp(specifier) + quote)
    .replace(/(\bimport\s+)(["'])([^"']+)(\2)/g,
      (whole, prefix, quote, specifier) => prefix + quote + stamp(specifier) + quote);
}

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(file) : [file];
  }))).flat();
}

export async function stampAssets({ publicRoot, revision, deployedAt = new Date().toISOString() }) {
  if (!/^[A-Za-z0-9._-]{7,64}$/.test(revision || '')) throw new Error('Invalid deploy revision');
  const version = revision.slice(0, 12);
  const files = await filesBelow(publicRoot);

  for (const file of files) {
    const extension = path.extname(file);
    if (extension !== '.html' && extension !== '.js') continue;
    const source = await readFile(file, 'utf8');
    const stamped = extension === '.html' ? stampHtml(source, version) : stampJavaScript(source, version);
    if (stamped !== source) await writeFile(file, stamped, 'utf8');
  }

  await writeFile(path.join(publicRoot, 'version.json'), JSON.stringify({
    version,
    revision,
    deployed_at: deployedAt
  }, null, 2) + '\n', 'utf8');
  return version;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) {
  const revision = process.argv[2] || process.env.GITHUB_SHA || '';
  const publicRoot = path.resolve(process.argv[3] || 'public');
  const version = await stampAssets({ publicRoot, revision });
  process.stdout.write('Stamped static assets as ' + version + '\n');
}
