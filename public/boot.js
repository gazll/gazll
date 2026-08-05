const fallbackVersion = new URL(import.meta.url).searchParams.get('v') || 'dev';

async function deployedVersion() {
  try {
    const url = new URL('version.json', import.meta.url);
    url.searchParams.set('_', String(Date.now()));
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) return fallbackVersion;
    const release = await response.json();
    return /^[A-Za-z0-9._-]+$/.test(release.version || '') ? release.version : fallbackVersion;
  } catch (e) {
    return fallbackVersion;
  }
}

async function boot() {
  const version = await deployedVersion();
  const styles = document.querySelector('link[data-app-styles]');
  if (styles) {
    const href = new URL('styles.css', import.meta.url);
    href.searchParams.set('v', version);
    if (styles.href !== href.href) {
      await new Promise(resolve => {
        styles.addEventListener('load', resolve, { once: true });
        styles.addEventListener('error', resolve, { once: true });
        styles.href = href.href;
      });
    }
  }

  const app = new URL('app.js', import.meta.url);
  app.searchParams.set('v', version);
  await import(app.href);
}

boot();
