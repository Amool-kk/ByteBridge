/**
 * Only accept requests addressed to an IP literal or localhost.
 *
 * A DNS rebinding attack works by pointing a *domain name* at your LAN IP, so
 * that a page you are browsing can talk to this server. Requiring a raw IP in
 * the Host header blocks that, and costs nothing for normal use.
 */

export function isAllowedHost(hostHeader) {
  if (!hostHeader) return false;
  const host = hostHeader.replace(/:\d+$/, '').replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true;
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host); // any IPv4 literal
}

export function hostGuard(req, res, next) {
  if (!isAllowedHost(req.headers.host)) {
    return res.status(403).type('text/plain').send('Forbidden: use the IP address shown in the terminal.');
  }
  next();
}
