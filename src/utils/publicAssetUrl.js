function getDeployedPublicPrefix() {
  if (
    typeof import.meta !== 'undefined' &&
    import.meta.env &&
    Object.prototype.hasOwnProperty.call(import.meta.env, 'BASE_URL')
  ) {
    return String(import.meta.env.BASE_URL || '').replace(/\/$/, '');
  }
  return (process.env.PUBLIC_URL || '').replace(/\/$/, '');
}

/**
 * URL for a file in `public/` (CRA: `PUBLIC_URL`; Vite: `BASE_URL`).
 * Must not depend on the current route path — resolving against `location.href`
 * breaks on nested paths (e.g. /manager/orders → /manager/logo.png).
 */
export const getPublicAssetUrl = (filename) => {
  const name = String(filename ?? '').replace(/^\/+/, '');
  if (!name) return '';

  if (typeof window === 'undefined' || !window.location) {
    let pub = getDeployedPublicPrefix();
    if (pub && !pub.startsWith('/')) {
      pub = `/${pub}`;
    }
    const path = `${pub}/${name}`.replace(/\/+/g, '/');
    return path;
  }

  const { protocol, href, origin } = window.location;

  if (protocol === 'file:') {
    try {
      return new URL(name, new URL('.', href)).toString();
    } catch {
      return name;
    }
  }

  let pub = getDeployedPublicPrefix();
  if (pub && !pub.startsWith('/')) {
    pub = `/${pub}`;
  }
  const path = `${pub}/${name}`.replace(/\/+/g, '/');
  try {
    return new URL(path, origin).toString();
  } catch {
    return path;
  }
};
