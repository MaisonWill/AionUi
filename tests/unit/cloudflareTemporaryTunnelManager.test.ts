/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const spawnMock = vi.fn();
vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof import('child_process')>('child_process');
  return {
    ...actual,
    spawn: (...args: any[]) => spawnMock(...args),
  };
});

vi.mock('../../src/process/services/tunnel/CloudflaredBinaryManager', () => ({
  getCloudflaredBinaryManager: () => ({
    resolveExecutablePath: vi.fn(async () => '/tmp/cloudflared'),
  }),
}));

import { CloudflareTemporaryTunnelManager } from '../../src/process/services/tunnel/CloudflareTemporaryTunnelManager';

function makeChildProcess() {
  const proc = new EventEmitter() as any;
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.kill = vi.fn(() => true);
  proc.once = proc.on.bind(proc);
  proc.pid = 1234;
  return proc;
}

describe('CloudflareTemporaryTunnelManager', () => {
  beforeEach(() => {
    spawnMock.mockReset();
  });

  it('parses trycloudflare URL and becomes active', async () => {
    const proc = makeChildProcess();
    spawnMock.mockReturnValue(proc);

    const manager = new CloudflareTemporaryTunnelManager();
    const pending = manager.start('http://127.0.0.1:3000');

    proc.stderr.write('INF Visit https://demo-123.trycloudflare.com for tunnel');

    const status = await pending;
    expect(status.state).toBe('active');
    expect(status.publicUrl).toBe('https://demo-123.trycloudflare.com');
  });

  it('sets stopped state when process exits after active', async () => {
    const proc = makeChildProcess();
    spawnMock.mockReturnValue(proc);

    const manager = new CloudflareTemporaryTunnelManager();
    const pending = manager.start('http://127.0.0.1:3000');
    proc.stdout.write('https://demo-123.trycloudflare.com');
    await pending;

    proc.emit('exit', 0, null);
    expect(manager.getStatus().state).toBe('stopped');
  });
});
