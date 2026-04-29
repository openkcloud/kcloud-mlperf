import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as fs from 'fs';
import * as yaml from 'js-yaml';
import {
  ClusterYaml,
  ClusterYamlNode,
  DeviceEntry,
  DeviceState,
  DeviceType,
  DeviceVendor,
  NodeSummary,
  RESOURCE_NAMES,
  RegistryHealth,
  RegistrySource,
} from './device-registry.types';

const DEFAULT_CLUSTER_YAML =
  '/home/kcloud/mondrianai-etri-llm-deployments-a9c4c59c4869/config/cluster.yaml';

interface K8sNodeView {
  name: string;
  status: 'Ready' | 'NotReady' | 'Unknown';
  labels: Record<string, string>;
  allocatable: Record<string, string>;
}

export interface K8sClient {
  listNodes(): Promise<K8sNodeView[]>;
}

interface K8sRawNode {
  metadata?: { name?: string; labels?: Record<string, string> };
  status?: {
    allocatable?: Record<string, unknown>;
    conditions?: Array<{ type?: string; status?: string }>;
  };
}

@Injectable()
export class DeviceRegistryService implements OnModuleInit {
  private readonly logger = new Logger(DeviceRegistryService.name);
  private readonly clusterYamlPath: string;
  private clusterYaml: ClusterYaml | null = null;
  private clusterYamlError: string | null = null;
  private k8sClient: K8sClient | null = null;
  private lastK8sError: string | null = null;
  private lastSourceUsed: RegistrySource = 'cluster_yaml';
  private lastRefresh: string = new Date(0).toISOString();
  private cachedK8sNodes: K8sNodeView[] | null = null;

  constructor(clusterYamlPath?: string, k8sClient?: K8sClient) {
    this.clusterYamlPath = clusterYamlPath ?? DEFAULT_CLUSTER_YAML;
    if (k8sClient) this.k8sClient = k8sClient;
  }

  onModuleInit() {
    this.loadClusterYaml();
    if (!this.k8sClient) {
      this.k8sClient = this.buildDefaultK8sClient();
    }
  }

  setK8sClient(client: K8sClient | null) {
    this.k8sClient = client;
  }

  private loadClusterYaml() {
    try {
      const text = fs.readFileSync(this.clusterYamlPath, 'utf8');
      const parsed = yaml.load(text) as ClusterYaml;
      this.clusterYaml = parsed ?? {};
      this.clusterYamlError = null;
      const workers = parsed?.workers?.length ?? 0;
      const cps = parsed?.control_plane?.length ?? 0;
      const total = workers + cps;
      this.logger.log(
        `Loaded cluster.yaml from ${this.clusterYamlPath} (${total} nodes)`,
      );
    } catch (err) {
      this.clusterYaml = null;
      this.clusterYamlError = String((err as Error).message ?? err);
      this.logger.warn(
        `cluster.yaml unreadable at ${this.clusterYamlPath}: ${this.clusterYamlError}`,
      );
    }
  }

  private buildDefaultK8sClient(): K8sClient | null {
    try {
      // Dynamic import via eval keeps this optional — lets the service still
      // boot if @kubernetes/client-node isn't installed in some envs.
      const k8s = (eval('require') as NodeRequire)(
        '@kubernetes/client-node',
      ) as typeof import('@kubernetes/client-node');
      const kc = new k8s.KubeConfig();
      try {
        kc.loadFromDefault();
      } catch (e) {
        this.logger.warn('KubeConfig.loadFromDefault failed: ' + String(e));
        return null;
      }
      const api = kc.makeApiClient(k8s.CoreV1Api);
      return {
        async listNodes(): Promise<K8sNodeView[]> {
          const res: unknown = await api.listNode();
          // client-node v0.x returns { body }, v1.x returns the body directly
          const list = (res as { body?: unknown }).body ?? res;
          const items =
            (list as { items?: K8sRawNode[] }).items ?? ([] as K8sRawNode[]);
          return items.map((n) => {
            const name = n.metadata?.name ?? '';
            const labels = n.metadata?.labels ?? {};
            const allocatableRaw = n.status?.allocatable ?? {};
            const allocatable: Record<string, string> = {};
            for (const [k, v] of Object.entries(allocatableRaw)) {
              allocatable[k] = String(v);
            }
            const conditions = n.status?.conditions ?? [];
            const ready = conditions.find((c) => c.type === 'Ready');
            const status: 'Ready' | 'NotReady' | 'Unknown' =
              ready?.status === 'True'
                ? 'Ready'
                : ready?.status === 'False'
                  ? 'NotReady'
                  : 'Unknown';
            return { name, status, labels, allocatable };
          });
        },
      };
    } catch (err) {
      this.logger.warn('@kubernetes/client-node not available: ' + String(err));
      return null;
    }
  }

  /** Returns null if k8s API unreachable (caller falls back to cluster.yaml). */
  private async fetchK8sNodes(): Promise<K8sNodeView[] | null> {
    if (!this.k8sClient) {
      this.lastK8sError = 'k8s client not initialized';
      return null;
    }
    try {
      const nodes = await this.k8sClient.listNodes();
      this.lastK8sError = null;
      this.cachedK8sNodes = nodes;
      return nodes;
    } catch (err) {
      this.lastK8sError = String((err as Error).message ?? err);
      this.logger.warn(`k8s API unreachable: ${this.lastK8sError}`);
      return null;
    }
  }

  private allYamlNodes(): ClusterYamlNode[] {
    if (!this.clusterYaml) return [];
    return [
      ...(this.clusterYaml.control_plane ?? []),
      ...(this.clusterYaml.workers ?? []),
    ];
  }

  private vendorOf(yamlNode: ClusterYamlNode): DeviceVendor | null {
    const v = yamlNode.accelerator?.vendor?.toLowerCase();
    if (v === 'nvidia') return 'nvidia';
    if (v === 'furiosa') return 'furiosa';
    if (v === 'rebellions') return 'rebellions';
    if (v === 'intel') return 'intel';
    return null;
  }

  private typeOf(yamlNode: ClusterYamlNode): DeviceType {
    const t = yamlNode.accelerator?.type?.toLowerCase();
    if (t === 'gpu') return 'gpu';
    if (t === 'npu') return 'npu';
    return 'cpu';
  }

  private resourceNameFor(vendor: DeviceVendor | null): string | null {
    if (!vendor) return null;
    if (vendor === 'nvidia') return RESOURCE_NAMES.nvidia;
    if (vendor === 'furiosa') return RESOURCE_NAMES.furiosa;
    if (vendor === 'rebellions') return RESOURCE_NAMES.rebellions;
    return null;
  }

  private parseAllocatableCount(
    allocatable: Record<string, string>,
    resourceName: string | null,
  ): number | null {
    if (!resourceName) return null;
    const raw = allocatable[resourceName];
    if (raw === undefined) return null;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : null;
  }

  /** Split a model label like "L40 + A40" into individual SKU tokens. */
  private splitModels(model: string | undefined): string[] {
    if (!model) return [];
    return model
      .split(/[+,/]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  private k8sNodeStateFor(
    yamlNode: ClusterYamlNode,
    k8sNode: K8sNodeView | undefined,
  ): { state: DeviceState; k8s_status: DeviceEntry['k8s_node_status'] } {
    if (yamlNode.state === 'pending_join') {
      return { state: 'pending_join', k8s_status: 'Absent' };
    }
    if (!k8sNode) {
      // Has no entry in k8s — could mean unreachable API (caller decides)
      // or node hasn't joined.
      return { state: 'not_ready', k8s_status: 'Absent' };
    }
    if (k8sNode.status === 'Ready') {
      return { state: 'ready', k8s_status: 'Ready' };
    }
    if (k8sNode.status === 'NotReady') {
      return { state: 'not_ready', k8s_status: 'NotReady' };
    }
    return { state: 'unknown', k8s_status: 'Unknown' };
  }

  async getDevices(): Promise<DeviceEntry[]> {
    return (await this.refresh()).devices;
  }

  async getNodes(): Promise<NodeSummary[]> {
    return (await this.refresh()).nodes;
  }

  async getHealth(): Promise<RegistryHealth> {
    const { health } = await this.refresh();
    return health;
  }

  /** Refresh registry state: load yaml (if not already), query k8s, merge. */
  async refresh(): Promise<{
    devices: DeviceEntry[];
    nodes: NodeSummary[];
    health: RegistryHealth;
  }> {
    if (!this.clusterYaml && !this.clusterYamlError) {
      this.loadClusterYaml();
    }
    const k8sNodes = await this.fetchK8sNodes();
    const haveK8s = k8sNodes !== null;
    this.lastSourceUsed = haveK8s ? 'k8s' : 'cluster_yaml';
    this.lastRefresh = new Date().toISOString();

    const yamlNodes = this.allYamlNodes();
    const k8sIndex = new Map<string, K8sNodeView>();
    if (k8sNodes) {
      for (const n of k8sNodes) k8sIndex.set(n.name, n);
    }

    const devices: DeviceEntry[] = [];
    const nodes: NodeSummary[] = [];
    const devicePlugins: Record<string, boolean> = {};

    for (const yamlNode of yamlNodes) {
      const k8sNode = k8sIndex.get(yamlNode.name);
      const { state, k8s_status } = this.k8sNodeStateFor(yamlNode, k8sNode);
      const type = this.typeOf(yamlNode);
      const vendor = this.vendorOf(yamlNode);
      const resourceName = this.resourceNameFor(vendor);
      const allocatableCount =
        k8sNode && resourceName
          ? this.parseAllocatableCount(k8sNode.allocatable, resourceName)
          : null;
      const declaredCount = yamlNode.accelerator?.count ?? 0;
      const skuTokens = this.splitModels(yamlNode.accelerator?.model);
      const role: 'master' | 'worker' =
        yamlNode.role === 'master' ? 'master' : 'worker';

      // Device plugin detection: resource present in allocatable, with count > 0
      const pluginDetected =
        type !== 'cpu' && allocatableCount !== null && allocatableCount > 0;
      if (type !== 'cpu') devicePlugins[yamlNode.name] = pluginDetected;

      // Compose node summary
      nodes.push({
        name: yamlNode.name,
        role,
        state,
        k8s_node_status: k8s_status,
        accelerator_type: type,
        accelerator_vendor: vendor,
        accelerator_model: yamlNode.accelerator?.model ?? null,
        accelerator_count:
          allocatableCount !== null ? allocatableCount : declaredCount,
        device_plugin_detected: pluginDetected,
        source: haveK8s ? 'k8s' : 'cluster_yaml',
      });

      // Emit device entries for each accelerator slot. CPU/control-plane is
      // emitted as a single entry of type 'cpu' for completeness, but tests
      // and consumers typically filter to gpu|npu.
      if (type === 'cpu' || declaredCount === 0) {
        if (role === 'master') {
          devices.push({
            node: yamlNode.name,
            type: 'cpu',
            vendor: vendor ?? 'intel',
            model: yamlNode.accelerator?.model ?? 'cpu',
            slot_id: 0,
            state,
            k8s_node_status: k8s_status,
            allocatable_resource_name: null,
            allocatable_count: null,
            source: haveK8s ? 'k8s' : 'cluster_yaml',
          });
        }
        continue;
      }

      // Per-slot expansion. If model contains "L40 + A40" emit one entry per
      // SKU; otherwise emit `declaredCount` slots of the same model.
      const fallbackModel = yamlNode.accelerator?.model ?? '';
      const perSlotModels: string[] =
        skuTokens.length === declaredCount
          ? skuTokens
          : Array.from({ length: declaredCount }, () => fallbackModel);

      for (let i = 0; i < perSlotModels.length; i++) {
        // Per-slot state honors declared yaml state (pending_join etc.) and
        // k8s readiness. If the node is ready but allocatable count is less
        // than declared, mark the extra slots degraded.
        let slotState: DeviceState = state;
        if (
          state === 'ready' &&
          allocatableCount !== null &&
          i >= allocatableCount
        ) {
          slotState = 'degraded';
        }

        devices.push({
          node: yamlNode.name,
          type,
          vendor: vendor ?? 'nvidia',
          model: perSlotModels[i] || (yamlNode.accelerator?.model ?? ''),
          slot_id: i,
          state: slotState,
          k8s_node_status: k8s_status,
          allocatable_resource_name: resourceName,
          allocatable_count: allocatableCount,
          source: haveK8s ? 'k8s' : 'cluster_yaml',
        });
      }
    }

    const health: RegistryHealth = {
      cluster_yaml_readable: this.clusterYaml !== null,
      cluster_yaml_path: this.clusterYamlPath,
      k8s_api_reachable: haveK8s,
      k8s_api_error: this.lastK8sError,
      source_used: this.lastSourceUsed,
      device_plugins: devicePlugins,
      last_refresh: this.lastRefresh,
    };

    return { devices, nodes, health };
  }
}
