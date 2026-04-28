import { Injectable } from '@nestjs/common';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const pkg = require('../../package.json');

@Injectable()
export class VersionService {
  private readonly appVersion: string;

  constructor() {
    this.appVersion = pkg.version as string;
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
