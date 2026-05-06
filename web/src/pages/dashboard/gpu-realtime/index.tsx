import { PrometheusIframeDashboard } from '@/components/benchmark-page';

// Re-export helpers so existing imports from this module still resolve
export { getGpuPrometheusUrl, deriveState } from '@/components/benchmark-page';

const GpuRealtimePage = () => (
  <PrometheusIframeDashboard
    title="Live GPU Dashboard"
    fallbackMessage="Prometheus unavailable — install kube-prometheus-stack and set VITE__APP_GPU_PROMETHEUS_URL"
  />
);

export default GpuRealtimePage;
