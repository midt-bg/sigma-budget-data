import { afterAll, beforeAll, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { ReleaseError } from '@sigma-budget/ingest/release-package';
import { getBytes, locateManifest } from './manifest-location.js';

// Public-read behaviours retained from eabef3e4 release-client/package.test.ts
// and multipart.test.ts, without the operator client or the site's Worker.
let server: Server;
let origin: string;
let redirected = 0;
const bytes = Buffer.from('owned public release bytes');
beforeAll(async () => {
  server = createServer((request, response) => {
    if (request.url === '/redirect') {
      response.writeHead(302, { Location: '/target' });
      response.end();
    } else if (request.url === '/error') {
      request.socket.destroy();
    } else {
      if (request.url === '/target') redirected++;
      response.writeHead(200);
      response.write(bytes.subarray(0, 5));
      response.end(bytes.subarray(5));
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected a loopback port');
  origin = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

it('requires an explicit clean release origin', async () => {
  // The former releaseEnvironment behaviour now belongs to the public URL caller.
  for (const url of [
    'http://example.invalid',
    'https://example.invalid/admin',
    'https://user:secret@example.invalid',
    'https://example.invalid/?token=value',
  ])
    await expect(locateManifest({ current: url })).rejects.toMatchObject({ code: 2 });
});

it('refuses redirect responses without following them', async () => {
  await expect(getBytes(`${origin}/redirect`)).rejects.toMatchObject({ code: 3 });
  expect(redirected).toBe(0);
});

it('reads the complete public object within its byte limit and refuses oversized bytes', async () => {
  const result = await getBytes(`${origin}/object`, undefined, bytes.length);
  expect(result).toEqual(bytes);
  expect(result.length).toBe(bytes.length);
  await expect(getBytes(`${origin}/object`, undefined, bytes.length - 1)).rejects.toMatchObject({
    code: 3,
  });
});

it('sanitizes HTTP failures as ReleaseError(3)', async () => {
  await expect(getBytes(`${origin}/error`)).rejects.toBeInstanceOf(ReleaseError);
  await expect(getBytes(`${origin}/error`)).rejects.toMatchObject({
    code: 3,
    message: 'HTTP transport failed or response exceeded its limit',
  });
});
