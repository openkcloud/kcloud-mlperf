import { VersionService } from './version.service';

describe('VersionService', () => {
  let service: VersionService;

  beforeEach(() => {
    service = new VersionService();
  });

  it('getVersion() returns git_sha === "unknown" when env not set', () => {
    delete process.env.GIT_SHA;
    const version = service.getVersion();
    expect(version.git_sha).toBe('unknown');
  });

  it('getHealth() returns status === "ok"', () => {
    const health = service.getHealth();
    expect(health.status).toBe('ok');
  });
});
