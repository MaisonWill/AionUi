/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const spawnSyncMock = vi.fn();
vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof import('child_process')>('child_process');
  return {
    ...actual,
    spawnSync: (...args: any[]) => spawnSyncMock(...args),
  };
});

const statMock = vi.fn();
vi.mock('fs/promises', async () => {
  const actual = await vi.importActual<typeof import('fs/promises')>('fs/promises');
  return {
    ...actual,
    stat: (...args: any[]) => statMock(...args),
  };
});

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/aionui-test'),
  },
}));

import { CloudflaredBinaryManager } from '../../src/process/services/tunnel/CloudflaredBinaryManager';

describe('CloudflaredBinaryManager', () => {
  beforeEach(() => {
    spawnSyncMock.mockReset();
    statMock.mockReset();
  });

  it('uses PATH binary when available', async () => {
    spawnSyncMock.mockReturnValue({ status: 0 });
    const manager = new CloudflaredBinaryManager();

    const executable = await manager.resolveExecutablePath();
    expect(executable).toBe(process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
  });

  it('uses managed binary when already present', async () => {
    spawnSyncMock.mockReturnValue({ status: 127 });
    statMock.mockResolvedValue({ isFile: () => true });

    const manager = new CloudflaredBinaryManager();
    const executable = await manager.resolveExecutablePath('latest');

    expect(executable.includes('/tmp/aionui-test/bin/cloudflared/latest')).toBe(true);
  });
});
