import http from 'node:http';
import net from 'node:net';
import { lookup } from 'node:dns/promises';
import ipaddr from 'ipaddr.js';

export async function publicTarget(raw, resolve = lookup) {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Nur öffentliche HTTP(S)-Ziele ohne URL-Zugangsdaten.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
  if (![80, 443].includes(port)) throw new Error('Nur Web-Ports 80 und 443 erlaubt.');
  const rows = net.isIP(host) ? [{ address: host }] : await resolve(host, { all: true });
  if (!rows.length || rows.some(r => !ipaddr.isValid(r.address) || ipaddr.process(r.address).range() !== 'unicast')) throw new Error('Interne oder reservierte Netzwerkadresse gesperrt.');
  const address = rows.find(r => net.isIP(r.address) === 4)?.address || rows[0].address;
  return { url, address, port };
}

// All Chromium traffic goes through this loopback proxy. Resolve once and connect
// to that exact public IP, including HTTPS CONNECT, redirects and subresources.
export async function startProxy() {
  const proxy = http.createServer(async (req, res) => {
    try {
      const { url, address, port } = await publicTarget(req.url);
      if (url.protocol !== 'http:') throw new Error('Use CONNECT for TLS');
      const headers = { ...req.headers, host: url.host };
      delete headers['proxy-authorization']; delete headers['proxy-connection'];
      const upstream = http.request({ hostname: address, port, method: req.method, path: url.pathname + url.search, headers, timeout: 30000 }, response => {
        res.writeHead(response.statusCode || 502, response.headers); response.pipe(res);
      });
      upstream.on('timeout', () => upstream.destroy());
      upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
      req.on('aborted', () => upstream.destroy());
      res.on('close', () => upstream.destroy());
      req.pipe(upstream);
    } catch { res.writeHead(403); res.end('Network target denied'); }
  });
  proxy.on('connect', async (req, socket, head) => {
    socket.on('error', () => {});
    try {
      const { address, port } = await publicTarget('https://' + req.url);
      const upstream = net.connect({ host: address, port });
      upstream.setTimeout(60000, () => upstream.destroy());
      upstream.on('error', () => socket.destroy());
      socket.on('close', () => upstream.destroy());
      upstream.on('close', () => socket.destroy());
      upstream.on('connect', () => {
        socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.length) upstream.write(head);
        socket.pipe(upstream); upstream.pipe(socket);
      });
    } catch { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); }
  });
  proxy.on('upgrade', (_req, socket) => socket.destroy());
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
  return proxy;
}
