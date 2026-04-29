/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'events';

const spawnSyncMock = vi.fn();
vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof import('child_process')>('child_process');
  return {
    ...actual,
    spawnSync: (...args: any[]) => spawnSyncMock(...args),
  };
});

const statMock = vi.fn();
const mkdirMock = vi.fn();
const readFileMock = vi.fn();
const renameMock = vi.fn();
const chmodMock = vi.fn();
const unlinkMock = vi.fn();
const writeFileMock = vi.fn();
vi.mock('fs/promises', async () => {
  const actual = await vi.importActual<typeof import('fs/promises')>('fs/promises');
  return {
    ...actual,
    stat: (...args: any[]) => statMock(...args),
    mkdir: (...args: any[]) => mkdirMock(...args),
    readFile: (...args: any[]) => readFileMock(...args),
    rename: (...args: any[]) => renameMock(...args),
    chmod: (...args: any[]) => chmodMock(...args),
    unlink: (...args: any[]) => unlinkMock(...args),
    writeFile: (...args: any[]) => writeFileMock(...args),
  };
});

const createWriteStreamMock = vi.fn();
const existsSyncMock = vi.fn();
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    createWriteStream: (...args: any[]) => createWriteStreamMock(...args),
    existsSync: (...args: any[]) => existsSyncMock(...args),
  };
});

const httpsGetMock = vi.fn();
vi.mock('https', async () => {
  const actual = await vi.importActual<typeof import('https')>('https');
  return {
    ...actual,
    get: (...args: any[]) => httpsGetMock(...args),
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
    mkdirMock.mockReset();
    readFileMock.mockReset();
    renameMock.mockReset();
    chmodMock.mockReset();
    unlinkMock.mockReset();
    writeFileMock.mockReset();
    createWriteStreamMock.mockReset();
    existsSyncMock.mockReset();
    httpsGetMock.mockReset();
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

  it('downloads managed binary when not found in PATH and not present locally', async () => {
    spawnSyncMock.mockReturnValue({ status: 127 });
    statMock.mockRejectedValue(new Error('not found'));
    mkdirMock.mockResolvedValue(undefined);
    renameMock.mockResolvedValue(undefined);
    chmodMock.mockResolvedValue(undefined);
    unlinkMock.mockResolvedValue(undefined);
    writeFileMock.mockResolvedValue(undefined);
    existsSyncMock.mockReturnValue(true);

    const writeStream = new EventEmitter() as any;
    writeStream.close = vi.fn();
    createWriteStreamMock.mockReturnValue(writeStream);

    httpsGetMock.mockImplementation((url: string, cb: (res: any) => void) => {
      const res = new EventEmitter() as any;
      res.statusCode = 200;
      res.headers = {};
      res.pipe = () => {
        setTimeout(() => writeStream.emit('finish'), 0);
      };
      cb(res);
      return { on: vi.fn() };
    });

    readFileMock.mockImplementation(async (path: string) => {
      if (String(path).endsWith('.sha256')) {
        return '837fa4675d0ea98b79c41533ed9f35feefd73b7b88ca9134fd8a750cb7863ffc  cloudflared';
      }
      return Buffer.from('test-bytes');
    });

    const manager = new CloudflaredBinaryManager();
    const executable = await manager.resolveExecutablePath('latest');

    expect(httpsGetMock).toHaveBeenCalled();
    expect(renameMock).toHaveBeenCalled();
    expect(writeFileMock).toHaveBeenCalled();
    expect(executable.includes('/tmp/aionui-test/bin/cloudflared/latest')).toBe(true);
  });
});
