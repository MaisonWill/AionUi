/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { getCloudflaredBinaryManager } from './CloudflaredBinaryManager';

export type TunnelState = 'idle' | 'starting' | 'active' | 'error' | 'stopped';

export interface TunnelStatus {
  state: TunnelState;
  publicUrl?: string;
  localUrl?: string;
  error?: string;
  startedAt?: number;
}

const TRYCLOUDFLARE_URL_PATTERN = /https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/;

export class CloudflareTemporaryTunnelManager {
  private process: ChildProcessWithoutNullStreams | null = null;
  private status: TunnelStatus = { state: 'idle' };

  async start(localUrl: string): Promise<TunnelStatus> {
    await this.stop();

    this.status = {
      state: 'starting',
      localUrl,
      startedAt: Date.now(),
    };

    const executablePath = await getCloudflaredBinaryManager().resolveExecutablePath();

    return new Promise<TunnelStatus>((resolve, reject) => {
      let settled = false;
      const settleResolve = (value: TunnelStatus) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      const settleReject = (error: Error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };

      const child = spawn(executablePath, ['tunnel', '--url', localUrl], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      this.process = child;

      const startupTimeout = setTimeout(() => {
        const errorMessage = 'Timed out while waiting for Cloudflare temporary tunnel URL.';
        this.status = { ...this.status, state: 'error', error: errorMessage };
        this.stop().catch(() => {
          // noop
        });
        settleReject(new Error(errorMessage));
      }, 30000);

      const finalizeActive = (publicUrl: string) => {
        clearTimeout(startupTimeout);
        this.status = {
          ...this.status,
          state: 'active',
          publicUrl,
          error: undefined,
        };
        settleResolve(this.status);
      };

      const handleChunk = (chunk: string) => {
        const match = chunk.match(TRYCLOUDFLARE_URL_PATTERN);
        if (match?.[0]) {
          finalizeActive(match[0]);
        }
      };

      child.stdout.on('data', (buf) => {
        handleChunk(String(buf));
      });
      child.stderr.on('data', (buf) => {
        handleChunk(String(buf));
      });

      child.on('error', (error) => {
        clearTimeout(startupTimeout);
        const errorMessage =
          error.message && error.message.includes('ENOENT')
            ? 'Cloudflared is not installed or not found in PATH.'
            : error.message;
        this.status = {
          ...this.status,
          state: 'error',
          error: errorMessage,
        };
        settleReject(new Error(errorMessage));
      });

      child.on('exit', (code, signal) => {
        if (this.status.state === 'active') {
          this.status = {
            ...this.status,
            state: 'stopped',
            error: signal ? `Tunnel process exited by signal ${signal}.` : `Tunnel process exited with code ${code}.`,
          };
          return;
        }

        if (this.status.state === 'starting') {
          clearTimeout(startupTimeout);
          const errorMessage =
            signal !== null
              ? `Tunnel process exited before becoming active (signal: ${signal}).`
              : `Tunnel process exited before becoming active (code: ${code}).`;
          this.status = {
            ...this.status,
            state: 'error',
            error: errorMessage,
          };
          settleReject(new Error(errorMessage));
        }
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.process) {
      if (this.status.state === 'starting' || this.status.state === 'active') {
        this.status = { ...this.status, state: 'stopped' };
      }
      return;
    }

    const child = this.process;
    this.process = null;

    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        try {
          if (process.platform === 'win32') {
            if (child.pid) {
              spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
            }
          } else {
            child.kill('SIGKILL');
          }
        } catch {
          // noop
        }
        resolve();
      }, 3000);

      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });

      try {
        child.kill();
      } catch {
        clearTimeout(timer);
        resolve();
      }
    });

    this.status = {
      ...this.status,
      state: 'stopped',
    };
  }

  async restart(localUrl: string): Promise<TunnelStatus> {
    await this.stop();
    return this.start(localUrl);
  }

  getStatus(): TunnelStatus {
    return { ...this.status };
  }
}

let instance: CloudflareTemporaryTunnelManager | null = null;

export function getCloudflareTemporaryTunnelManager(): CloudflareTemporaryTunnelManager {
  if (!instance) {
    instance = new CloudflareTemporaryTunnelManager();
  }
  return instance;
}
