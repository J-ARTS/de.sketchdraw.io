import type { ComponentDefinition, ComponentSet } from '../domain/types';

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

const ICON_COMPUTE =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="5" width="14" height="14" rx="2" ry="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="2" x2="9" y2="5"/><line x1="15" y1="2" x2="15" y2="5"/><line x1="9" y1="19" x2="9" y2="22"/><line x1="15" y1="19" x2="15" y2="22"/><line x1="2" y1="9" x2="5" y2="9"/><line x1="2" y1="15" x2="5" y2="15"/><line x1="19" y1="9" x2="22" y2="9"/><line x1="19" y1="15" x2="22" y2="15"/></svg>';

const ICON_STORAGE =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 21 7 21 17 12 22 3 17 3 7"/><polyline points="3 7 12 12 21 7"/><line x1="12" y1="12" x2="12" y2="22"/></svg>';

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

const AWS_COMPONENTS: ComponentDefinition[] = [
  {
    type: 'aws.compute.instance',
    name: 'Compute Instance',
    provider: 'aws',
    category: 'Compute',
    aliases: ['Compute', 'EC2', 'Instance', 'VM'],
    defaultWidth: 160,
    defaultHeight: 80,
    style: {
      stroke: '#b45309',
      fill: '#fffbeb',
    },
    metadata: {
      provenance: 'sketchdraw-generic-symbol',
    },
    iconSvg: ICON_COMPUTE,
    widgets: [
      {
        key: 'region',
        label: 'Region',
        kind: 'text',
      },
      {
        key: 'vcpu',
        label: 'vCPU',
        kind: 'number',
      },
    ],
  },
  {
    type: 'aws.storage.object',
    name: 'Object Storage',
    provider: 'aws',
    category: 'Storage',
    aliases: ['S3', 'Bucket', 'Object-Storage', 'Storage'],
    defaultWidth: 160,
    defaultHeight: 80,
    style: {
      stroke: '#b45309',
      fill: '#fffbeb',
    },
    metadata: {
      provenance: 'sketchdraw-generic-symbol',
    },
    iconSvg: ICON_STORAGE,
    widgets: [
      {
        key: 'storageClass',
        label: 'Speicherklasse',
        kind: 'select',
        options: ['standard', 'infrequent-access', 'archive'],
      },
    ],
  },
  {
    type: 'aws.database.relational',
    name: 'Relational Database',
    provider: 'aws',
    category: 'Database',
    aliases: ['RDS', 'Database', 'SQL', 'Datenbank'],
    defaultWidth: 160,
    defaultHeight: 80,
    style: {
      stroke: '#b45309',
      fill: '#fffbeb',
    },
    metadata: {
      provenance: 'sketchdraw-generic-symbol',
    },
    iconSvg: ICON_DATABASE,
    widgets: [
      {
        key: 'engine',
        label: 'Engine',
        kind: 'select',
        options: ['postgres', 'mysql', 'mariadb'],
      },
      {
        key: 'storageGb',
        label: 'Speicher (GB)',
        kind: 'number',
      },
    ],
  },
];

const AZURE_COMPONENTS: ComponentDefinition[] = [
  {
    type: 'azure.compute.vm',
    name: 'Virtual Machine',
    provider: 'azure',
    category: 'Compute',
    aliases: ['Virtual-Machine', 'VM', 'Compute', 'Server'],
    defaultWidth: 160,
    defaultHeight: 80,
    style: {
      stroke: '#0369a1',
      fill: '#f0f9ff',
    },
    metadata: {
      provenance: 'sketchdraw-generic-symbol',
    },
    iconSvg: ICON_COMPUTE,
    widgets: [
      {
        key: 'region',
        label: 'Region',
        kind: 'text',
      },
      {
        key: 'cores',
        label: 'Kerne',
        kind: 'number',
      },
    ],
  },
  {
    type: 'azure.storage.blob',
    name: 'Blob Storage',
    provider: 'azure',
    category: 'Storage',
    aliases: ['Blob', 'Storage', 'Container', 'Object-Storage'],
    defaultWidth: 160,
    defaultHeight: 80,
    style: {
      stroke: '#0369a1',
      fill: '#f0f9ff',
    },
    metadata: {
      provenance: 'sketchdraw-generic-symbol',
    },
    iconSvg: ICON_STORAGE,
    widgets: [
      {
        key: 'tier',
        label: 'Zugriffsebene',
        kind: 'select',
        options: ['hot', 'cool', 'archive'],
      },
    ],
  },
  {
    type: 'azure.database.sql',
    name: 'SQL Database',
    provider: 'azure',
    category: 'Database',
    aliases: ['SQL', 'Database', 'Datenbank', 'Relational'],
    defaultWidth: 160,
    defaultHeight: 80,
    style: {
      stroke: '#0369a1',
      fill: '#f0f9ff',
    },
    metadata: {
      provenance: 'sketchdraw-generic-symbol',
    },
    iconSvg: ICON_DATABASE,
    widgets: [
      {
        key: 'dtu',
        label: 'DTU / Kapazität',
        kind: 'number',
      },
    ],
  },
];

const GCP_COMPONENTS: ComponentDefinition[] = [
  {
    type: 'gcp.compute.instance',
    name: 'Compute Engine',
    provider: 'gcp',
    category: 'Compute',
    aliases: ['Compute-Engine', 'GCE', 'Compute', 'VM'],
    defaultWidth: 160,
    defaultHeight: 80,
    style: {
      stroke: '#15803d',
      fill: '#f0fdf4',
    },
    metadata: {
      provenance: 'sketchdraw-generic-symbol',
    },
    iconSvg: ICON_COMPUTE,
    widgets: [
      {
        key: 'zone',
        label: 'Zone',
        kind: 'text',
      },
      {
        key: 'vcpu',
        label: 'vCPU',
        kind: 'number',
      },
    ],
  },
  {
    type: 'gcp.storage.object',
    name: 'Cloud Storage',
    provider: 'gcp',
    category: 'Storage',
    aliases: ['Cloud-Storage', 'GCS', 'Bucket', 'Storage'],
    defaultWidth: 160,
    defaultHeight: 80,
    style: {
      stroke: '#15803d',
      fill: '#f0fdf4',
    },
    metadata: {
      provenance: 'sketchdraw-generic-symbol',
    },
    iconSvg: ICON_STORAGE,
    widgets: [
      {
        key: 'storageClass',
        label: 'Speicherklasse',
        kind: 'select',
        options: ['standard', 'nearline', 'coldline', 'archive'],
      },
    ],
  },
  {
    type: 'gcp.database.sql',
    name: 'Cloud SQL',
    provider: 'gcp',
    category: 'Database',
    aliases: ['Cloud-SQL', 'SQL', 'Database', 'Datenbank'],
    defaultWidth: 160,
    defaultHeight: 80,
    style: {
      stroke: '#15803d',
      fill: '#f0fdf4',
    },
    metadata: {
      provenance: 'sketchdraw-generic-symbol',
    },
    iconSvg: ICON_DATABASE,
    widgets: [
      {
        key: 'engine',
        label: 'Engine',
        kind: 'select',
        options: ['postgres', 'mysql', 'sqlserver'],
      },
    ],
  },
];

export const builtInComponentSets: ComponentSet[] = deepFreezeComponentSets([
  {
    id: 'sketchdraw.generic',
    name: 'Generic Architecture (Starter)',
    version: '1.0.0',
    components: GENERIC_COMPONENTS,
  },
  {
    id: 'sketchdraw.aws',
    name: 'AWS Architecture (Starter)',
    version: '1.0.0',
    components: AWS_COMPONENTS,
  },
  {
    id: 'sketchdraw.azure',
    name: 'Azure Architecture (Starter)',
    version: '1.0.0',
    components: AZURE_COMPONENTS,
  },
  {
    id: 'sketchdraw.gcp',
    name: 'GCP Architecture (Starter)',
    version: '1.0.0',
    components: GCP_COMPONENTS,
  },
]);
