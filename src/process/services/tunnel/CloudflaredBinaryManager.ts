/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { app } from 'electron';
import { createHash } from 'crypto';
import { createWriteStream, existsSync } from 'fs';
import { chmod, mkdir, readFile, rename, stat, unlink, writeFile } from 'fs/promises';
import { get } from 'https';
import { join } from 'path';
import { spawnSync } from 'child_process';

const DEFAULT_VERSION = 'latest';

function getPlatformAssetName(): string {
  const arch = process.arch;
  const platform = process.platform;

  if (platform === 'darwin') {
    if (arch === 'arm64') return 'cloudflared-darwin-arm64.tgz';
    return 'cloudflared-darwin-amd64.tgz';
  }

  if (platform === 'win32') {
    if (arch === 'arm64') return 'cloudflared-windows-arm64.exe';
    return 'cloudflared-windows-amd64.exe';
  }

  if (arch === 'arm64') return 'cloudflared-linux-arm64';
  return 'cloudflared-linux-amd64';
}

function getExecutableName(): string {
  return process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';
}

async function downloadFile(url: string, destination: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const req = get(url, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        void downloadFile(res.headers.location, destination).then(resolve).catch(reject);
        return;
      }

      if (!res.statusCode || res.statusCode >= 400) {
        reject(new Error(`Download failed (${res.statusCode ?? 'unknown'}) for ${url}`));
        return;
      }

      const file = createWriteStream(destination);
      res.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
      file.on('error', reject);
    });
    req.on('error', reject);
  });
}

async function maybeVerifyChecksum(targetPath: string, checksumUrl: string): Promise<void> {
  const checksumPath = `${targetPath}.sha256`;
  try {
    await downloadFile(checksumUrl, checksumPath);
    const checksumContent = await readFile(checksumPath, 'utf8');
    const expected = checksumContent.trim().split(/\s+/)[0];
    if (!expected) return;
    const bytes = await readFile(targetPath);
    const actual = createHash('sha256').update(bytes).digest('hex');
    if (actual !== expected) {
      throw new Error('Checksum verification failed for downloaded cloudflared binary.');
    }
  } finally {
    await unlink(checksumPath).catch(() => {
      // noop
    });
  }
}

export class CloudflaredBinaryManager {
  private resolvedPath: string | null = null;

  async resolveExecutablePath(version = DEFAULT_VERSION): Promise<string> {
    if (this.resolvedPath) {
      return this.resolvedPath;
    }

    const fromPath = this.findInPath();
    if (fromPath) {
      this.resolvedPath = fromPath;
      return fromPath;
    }

    const executablePath = this.getManagedExecutablePath(version);
    if (await this.isExecutable(executablePath)) {
      this.resolvedPath = executablePath;
      return executablePath;
    }

    await this.downloadManagedBinary(version, executablePath);
    this.resolvedPath = executablePath;
    return executablePath;
  }

  private findInPath(): string | null {
    const binName = getExecutableName();
    const check = spawnSync(binName, ['--version'], { stdio: 'ignore' });
    if (check.status === 0 || check.status === 1) {
      return binName;
    }
    return null;
  }

  private getManagedExecutablePath(version: string): string {
    const userData = app.getPath('userData');
    return join(userData, 'bin', 'cloudflared', version, getExecutableName());
  }

  private async isExecutable(filePath: string): Promise<boolean> {
    try {
      const info = await stat(filePath);
      return info.isFile();
    } catch {
      return false;
    }
  }

  private async downloadManagedBinary(version: string, executablePath: string): Promise<void> {
    const directory = join(app.getPath('userData'), 'bin', 'cloudflared', version);
    await mkdir(directory, { recursive: true });

    const asset = getPlatformAssetName();
    const downloadUrl = `https://github.com/cloudflare/cloudflared/releases/${version}/download/${asset}`;
    const tmpPath = `${executablePath}.tmp`;

    await downloadFile(downloadUrl, tmpPath);

    const checksumUrl = `${downloadUrl}.sha256`;
    const checksumTarget = asset.endsWith('.tgz') ? tmpPath : executablePath;
    if (!asset.endsWith('.tgz')) {
      await rename(tmpPath, executablePath);
    }
    try {
      await maybeVerifyChecksum(checksumTarget, checksumUrl);
    } catch (error: any) {
      const message = error?.message ?? String(error);
      if (message.includes('Download failed')) {
        console.warn('[CloudflaredBinaryManager] Checksum file unavailable, skipping verification:', message);
      } else {
        await unlink(executablePath).catch(() => {
          // noop
        });
        await unlink(tmpPath).catch(() => {
          // noop
        });
        throw error;
      }
    }

    if (asset.endsWith('.tgz')) {
      const extract = spawnSync('tar', ['-xzf', tmpPath, '-C', directory]);
      if (extract.status !== 0) {
        throw new Error(`Failed to extract cloudflared archive: ${extract.stderr?.toString() || 'unknown error'}`);
      }
      await unlink(tmpPath).catch(() => {
        // noop
      });
    }

    if (process.platform !== 'win32') {
      await chmod(executablePath, 0o755);
    }

    await writeFile(join(directory, 'VERSION'), version);

    if (!existsSync(executablePath)) {
      throw new Error('Failed to install cloudflared binary.');
    }
  }
}

let singleton: CloudflaredBinaryManager | null = null;

export function getCloudflaredBinaryManager(): CloudflaredBinaryManager {
  if (!singleton) singleton = new CloudflaredBinaryManager();
  return singleton;
}
