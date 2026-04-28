import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

// Resolve package.json at runtime. The TS source lives at src/version/ but
// nest build outputs to dist/src/version/, so the relative offset to the
// project root differs between dev (ts-node) and prod (compiled). Try both,
// fall back to 'unknown' rather than crashing the process.
function loadPkgVersion(): string {
  const candidates = [
    path.resolve(__dirname, '../../../package.json'), // dist/src/version → repo root
    path.resolve(__dirname, '../../package.json'),    // src/version (dev / ts-node)
    path.resolve(process.cwd(), 'package.json'),      // last-resort
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const raw = fs.readFileSync(p, 'utf-8');
        const json = JSON.parse(raw) as { version?: string };
        if (typeof json.version === 'string') return json.version;
      }
    } catch {
      // continue
    }
  }
  return 'unknown';
}

@Injectable()
export class VersionService {
  private readonly logger = new Logger(VersionService.name);
  private readonly appVersion: string;

  constructor() {
    this.appVersion = loadPkgVersion();
    if (this.appVersion === 'unknown') {
      this.logger.warn('Could not locate package.json; reporting app_version as "unknown"');
    }
  }

  getVersion(): {
    git_sha: string;
    image_digest: string;
    build_time: string;
    node_version: string;
    app_version: string;
  } {
    return {
      git_sha: process.env.GIT_SHA ?? 'unknown',
      image_digest: process.env.IMAGE_DIGEST ?? 'unknown',
      // BUILD_TIME is set at image build time; falls back to runtime ISO string
      build_time: process.env.BUILD_TIME ?? new Date().toISOString(),
      node_version: process.version,
      app_version: this.appVersion,
    };
  }

  getHealth(): { status: string; uptime_seconds: number; timestamp: string } {
    return {
      status: 'ok',
      uptime_seconds: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  }
}
