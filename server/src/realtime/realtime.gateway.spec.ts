import { RealtimeGateway, SSE_KEEPALIVE_MS } from './realtime.gateway';

describe('RealtimeGateway keepalive', () => {
  let gateway: RealtimeGateway;

  beforeEach(() => {
    gateway = new RealtimeGateway(null);
  });

  it('does not request keepalive when no subscribers are attached', () => {
    expect(gateway.shouldEmitKeepalive()).toBe(false);
  });

  it('requests keepalive after the interval has elapsed since last emit', () => {
    gateway.incrementSubscribers();
    const t0 = 1_000_000_000_000;
    expect(gateway.shouldEmitKeepalive(t0)).toBe(true);
    gateway.markKeepaliveEmitted(t0);

    // Just before the interval — should NOT emit yet.
    expect(gateway.shouldEmitKeepalive(t0 + SSE_KEEPALIVE_MS - 1)).toBe(false);

    // At the interval — should emit again.
    expect(gateway.shouldEmitKeepalive(t0 + SSE_KEEPALIVE_MS)).toBe(true);
  });

  it('subscriberCount tracks increment/decrement and never goes negative', () => {
    expect(gateway.subscriberCount).toBe(0);
    gateway.incrementSubscribers();
    gateway.incrementSubscribers();
    expect(gateway.subscriberCount).toBe(2);
    gateway.decrementSubscribers();
    gateway.decrementSubscribers();
    gateway.decrementSubscribers();
    expect(gateway.subscriberCount).toBe(0);
  });
});
