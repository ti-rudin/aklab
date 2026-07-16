import * as http from 'node:http';
import * as net from 'node:net';
import type { AddressInfo } from 'node:net';
import { resolvePublicHttpsUrl, UnsafeUrlError } from './ssrf';

type LookupResult = { address: string; family: number };
type Lookup = (hostname: string) => Promise<LookupResult[]>;

export interface PinnedHttpsProxy {
  server: string;
  close(): Promise<void>;
}

function parseConnectTarget(value: string | undefined): URL {
  if (!value) throw new UnsafeUrlError('CONNECT target is missing');
  let target: URL;
  try {
    target = new URL(`https://${value}`);
  } catch {
    throw new UnsafeUrlError('CONNECT target is invalid');
  }
  if (target.port && target.port !== '443') throw new UnsafeUrlError('CONNECT port is not allowed');
  return target;
}

/**
 * An ephemeral local CONNECT proxy. It resolves each hostname itself, rejects
 * non-public addresses and opens the upstream TCP socket by the selected IP.
 * Chromium still sends the original SNI/Host through the encrypted tunnel, but
 * cannot re-resolve the hostname after validation (DNS rebinding protection).
 */
export async function createPinnedHttpsProxy(options: { lookup?: Lookup } = {}): Promise<PinnedHttpsProxy> {
  const server = http.createServer((_req, res) => {
    res.writeHead(405).end();
  });

  server.on('connect', async (request, clientSocket, head) => {
    let target: URL;
    let address: string;
    try {
      target = parseConnectTarget(request.url);
      const resolved = await resolvePublicHttpsUrl(target.toString(), { lookup: options.lookup });
      address = resolved.addresses[0]?.address;
      if (!address) throw new UnsafeUrlError('CONNECT host has no address');
    } catch {
      clientSocket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      clientSocket.destroy();
      return;
    }

    const upstream = net.connect({ host: address, port: 443 });
    const fail = () => {
      if (!clientSocket.destroyed) clientSocket.write('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');
      clientSocket.destroy();
      upstream.destroy();
    };
    upstream.once('error', fail);
    clientSocket.once('error', () => upstream.destroy());
    upstream.once('connect', () => {
      upstream.off('error', fail);
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address() as AddressInfo;

  return {
    server: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  };
}
