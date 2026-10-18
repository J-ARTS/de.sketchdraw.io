import type { ComponentDefinition, ComponentSet } from '../domain/types';
import { OFFICIAL_ICON_SVGS, type OfficialIconType } from './official-icons';

export function deepFreezeComponentSet(set: ComponentSet): ComponentSet {
  for (const comp of set.components) {
    Object.freeze(comp.style);
    if (comp.aliases) {
      Object.freeze(comp.aliases);
    }
    if (comp.metadata) {
      Object.freeze(comp.metadata);
    }
    if (comp.widgets) {
      for (const widget of comp.widgets) {
        if (widget.options) {
          Object.freeze(widget.options);
        }
        Object.freeze(widget);
      }
      Object.freeze(comp.widgets);
    }
    Object.freeze(comp);
  }
  Object.freeze(set.components);
  Object.freeze(set);
  return set;
}

export function deepFreezeComponentSets(sets: ComponentSet[]): ComponentSet[] {
  for (const set of sets) {
    deepFreezeComponentSet(set);
  }
  Object.freeze(sets);
  return sets;
}

// Own generic vector symbols created specifically for de.sketchdraw.io (no vendor trademark assets)
const ICON_SERVICE =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2" ry="2"/><line x1="7" y1="9" x2="17" y2="9"/><line x1="7" y1="13" x2="14" y2="13"/><circle cx="17" cy="14" r="1.5"/></svg>';

const ICON_DATABASE =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5 V19 C4 20.6 7.6 22 12 22 C16.4 22 20 20.6 20 19 V5"/><path d="M4 12 C4 13.6 7.6 15 12 15 C16.4 15 20 13.6 20 12"/></svg>';

const ICON_QUEUE =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="3" ry="3"/><line x1="7" y1="9" x2="7" y2="15"/><line x1="12" y1="9" x2="12" y2="15"/><line x1="17" y1="9" x2="17" y2="15"/></svg>';

const ICON_USER =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20 C4 16 7.6 14 12 14 C16.4 14 20 16 20 20"/></svg>';

const ICON_NETWORK =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="2.5"/><circle cx="5" cy="19" r="2.5"/><circle cx="19" cy="19" r="2.5"/><line x1="10.5" y1="7" x2="6.5" y2="17"/><line x1="13.5" y1="7" x2="17.5" y2="17"/><line x1="7.5" y1="19" x2="16.5" y2="19"/></svg>';

const ICON_RESOURCE_CARD =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M2 16h20"/><rect x="5" y="7" width="5" height="5" rx="1"/><path d="M13 8h6M13 11h4"/></svg>';

const RESOURCE_CARD_COMPONENTS: ComponentDefinition[] = [
  {
    type: 'generic.resource-card',
    name: 'Ressourcenkarte',
    provider: 'generic',
    category: 'Advanced',
    aliases: ['ResourceCard', 'CloudResource', 'Dokumentation', 'Links', 'Architekturkarte'],
    defaultWidth: 360,
    defaultHeight: 150,
    style: {
      stroke: '#cbd5e1',
      fill: '#ffffff',
      strokeWidth: 1.5,
      fontSize: 20,
      textAlign: 'left',
    },
    metadata: {
      provenance: 'sketchdraw-generic-symbol',
      'resource-card:icon': 'generic.service',
      'resource-card:link-order': '',
    },
    iconSvg: ICON_RESOURCE_CARD,
  },
];

const GENERIC_COMPONENTS: ComponentDefinition[] = [
  {
    type: 'generic.service',
    name: 'Service',
    provider: 'generic',
    category: 'Compute',
    aliases: ['API', 'Dienst', 'Backend', 'Microservice'],
    defaultWidth: 160,
    defaultHeight: 80,
    style: {
      stroke: '#334155',
      fill: '#f8fafc',
    },
    metadata: {
      provenance: 'sketchdraw-generic-symbol',
    },
    iconSvg: ICON_SERVICE,
    widgets: [
      {
        key: 'protocol',
        label: 'Protokoll',
        kind: 'select',
        options: ['HTTPS', 'gRPC', 'WebSocket', 'TCP'],
      },
      {
        key: 'replicas',
        label: 'Instanzen',
        kind: 'number',
      },
    ],
  },
  {
    type: 'generic.database',
    name: 'Database',
    provider: 'generic',
    category: 'Database',
    aliases: ['Datenbank', 'DB', 'SQL', 'Storage'],
    defaultWidth: 160,
    defaultHeight: 80,
    style: {
      stroke: '#334155',
      fill: '#f1f5f9',
    },
    metadata: {
      provenance: 'sketchdraw-generic-symbol',
    },
    iconSvg: ICON_DATABASE,
    widgets: [
      {
        key: 'engine',
        label: 'Engine',
        kind: 'text',
      },
      {
        key: 'storageGb',
        label: 'Speicher (GB)',
        kind: 'number',
      },
    ],
  },
  {
    type: 'generic.queue',
    name: 'Queue',
    provider: 'generic',
    category: 'Messaging',
    aliases: ['Warteschlange', 'Broker', 'Topic', 'Events'],
    defaultWidth: 160,
    defaultHeight: 80,
    style: {
      stroke: '#334155',
      fill: '#f8fafc',
    },
    metadata: {
      provenance: 'sketchdraw-generic-symbol',
    },
    iconSvg: ICON_QUEUE,
    widgets: [
      {
        key: 'delivery',
        label: 'Zustellung',
        kind: 'select',
        options: ['at-least-once', 'exactly-once', 'fifo'],
      },
      {
        key: 'retentionHours',
        label: 'Aufbewahrung (Stunden)',
        kind: 'number',
      },
    ],
  },
  {
    type: 'generic.user',
    name: 'User',
    provider: 'generic',
    category: 'Identity',
    aliases: ['Nutzer', 'Client', 'Actor', 'Person'],
    defaultWidth: 140,
    defaultHeight: 80,
    style: {
      stroke: '#334155',
      fill: '#ffffff',
    },
    metadata: {
      provenance: 'sketchdraw-generic-symbol',
    },
    iconSvg: ICON_USER,
    widgets: [
      {
        key: 'role',
        label: 'Rolle',
        kind: 'text',
      },
    ],
  },
  {
    type: 'generic.network',
    name: 'Network',
    provider: 'generic',
    category: 'Networking',
    aliases: ['Netzwerk', 'VPC', 'Subnet', 'Gateway'],
    defaultWidth: 160,
    defaultHeight: 80,
    style: {
      stroke: '#334155',
      fill: '#f8fafc',
    },
    metadata: {
      provenance: 'sketchdraw-generic-symbol',
    },
    iconSvg: ICON_NETWORK,
    widgets: [
      {
        key: 'cidr',
        label: 'CIDR',
        kind: 'text',
      },
    ],
  },
];

export const PROVIDER_META = {
  aws: {
    stroke: '#b45309', fill: '#fffbeb',
    source: 'https://aws.amazon.com/architecture/icons/',
    terms: 'AWS Architecture Icons terms and AWS trademarks apply.',
  },
  azure: {
    stroke: '#0369a1', fill: '#f0f9ff',
    source: 'https://learn.microsoft.com/azure/architecture/icons/',
    terms: 'Microsoft Azure architecture icon terms and Microsoft trademarks apply.',
  },
  gcp: {
    stroke: '#166534', fill: '#f0fdf4',
    source: 'https://cloud.google.com/icons',
    terms: 'Google Cloud official icon terms and Google trademarks apply.',
  },
  kubernetes: {
    stroke: '#326ce5', fill: '#eff6ff',
    source: 'https://github.com/kubernetes/community/tree/master/icons',
    terms: 'Apache-2.0 or CC-BY-4.0; Kubernetes trademark guidelines apply.',
  },
} as const;

type OfficialProvider = keyof typeof PROVIDER_META;
interface OfficialComponentSpec {
  type: OfficialIconType;
  name: string;
  provider: OfficialProvider;
  category: string;
  aliases: string[];
  documentationUrl: string;
  widgets?: NonNullable<ComponentDefinition['widgets']>;
}

function officialComponent(spec: OfficialComponentSpec): ComponentDefinition {
  const theme = PROVIDER_META[spec.provider];
  return {
    ...spec,
    aliases: spec.aliases.map((alias) => alias.replaceAll(' ', '-')),
    defaultWidth: 160,
    defaultHeight: 80,
    style: { stroke: theme.stroke, fill: theme.fill },
    metadata: {
      provenance: 'official-architecture-icon',
      source: theme.source,
      terms: theme.terms,
    },
    iconSvg: OFFICIAL_ICON_SVGS[spec.type],
  };
}

const AWS_COMPONENTS: ComponentDefinition[] = [
  officialComponent({ type: 'aws.compute.instance', name: 'Amazon EC2', provider: 'aws', category: 'Compute', aliases: ['Compute', 'EC2', 'Instance', 'VM'], documentationUrl: 'https://docs.aws.amazon.com/ec2/', widgets: [{ key: 'region', label: 'Region', kind: 'text' }, { key: 'vcpu', label: 'vCPU', kind: 'number' }] }),
  officialComponent({ type: 'aws.compute.lambda', name: 'AWS Lambda', provider: 'aws', category: 'Compute', aliases: ['Lambda', 'Function', 'Serverless'], documentationUrl: 'https://docs.aws.amazon.com/lambda/' }),
  officialComponent({ type: 'aws.storage.object', name: 'Amazon S3', provider: 'aws', category: 'Storage', aliases: ['S3', 'Bucket', 'Object Storage'], documentationUrl: 'https://docs.aws.amazon.com/s3/' }),
  officialComponent({ type: 'aws.database.relational', name: 'Amazon RDS', provider: 'aws', category: 'Database', aliases: ['RDS', 'Relational Database', 'SQL'], documentationUrl: 'https://docs.aws.amazon.com/rds/' }),
  officialComponent({ type: 'aws.database.dynamodb', name: 'Amazon DynamoDB', provider: 'aws', category: 'Database', aliases: ['DynamoDB', 'NoSQL', 'Database'], documentationUrl: 'https://docs.aws.amazon.com/dynamodb/' }),
  officialComponent({ type: 'aws.interface.api-gateway', name: 'Amazon API Gateway', provider: 'aws', category: 'Interface', aliases: ['API Gateway', 'REST', 'HTTP API'], documentationUrl: 'https://docs.aws.amazon.com/apigateway/' }),
  officialComponent({ type: 'aws.messaging.sqs', name: 'Amazon SQS', provider: 'aws', category: 'Messaging', aliases: ['SQS', 'Queue', 'Messaging'], documentationUrl: 'https://docs.aws.amazon.com/sqs/' }),
  officialComponent({ type: 'aws.containers.eks', name: 'Amazon EKS', provider: 'aws', category: 'Containers', aliases: ['EKS', 'Kubernetes', 'Container'], documentationUrl: 'https://docs.aws.amazon.com/eks/' }),
];

const AZURE_COMPONENTS: ComponentDefinition[] = [
  officialComponent({ type: 'azure.compute.vm', name: 'Azure Virtual Machine', provider: 'azure', category: 'Compute', aliases: ['Virtual Machine', 'VM', 'Compute', 'Server'], documentationUrl: 'https://learn.microsoft.com/azure/virtual-machines/' }),
  officialComponent({ type: 'azure.compute.functions', name: 'Azure Functions', provider: 'azure', category: 'Compute', aliases: ['Functions', 'Function App', 'Serverless'], documentationUrl: 'https://learn.microsoft.com/azure/azure-functions/' }),
  officialComponent({ type: 'azure.storage.blob', name: 'Azure Storage Account', provider: 'azure', category: 'Storage', aliases: ['Blob', 'Storage', 'Container', 'Object Storage'], documentationUrl: 'https://learn.microsoft.com/azure/storage/' }),
  officialComponent({ type: 'azure.database.sql', name: 'Azure SQL Database', provider: 'azure', category: 'Database', aliases: ['SQL', 'Database', 'Relational'], documentationUrl: 'https://learn.microsoft.com/azure/azure-sql/' }),
  officialComponent({ type: 'azure.database.cosmos', name: 'Azure Cosmos DB', provider: 'azure', category: 'Database', aliases: ['Cosmos DB', 'NoSQL', 'Database'], documentationUrl: 'https://learn.microsoft.com/azure/cosmos-db/' }),
  officialComponent({ type: 'azure.network.vnet', name: 'Azure Virtual Network', provider: 'azure', category: 'Networking', aliases: ['Virtual Network', 'VNet', 'Network'], documentationUrl: 'https://learn.microsoft.com/azure/virtual-network/' }),
  officialComponent({ type: 'azure.security.key-vault', name: 'Azure Key Vault', provider: 'azure', category: 'Security', aliases: ['Key Vault', 'Secret', 'Keys'], documentationUrl: 'https://learn.microsoft.com/azure/key-vault/' }),
  officialComponent({ type: 'azure.containers.aks', name: 'Azure Kubernetes Service', provider: 'azure', category: 'Containers', aliases: ['AKS', 'Kubernetes', 'Container'], documentationUrl: 'https://learn.microsoft.com/azure/aks/' }),
];

const GCP_COMPONENTS: ComponentDefinition[] = [
  officialComponent({ type: 'gcp.compute.instance', name: 'Compute Engine', provider: 'gcp', category: 'Compute', aliases: ['GCE', 'Compute', 'VM'], documentationUrl: 'https://cloud.google.com/compute/docs' }),
  officialComponent({ type: 'gcp.compute.cloud-run', name: 'Cloud Run', provider: 'gcp', category: 'Compute', aliases: ['Cloud Run', 'Serverless', 'Container'], documentationUrl: 'https://cloud.google.com/run/docs' }),
  officialComponent({ type: 'gcp.storage.object', name: 'Cloud Storage', provider: 'gcp', category: 'Storage', aliases: ['GCS', 'Bucket', 'Object Storage'], documentationUrl: 'https://cloud.google.com/storage/docs' }),
  officialComponent({ type: 'gcp.database.sql', name: 'Cloud SQL', provider: 'gcp', category: 'Database', aliases: ['Cloud SQL', 'SQL', 'Database'], documentationUrl: 'https://cloud.google.com/sql/docs' }),
  officialComponent({ type: 'gcp.analytics.bigquery', name: 'BigQuery', provider: 'gcp', category: 'Analytics', aliases: ['BigQuery', 'Warehouse', 'Analytics'], documentationUrl: 'https://cloud.google.com/bigquery/docs' }),
  officialComponent({ type: 'gcp.containers.gke', name: 'Google Kubernetes Engine', provider: 'gcp', category: 'Containers', aliases: ['GKE', 'Kubernetes', 'Container'], documentationUrl: 'https://cloud.google.com/kubernetes-engine/docs' }),
  officialComponent({ type: 'gcp.ai.vertex', name: 'Vertex AI', provider: 'gcp', category: 'AI', aliases: ['Vertex AI', 'Machine Learning', 'ML'], documentationUrl: 'https://cloud.google.com/vertex-ai/docs' }),
  officialComponent({ type: 'gcp.interface.apigee', name: 'Apigee API Management', provider: 'gcp', category: 'Interface', aliases: ['Apigee', 'API Management', 'Gateway'], documentationUrl: 'https://cloud.google.com/apigee/docs' }),
];

const KUBERNETES_COMPONENTS: ComponentDefinition[] = [
  officialComponent({ type: 'kubernetes.workload.pod', name: 'Pod', provider: 'kubernetes', category: 'Workloads', aliases: ['Pod', 'Container', 'Workload'], documentationUrl: 'https://kubernetes.io/docs/concepts/workloads/pods/' }),
  officialComponent({ type: 'kubernetes.workload.deployment', name: 'Deployment', provider: 'kubernetes', category: 'Workloads', aliases: ['Deployment', 'ReplicaSet', 'Workload'], documentationUrl: 'https://kubernetes.io/docs/concepts/workloads/controllers/deployment/' }),
  officialComponent({ type: 'kubernetes.network.service', name: 'Service', provider: 'kubernetes', category: 'Networking', aliases: ['Service', 'ClusterIP', 'LoadBalancer'], documentationUrl: 'https://kubernetes.io/docs/concepts/services-networking/service/' }),
  officialComponent({ type: 'kubernetes.network.ingress', name: 'Ingress', provider: 'kubernetes', category: 'Networking', aliases: ['Ingress', 'HTTP', 'Routing'], documentationUrl: 'https://kubernetes.io/docs/concepts/services-networking/ingress/' }),
  officialComponent({ type: 'kubernetes.config.configmap', name: 'ConfigMap', provider: 'kubernetes', category: 'Configuration', aliases: ['ConfigMap', 'Configuration', 'Config'], documentationUrl: 'https://kubernetes.io/docs/concepts/configuration/configmap/' }),
  officialComponent({ type: 'kubernetes.config.secret', name: 'Secret', provider: 'kubernetes', category: 'Configuration', aliases: ['Secret', 'Credentials', 'Configuration'], documentationUrl: 'https://kubernetes.io/docs/concepts/configuration/secret/' }),
  officialComponent({ type: 'kubernetes.storage.persistent-volume', name: 'Persistent Volume', provider: 'kubernetes', category: 'Storage', aliases: ['Persistent Volume', 'PV', 'Storage'], documentationUrl: 'https://kubernetes.io/docs/concepts/storage/persistent-volumes/' }),
  officialComponent({ type: 'kubernetes.infrastructure.node', name: 'Node', provider: 'kubernetes', category: 'Infrastructure', aliases: ['Node', 'Worker', 'Machine'], documentationUrl: 'https://kubernetes.io/docs/concepts/architecture/nodes/' }),
];

export const builtInComponentSets: ComponentSet[] = deepFreezeComponentSets([
  { id: 'sketchdraw.generic', name: 'Generic Architecture (Starter)', version: '1.0.0', components: GENERIC_COMPONENTS },
  { id: 'sketchdraw.resource-cards', name: 'Resource Cards', version: '1.0.0', components: RESOURCE_CARD_COMPONENTS },
  { id: 'sketchdraw.aws', name: 'AWS Architecture (Official Starter)', version: '2026.10', components: AWS_COMPONENTS },
  { id: 'sketchdraw.azure', name: 'Azure Architecture (Official Starter)', version: '2026.10', components: AZURE_COMPONENTS },
  { id: 'sketchdraw.gcp', name: 'Google Cloud Architecture (Official Starter)', version: '2026.10', components: GCP_COMPONENTS },
  { id: 'sketchdraw.kubernetes', name: 'Kubernetes Icons (Official Starter)', version: '2026.10', components: KUBERNETES_COMPONENTS },
]);
