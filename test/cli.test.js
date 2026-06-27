import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import {
  checkCloudflared,
  createProgram,
  createTunnelPayload,
  handleTunnelOutput,
  normalizeTarget
} from '../index.js';

test('normalizeTarget keeps host:port and expands bare ports', () => {
  assert.equal(normalizeTarget('8080'), '127.0.0.1:8080');
  assert.equal(normalizeTarget('192.168.1.10:5000'), '192.168.1.10:5000');
});

test('createTunnelPayload trims subdomain and omits empty values', () => {
  assert.deepEqual(createTunnelPayload('  demo-app  ', false), {
    overwrite: false,
    subdomain: 'demo-app'
  });
  assert.deepEqual(createTunnelPayload('   ', true), {
    overwrite: true,
    subdomain: undefined
  });
});

test('handleTunnelOutput only marks tunnel live on ready message', () => {
  let readyCount = 0;

  handleTunnelOutput(Buffer.from('still connecting'), () => {
    readyCount += 1;
  });
  handleTunnelOutput(Buffer.from('Registered tunnel connection'), () => {
    readyCount += 1;
  });

  assert.equal(readyCount, 1);
});

test('checkCloudflared resolves based on child exit code', async () => {
  const ok = await checkCloudflared(() => {
    const child = new EventEmitter();
    process.nextTick(() => child.emit('close', 0));
    return child;
  });

  const fail = await checkCloudflared(() => {
    const child = new EventEmitter();
    process.nextTick(() => child.emit('error', new Error('missing')));
    return child;
  });

  assert.equal(ok, true);
  assert.equal(fail, false);
});

test('CLI success flow starts cloudflared and cleans up on SIGINT', async () => {
  const events = [];
  let cleanupPayload = null;
  const signalHandlers = new Map();

  const httpClient = {
    async post(url, body) {
      events.push({ type: 'post', url, body });
      return {
        data: {
          success: true,
          url: 'https://demo.example.com',
          token: 'token-123',
          tunnelId: 'tun-123',
          dnsId: 'dns-123',
          sessionId: '00000000-0000-0000-0000-000000000123',
          replacedExisting: false
        }
      };
    },
    async delete(url, options) {
      cleanupPayload = { url, data: options.data };
      return { data: { success: true } };
    }
  };

  const ui = {
    displayBanner() {
      events.push({ type: 'banner' });
    },
    displayTarget(target, subdomain) {
      events.push({ type: 'target', target, subdomain });
    },
    displaySuccess(url, target) {
      events.push({ type: 'success', url, target });
    },
    displayBackground(pid) {
      events.push({ type: 'background', pid });
    },
    displayOverwritePrompt() {
      events.push({ type: 'overwrite' });
    },
    displayError(message) {
      events.push({ type: 'error', message });
    }
  };

  const exitCodes = [];
  let resolveExit;
  const exitPromise = new Promise((resolve) => {
    resolveExit = resolve;
  });

  function spawnProcess(command, args) {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {
      events.push({ type: 'kill' });
    };

    if (args.includes('--version')) {
      process.nextTick(() => child.emit('close', 0));
      return child;
    }

    events.push({ type: 'spawn', command, args });
    process.nextTick(() => {
      child.stdout.emit('data', Buffer.from('Registered tunnel connection'));
    });
    return child;
  }

  const cli = createProgram({
    backendUrl: 'https://worker.example',
    httpClient,
    spawnProcess,
    ui,
    registerSignalHandler: (signal, handler) => {
      signalHandlers.set(signal, handler);
    },
    removeSignalHandler: (signal, handler) => {
      if (signalHandlers.get(signal) === handler) {
        signalHandlers.delete(signal);
      }
    },
    exitProcess: (code = 0) => {
      exitCodes.push(code);
      resolveExit();
    }
  });

  await cli.parseAsync(['node', 'hport', '8080', '-s', 'demo', '-y']);
  await signalHandlers.get('SIGINT')();
  await exitPromise;

  const spawnEvent = events.find((event) => event.type === 'spawn');
  assert.ok(spawnEvent);
  assert.deepEqual(spawnEvent.args, [
    'tunnel', 'run', '--protocol', 'http2', '--token', 'token-123', '--url', 'http://127.0.0.1:8080'
  ]);
  assert.deepEqual(cleanupPayload, {
    url: 'https://worker.example/cleanup',
    data: {
      tunnelId: 'tun-123',
      dnsId: 'dns-123',
      sessionId: '00000000-0000-0000-0000-000000000123'
    }
  });
  assert.deepEqual(exitCodes, [0]);
  assert.equal(signalHandlers.has('SIGINT'), false);
});

test('CLI background flow detaches cloudflared and exits without signal handlers', async () => {
  const events = [];
  const signalHandlers = new Map();
  const exitCodes = [];
  let resolveExit;
  const exitPromise = new Promise((resolve) => {
    resolveExit = resolve;
  });

  const httpClient = {
    async post() {
      return {
        data: {
          success: true,
          url: 'https://demo.example.com',
          token: 'token-123',
          tunnelId: 'tun-123',
          dnsId: 'dns-123',
          sessionId: '00000000-0000-0000-0000-000000000123',
          replacedExisting: false
        }
      };
    }
  };

  const ui = {
    displayBanner() {},
    displayTarget() {},
    displaySuccess(url, target) {
      events.push({ type: 'success', url, target });
    },
    displayBackground(pid) {
      events.push({ type: 'background', pid });
    },
    displayOverwritePrompt() {},
    displayError(message) {
      events.push({ type: 'error', message });
    }
  };

  function spawnProcess(command, args, options) {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdout.destroy = () => {
      events.push({ type: 'stdout-destroy' });
    };
    child.stderr.destroy = () => {
      events.push({ type: 'stderr-destroy' });
    };
    child.pid = 4242;
    child.unref = () => {
      events.push({ type: 'unref' });
    };
    child.kill = () => {
      events.push({ type: 'kill' });
    };

    if (args.includes('--version')) {
      process.nextTick(() => child.emit('close', 0));
      return child;
    }

    events.push({ type: 'spawn', command, args, options });
    process.nextTick(() => {
      child.stdout.emit('data', Buffer.from('Registered tunnel connection'));
    });
    return child;
  }

  const cli = createProgram({
    backendUrl: 'https://worker.example',
    httpClient,
    spawnProcess,
    ui,
    registerSignalHandler: (signal, handler) => {
      signalHandlers.set(signal, handler);
    },
    removeSignalHandler: (signal, handler) => {
      if (signalHandlers.get(signal) === handler) {
        signalHandlers.delete(signal);
      }
    },
    exitProcess: (code = 0) => {
      exitCodes.push(code);
      resolveExit();
    }
  });

  await cli.parseAsync(['node', 'hport', '8080', '-s', 'demo', '--bg']);
  await exitPromise;

  const spawnEvent = events.find((event) => event.type === 'spawn');
  assert.ok(spawnEvent);
  assert.deepEqual(spawnEvent.args, [
    'tunnel', 'run', '--protocol', 'http2', '--token', 'token-123', '--url', 'http://127.0.0.1:8080'
  ]);
  assert.deepEqual(spawnEvent.options, { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  assert.equal(events.some((event) => event.type === 'unref'), true);
  assert.equal(events.some((event) => event.type === 'background'), true);
  assert.deepEqual(exitCodes, [0]);
  assert.equal(signalHandlers.has('SIGINT'), false);
});
