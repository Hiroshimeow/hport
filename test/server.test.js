import test from 'node:test';
import assert from 'node:assert/strict';

import worker from '../server/index.js';

function createEnv(overrides = {}) {
  return {
    CF_ACCOUNT_ID: 'acc-123',
    CF_ZONE_ID: 'zone-123',
    CF_API_TOKEN: 'token-123',
    PUBLIC_BASE_DOMAIN: 'example.com',
    PROTECTED_SUBDOMAINS: 'api,api2,mcp,memos',
    ...overrides
  };
}

function apiSuccess(result, resultInfo) {
  return new Response(JSON.stringify({
    success: true,
    errors: [],
    messages: [],
    result,
    ...(resultInfo ? { result_info: resultInfo } : {})
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

function apiFailure(message, status = 404, code = 7003) {
  return new Response(JSON.stringify({
    success: false,
    errors: [{ code, message }],
    messages: [],
    result: null
  }), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function managedDnsRecord({ id, name, tunnelId, sessionId }) {
  return {
    id,
    type: 'CNAME',
    name,
    content: `${tunnelId}.cfargotunnel.com`,
    tags: [],
    comment: `hport-managed session=${sessionId} subdomain=${name.split('.')[0]}`
  };
}

function managedTunnel({ id, subdomain, sessionId, status = 'healthy' }) {
  return {
    id,
    name: `hport-${subdomain}--${sessionId}`,
    status,
    created_at: '2026-05-17T00:00:00.000Z',
    conns_active_at: status === 'healthy' ? '2026-05-19T00:00:00.000Z' : null,
    conns_inactive_at: status === 'healthy' ? null : '2026-05-19T00:00:00.000Z',
    metadata: {}
  };
}

test('create-tunnel rejects protected subdomains before calling Cloudflare', async () => {
  const originalFetch = global.fetch;
  let called = false;

  global.fetch = async () => {
    called = true;
    throw new Error('should not be called');
  };

  try {
    const request = new Request('https://worker.example/create-tunnel', {
      method: 'POST',
      body: JSON.stringify({ subdomain: 'api2' })
    });

    const response = await worker.fetch(request, createEnv());
    const payload = await response.json();

    assert.equal(response.status, 409);
    assert.equal(payload.code, 'PROTECTED_SUBDOMAIN');
    assert.equal(called, false);
  } finally {
    global.fetch = originalFetch;
  }
});

test('create-tunnel rejects unmanaged DNS conflicts without overwrite', async () => {
  const originalFetch = global.fetch;
  const calls = [];

  global.fetch = async (input) => {
    const url = typeof input === 'string' ? input : input.url;
    calls.push(url);

    if (url.includes('/dns_records?')) {
      return apiSuccess([{
        id: 'dns-existing',
        type: 'A',
        name: 'taken.example.com',
        content: '198.51.100.10',
        tags: []
      }]);
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const request = new Request('https://worker.example/create-tunnel', {
      method: 'POST',
      body: JSON.stringify({ subdomain: 'taken' })
    });

    const response = await worker.fetch(request, createEnv());
    const payload = await response.json();

    assert.equal(response.status, 409);
    assert.equal(payload.code, 'UNMANAGED_DNS_CONFLICT');
    assert.equal(calls.length, 1);
  } finally {
    global.fetch = originalFetch;
  }
});

test('create-tunnel returns managed conflict until overwrite is explicitly confirmed', async () => {
  const originalFetch = global.fetch;

  global.fetch = async (input) => {
    const url = typeof input === 'string' ? input : input.url;

    if (url.includes('/dns_records?')) {
      return apiSuccess([
        managedDnsRecord({
          id: 'dns-old',
          name: 'reuse.example.com',
          tunnelId: 'old-tunnel-123',
          sessionId: '00000000-0000-0000-0000-000000000123'
        })
      ]);
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const request = new Request('https://worker.example/create-tunnel', {
      method: 'POST',
      body: JSON.stringify({ subdomain: 'reuse' })
    });

    const response = await worker.fetch(request, createEnv());
    const payload = await response.json();

    assert.equal(response.status, 409);
    assert.equal(payload.code, 'DNS_EXISTS');
  } finally {
    global.fetch = originalFetch;
  }
});

test('create-tunnel overwrite only replaces managed resources and tags the new DNS record', async () => {
  const originalFetch = global.fetch;
  const calls = [];

  global.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    calls.push({ url, method: init.method || 'GET', body: init.body });

    if (url.includes('/dns_records?')) {
      return apiSuccess([
        managedDnsRecord({
          id: 'dns-old',
          name: 'reuse.example.com',
          tunnelId: 'old-tunnel-123',
          sessionId: '00000000-0000-0000-0000-000000000123'
        })
      ]);
    }

    if (url.endsWith('/cfd_tunnel') && (init.method || 'GET') === 'POST') {
      return apiSuccess({ id: 'new-tunnel-456', token: 'cf-token-456' });
    }

    if (url.includes('/dns_records/dns-old') && init.method === 'PUT') {
      return apiSuccess({ id: 'dns-old' });
    }

    if (url.endsWith('/cfd_tunnel/old-tunnel-123')) {
      if ((init.method || 'GET') === 'GET') {
        return apiSuccess(managedTunnel({
          id: 'old-tunnel-123',
          subdomain: 'reuse',
          sessionId: '00000000-0000-0000-0000-000000000123',
          status: 'down'
        }));
      }

      if (init.method === 'DELETE') {
        return apiSuccess({ id: 'old-tunnel-123' });
      }
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const request = new Request('https://worker.example/create-tunnel', {
      method: 'POST',
      body: JSON.stringify({ subdomain: 'reuse', overwrite: true })
    });

    const response = await worker.fetch(request, createEnv());
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.replacedExisting, true);
    assert.match(payload.sessionId, /^[0-9a-f-]{36}$/i);

    const dnsWrite = calls.find((call) => call.url.includes('/dns_records/dns-old') && call.method === 'PUT');
    const dnsRecord = JSON.parse(dnsWrite.body);
    assert.equal(dnsRecord.name, 'reuse.example.com');
    assert.equal(dnsRecord.content, 'new-tunnel-456.cfargotunnel.com');
    assert.match(dnsRecord.comment, /^hport-managed session=/);

    const deletedTunnel = calls.find((call) => call.url.endsWith('/cfd_tunnel/old-tunnel-123') && call.method === 'DELETE');
    assert.ok(deletedTunnel);
  } finally {
    global.fetch = originalFetch;
  }
});

test('audit reports managed safe, managed orphan, candidate, and protected categories', async () => {
  const originalFetch = global.fetch;

  global.fetch = async (input) => {
    const url = typeof input === 'string' ? input : input.url;

    if (url.includes('/dns_records?')) {
      return apiSuccess([
        managedDnsRecord({
          id: 'dns-safe',
          name: 'live.example.com',
          tunnelId: 'tun-active',
          sessionId: '00000000-0000-0000-0000-000000000111'
        }),
        managedDnsRecord({
          id: 'dns-orphan',
          name: 'stale.example.com',
          tunnelId: 'tun-missing',
          sessionId: '00000000-0000-0000-0000-000000000222'
        }),
        {
          id: 'dns-candidate',
          type: 'CNAME',
          name: 'test-old.example.com',
          content: 'legacy.cfargotunnel.com',
          tags: []
        },
        {
          id: 'dns-protected',
          type: 'A',
          name: 'api2.example.com',
          content: '198.51.100.20',
          tags: []
        }
      ], { page: 1, total_pages: 1 });
    }

    if (url.includes('/cfd_tunnel?')) {
      return apiSuccess([
        managedTunnel({
          id: 'tun-active',
          subdomain: 'live',
          sessionId: '00000000-0000-0000-0000-000000000111',
          status: 'healthy'
        }),
        managedTunnel({
          id: 'tun-orphan',
          subdomain: 'lost',
          sessionId: '00000000-0000-0000-0000-000000000333',
          status: 'down'
        }),
        managedTunnel({
          id: 'tun-protected',
          subdomain: 'api2',
          sessionId: '00000000-0000-0000-0000-000000000444',
          status: 'healthy'
        })
      ], { page: 1, total_pages: 1 });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const response = await worker.fetch(new Request('https://worker.example/audit'), createEnv());
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.counts.managed_safe, 1);
    assert.equal(payload.counts.managed_orphan_dns, 1);
    assert.equal(payload.counts.managed_orphan_tunnels, 1);
    assert.equal(payload.counts.unmanaged_candidate, 1);
    assert.equal(payload.counts.protected, 2);
    assert.equal(payload.managedActiveTunnels[0].classification, 'managed_safe');
    assert.equal(payload.managedOrphanDnsRecords[0].classification, 'managed_orphan');
    assert.equal(payload.unmanagedCandidates[0].classification, 'unmanaged_candidate');
    assert.equal(payload.protectedFindings[0].classification, 'protected');
  } finally {
    global.fetch = originalFetch;
  }
});

test('cleanup preview returns only eligible candidates and does not delete anything', async () => {
  const originalFetch = global.fetch;
  const calls = [];

  global.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    calls.push({ url, method: init.method || 'GET' });

    if (url.includes('/dns_records?')) {
      return apiSuccess([
        managedDnsRecord({
          id: 'dns-orphan',
          name: 'stale.example.com',
          tunnelId: 'tun-missing',
          sessionId: '00000000-0000-0000-0000-000000000222'
        }),
        {
          id: 'dns-candidate',
          type: 'CNAME',
          name: 'test-old.example.com',
          content: 'legacy.cfargotunnel.com',
          tags: []
        }
      ], { page: 1, total_pages: 1 });
    }

    if (url.includes('/cfd_tunnel?')) {
      return apiSuccess([
        managedTunnel({
          id: 'tun-orphan',
          subdomain: 'lost',
          sessionId: '00000000-0000-0000-0000-000000000333',
          status: 'down'
        })
      ], { page: 1, total_pages: 1 });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const response = await worker.fetch(new Request('https://worker.example/cleanup-preview', { method: 'POST' }), createEnv());
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.items.length, 3);
    assert.ok(payload.previewToken);
    assert.equal(calls.some((call) => call.method === 'DELETE'), false);
  } finally {
    global.fetch = originalFetch;
  }
});

test('cleanup confirm deletes only explicitly selected eligible resources', async () => {
  const originalFetch = global.fetch;
  const deleteCalls = [];

  global.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const method = init.method || 'GET';

    if (url.includes('/dns_records?')) {
      return apiSuccess([
        managedDnsRecord({
          id: 'dns-orphan',
          name: 'stale.example.com',
          tunnelId: 'tun-missing',
          sessionId: '00000000-0000-0000-0000-000000000222'
        }),
        {
          id: 'dns-candidate',
          type: 'CNAME',
          name: 'test-old.example.com',
          content: 'legacy.cfargotunnel.com',
          tags: []
        }
      ], { page: 1, total_pages: 1 });
    }

    if (url.includes('/cfd_tunnel?')) {
      return apiSuccess([
        managedTunnel({
          id: 'tun-orphan',
          subdomain: 'lost',
          sessionId: '00000000-0000-0000-0000-000000000333',
          status: 'down'
        })
      ], { page: 1, total_pages: 1 });
    }

    if (method === 'DELETE' && (url.includes('/dns_records/dns-orphan') || url.includes('/cfd_tunnel/tun-orphan'))) {
      deleteCalls.push(url);
      return apiSuccess({ ok: true });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const previewResponse = await worker.fetch(new Request('https://worker.example/cleanup-preview', { method: 'POST' }), createEnv());
    const previewPayload = await previewResponse.json();

    const confirmResponse = await worker.fetch(new Request('https://worker.example/cleanup-confirm', {
      method: 'POST',
      body: JSON.stringify({
        confirm: true,
        previewToken: previewPayload.previewToken,
        items: ['dns:dns-orphan', 'tunnel:tun-orphan']
      })
    }), createEnv());
    const confirmPayload = await confirmResponse.json();

    assert.equal(confirmResponse.status, 200);
    assert.deepEqual(deleteCalls.sort(), [
      'https://api.cloudflare.com/client/v4/accounts/acc-123/cfd_tunnel/tun-orphan',
      'https://api.cloudflare.com/client/v4/zones/zone-123/dns_records/dns-orphan'
    ]);
    assert.deepEqual(confirmPayload.results.map((item) => item.status), ['deleted', 'deleted']);
  } finally {
    global.fetch = originalFetch;
  }
});

test('cleanup confirm skips items that are no longer eligible', async () => {
  const originalFetch = global.fetch;
  let phase = 'preview';

  global.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;

    if (url.includes('/dns_records?')) {
      if (phase === 'preview') {
        return apiSuccess([{
          id: 'dns-candidate',
          type: 'CNAME',
          name: 'test-old.example.com',
          content: 'legacy.cfargotunnel.com',
          tags: []
        }], { page: 1, total_pages: 1 });
      }

      return apiSuccess([], { page: 1, total_pages: 1 });
    }

    if (url.includes('/cfd_tunnel?')) {
      return apiSuccess([], { page: 1, total_pages: 1 });
    }

    if ((init.method || 'GET') === 'DELETE') {
      throw new Error('No delete should happen for ineligible items');
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const previewResponse = await worker.fetch(new Request('https://worker.example/cleanup-preview', { method: 'POST' }), createEnv());
    const previewPayload = await previewResponse.json();
    phase = 'confirm';

    const confirmResponse = await worker.fetch(new Request('https://worker.example/cleanup-confirm', {
      method: 'POST',
      body: JSON.stringify({
        confirm: true,
        previewToken: previewPayload.previewToken,
        items: ['dns:dns-candidate']
      })
    }), createEnv());
    const confirmPayload = await confirmResponse.json();

    assert.equal(confirmResponse.status, 200);
    assert.equal(confirmPayload.results[0].status, 'skipped');
    assert.equal(confirmPayload.results[0].code, 'NO_LONGER_ELIGIBLE');
  } finally {
    global.fetch = originalFetch;
  }
});

test('session cleanup only deletes resources owned by the active session', async () => {
  const originalFetch = global.fetch;
  const deleteCalls = [];

  global.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const method = init.method || 'GET';

    if (url.endsWith('/dns_records/dns-active') && method === 'GET') {
      return apiSuccess(managedDnsRecord({
        id: 'dns-active',
        name: 'demo.example.com',
        tunnelId: 'tun-active',
        sessionId: '00000000-0000-0000-0000-000000000999'
      }));
    }

    if (url.endsWith('/cfd_tunnel/tun-active') && method === 'GET') {
      return apiSuccess(managedTunnel({
        id: 'tun-active',
        subdomain: 'demo',
        sessionId: '00000000-0000-0000-0000-000000000999',
        status: 'healthy'
      }));
    }

    if (method === 'DELETE') {
      deleteCalls.push(url);
      return apiSuccess({ ok: true });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const response = await worker.fetch(new Request('https://worker.example/cleanup', {
      method: 'DELETE',
      body: JSON.stringify({
        dnsId: 'dns-active',
        tunnelId: 'tun-active',
        sessionId: '00000000-0000-0000-0000-000000000999'
      })
    }), createEnv());
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(deleteCalls.sort(), [
      'https://api.cloudflare.com/client/v4/accounts/acc-123/cfd_tunnel/tun-active',
      'https://api.cloudflare.com/client/v4/zones/zone-123/dns_records/dns-active'
    ]);
    assert.deepEqual(payload.results.map((item) => item.status), ['deleted', 'deleted']);
  } finally {
    global.fetch = originalFetch;
  }
});

test('session cleanup tolerates whitespace around managed session identifiers', async () => {
  const originalFetch = global.fetch;
  const deleteCalls = [];

  global.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const method = init.method || 'GET';

    if (url.endsWith('/dns_records/dns-active') && method === 'GET') {
      return apiSuccess({
        ...managedDnsRecord({
          id: 'dns-active',
          name: 'demo.example.com',
          tunnelId: 'tun-active',
          sessionId: '00000000-0000-0000-0000-000000000999'
        }),
        comment: 'hport-managed session=00000000-0000-0000-0000-000000000999   subdomain=demo'
      });
    }

    if (url.endsWith('/cfd_tunnel/tun-active') && method === 'GET') {
      return apiSuccess(managedTunnel({
        id: 'tun-active',
        subdomain: 'demo',
        sessionId: '00000000-0000-0000-0000-000000000999',
        status: 'healthy'
      }));
    }

    if (method === 'DELETE') {
      deleteCalls.push(url);
      return apiSuccess({ ok: true });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const response = await worker.fetch(new Request('https://worker.example/cleanup', {
      method: 'DELETE',
      body: JSON.stringify({
        dnsId: 'dns-active',
        tunnelId: 'tun-active',
        sessionId: ' 00000000-0000-0000-0000-000000000999 '
      })
    }), createEnv());
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(deleteCalls.sort(), [
      'https://api.cloudflare.com/client/v4/accounts/acc-123/cfd_tunnel/tun-active',
      'https://api.cloudflare.com/client/v4/zones/zone-123/dns_records/dns-active'
    ]);
    assert.deepEqual(payload.results.map((item) => item.status), ['deleted', 'deleted']);
  } finally {
    global.fetch = originalFetch;
  }
});

test('scheduled cleanup deletes only managed orphan resources older than one day', async () => {
  const originalFetch = global.fetch;
  const deleteCalls = [];

  global.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const method = init.method || 'GET';

    if (url.includes('/dns_records?')) {
      return apiSuccess([
        {
          ...managedDnsRecord({
            id: 'dns-orphan',
            name: 'stale.example.com',
            tunnelId: 'tun-missing',
            sessionId: '00000000-0000-0000-0000-000000000222'
          }),
          modified_on: '2026-05-17T00:00:00.000Z'
        },
        {
          ...managedDnsRecord({
            id: 'dns-fresh',
            name: 'fresh.example.com',
            tunnelId: 'tun-fresh',
            sessionId: '00000000-0000-0000-0000-000000000223'
          }),
          modified_on: '2026-05-18T12:30:00.000Z'
        }
      ], { page: 1, total_pages: 1 });
    }

    if (url.includes('/cfd_tunnel?')) {
      return apiSuccess([
        {
          ...managedTunnel({
            id: 'tun-orphan',
            subdomain: 'lost',
            sessionId: '00000000-0000-0000-0000-000000000333',
            status: 'down'
          }),
          conns_inactive_at: '2026-05-17T00:00:00.000Z'
        },
        {
          ...managedTunnel({
            id: 'tun-fresh',
            subdomain: 'fresh',
            sessionId: '00000000-0000-0000-0000-000000000334',
            status: 'down'
          }),
          conns_inactive_at: '2026-05-18T12:30:00.000Z'
        }
      ], { page: 1, total_pages: 1 });
    }

    if (method === 'DELETE') {
      deleteCalls.push(url);
      return apiSuccess({ ok: true });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    await worker.scheduled({ scheduledTime: Date.parse('2026-05-19T00:00:00.000Z') }, createEnv(), {
      waitUntil(promise) {
        return promise;
      }
    });

    assert.deepEqual(deleteCalls.sort(), [
      'https://api.cloudflare.com/client/v4/accounts/acc-123/cfd_tunnel/tun-orphan',
      'https://api.cloudflare.com/client/v4/zones/zone-123/dns_records/dns-orphan'
    ]);
  } finally {
    global.fetch = originalFetch;
  }
});

test('scheduled cleanup skips fresh or clean resources', async () => {
  const originalFetch = global.fetch;
  let deleteCalled = false;

  global.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const method = init.method || 'GET';

    if (url.includes('/dns_records?')) {
      return apiSuccess([], { page: 1, total_pages: 1 });
    }

    if (url.includes('/cfd_tunnel?')) {
      return apiSuccess([], { page: 1, total_pages: 1 });
    }

    if (method === 'DELETE') {
      deleteCalled = true;
      return apiSuccess({ ok: true });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    await worker.scheduled({ scheduledTime: Date.parse('2026-05-19T00:00:00.000Z') }, createEnv(), {
      waitUntil(promise) {
        return promise;
      }
    });

    assert.equal(deleteCalled, false);
  } finally {
    global.fetch = originalFetch;
  }
});

test('create-tunnel rejects invalid subdomains before calling Cloudflare', async () => {
  const originalFetch = global.fetch;
  let wasCalled = false;

  global.fetch = async () => {
    wasCalled = true;
    throw new Error('should not reach Cloudflare');
  };

  try {
    const request = new Request('https://worker.example/create-tunnel', {
      method: 'POST',
      body: JSON.stringify({ subdomain: 'bad name' })
    });

    const response = await worker.fetch(request, createEnv());
    const payload = await response.json();

    assert.equal(response.status, 400);
    assert.match(payload.error, /letters, numbers, or hyphens/i);
    assert.equal(wasCalled, false);
  } finally {
    global.fetch = originalFetch;
  }
});
