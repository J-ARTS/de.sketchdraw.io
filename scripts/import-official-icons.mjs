#!/usr/bin/env node
/**
 * Imports the official architecture icon packages into category component sets (#92).
 *
 *   node scripts/import-official-icons.mjs --aws <dir> --azure <dir> --gcp <dir> [--gcp-core <dir>] --kubernetes <dir> [--retrieved YYYY-MM-DD]
 *
 * Each directory is an extracted vendor package (see THIRD_PARTY_ICONS.md). Every SVG is reduced to the
 * script-free subset the app accepts and then checked with the app's own validateSafeIconSvg; icons that
 * still fail are reported and skipped. Output: src/catalog/official/<provider>.json and manifest.json.
 */
import { build } from 'esbuild';
import { mkdtemp, readdir, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SaxesParser } from 'saxes';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'src/catalog/official');
const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, all) => (value.startsWith('--') ? [...pairs, [value.slice(2), all[index + 1]]] : pairs), []));
const RETRIEVED = args.retrieved ?? new Date().toISOString().slice(0, 10);

// --- App validator (bundled from the real source) --------------------------------------------------------------
async function loadValidator() {
  const dir = await mkdtemp(join(tmpdir(), 'sketchdraw-icon-validator-'));
  const file = join(dir, 'icon.mjs');
  await build({ entryPoints: [join(ROOT, 'src/catalog/icon.ts')], bundle: true, platform: 'node', format: 'esm', outfile: file, logLevel: 'error' });
  const module = await import(pathToFileURL(file).href);
  return { validate: module.validateSafeIconSvg, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

// --- SVG reduction ----------------------------------------------------------------------------------------------
const KEEP = new Set(['svg', 'defs', 'linearGradient', 'radialGradient', 'stop', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon']);
const DROP_WITH_CONTENT = new Set(['title', 'desc', 'metadata', 'style', 'clipPath', 'mask', 'pattern', 'filter', 'symbol', 'use', 'text', 'image', 'script', 'foreignObject', 'marker']);
const PRESENTATION = ['fill', 'stroke', 'stroke-width', 'opacity', 'fill-opacity', 'stroke-opacity', 'fill-rule', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit'];
const GEOMETRY = {
  svg: ['viewBox'], defs: [], linearGradient: ['id', 'x1', 'y1', 'x2', 'y2', 'gradientUnits', 'gradientTransform'],
  radialGradient: ['id', 'cx', 'cy', 'r', 'fx', 'fy', 'gradientUnits', 'gradientTransform'], stop: ['offset', 'stop-color', 'stop-opacity'],
  g: ['transform'], path: ['d', 'transform'], rect: ['x', 'y', 'width', 'height', 'rx', 'ry', 'transform'], circle: ['cx', 'cy', 'r', 'transform'],
  ellipse: ['cx', 'cy', 'rx', 'ry', 'transform'], line: ['x1', 'y1', 'x2', 'y2', 'transform'], polyline: ['points', 'transform'], polygon: ['points', 'transform'],
};

function parseTree(text) {
  const parser = new SaxesParser({ xmlns: false });
  const root = { name: '#root', attributes: {}, children: [] };
  const stack = [root];
  parser.on('opentag', (tag) => {
    const node = { name: tag.name, attributes: { ...tag.attributes }, children: [] };
    stack.at(-1).children.push(node);
    stack.push(node);
  });
  parser.on('closetag', () => { stack.pop(); });
  parser.on('text', (value) => { if (stack.at(-1).name === 'style') stack.at(-1).children.push({ name: '#text', value }); });
  parser.on('cdata', (value) => { if (stack.at(-1).name === 'style') stack.at(-1).children.push({ name: '#text', value }); });
  parser.write(text.replace(/^﻿/, '').replace(/<!DOCTYPE[^>]*>/i, '')).close();
  return root.children.find((node) => node.name === 'svg' || node.name.endsWith(':svg'));
}

function localName(name) { return name.includes(':') ? name.split(':')[1] : name; }

function parseDeclarations(text) {
  const result = {};
  for (const part of text.split(';')) {
    const [key, ...rest] = part.split(':');
    if (key && rest.length) result[key.trim()] = rest.join(':').trim().replace(/\s*!important$/, '');
  }
  return result;
}

function collectCss(node, rules) {
  if (localName(node.name) === 'style') {
    const css = node.children.map((child) => child.value ?? '').join('').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const match of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const declarations = parseDeclarations(match[2]);
      for (const selector of match[1].split(',')) {
        const cls = selector.trim().match(/^\.([\w-]+)$/);
        if (cls) rules.set(cls[1], { ...(rules.get(cls[1]) ?? {}), ...declarations });
      }
    }
  }
  for (const child of node.children ?? []) if (child.name !== '#text') collectCss(child, rules);
}

function collectGradients(node, map) {
  const name = localName(node.name);
  if ((name === 'linearGradient' || name === 'radialGradient') && node.attributes.id) map.set(node.attributes.id, node);
  for (const child of node.children ?? []) if (child.name !== '#text') collectGradients(child, map);
}

// Named and rgb() colors become hex so the app's strict color check accepts them; the rendered color is unchanged.
const NAMED_COLORS = { white: '#ffffff', black: '#000000', gray: '#808080', grey: '#808080', silver: '#c0c0c0', red: '#ff0000', green: '#008000', blue: '#0000ff', yellow: '#ffff00', aqua: '#00ffff', cyan: '#00ffff', fuchsia: '#ff00ff', magenta: '#ff00ff', lime: '#00ff00', maroon: '#800000', navy: '#000080', olive: '#808000', purple: '#800080', teal: '#008080', orange: '#ffa500', darkgray: '#a9a9a9', darkgrey: '#a9a9a9', lightgray: '#d3d3d3', lightgrey: '#d3d3d3', gainsboro: '#dcdcdc', whitesmoke: '#f5f5f5', dimgray: '#696969', transparent: 'none' };
function normalizeColor(value) {
  const text = value.trim();
  const named = NAMED_COLORS[text.toLowerCase()];
  if (named) return named;
  const rgb = text.match(/^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)/i);
  if (rgb) return `#${rgb.slice(1, 4).map((channel) => Math.max(0, Math.min(255, Math.round(Number(channel)))).toString(16).padStart(2, '0')).join('')}`;
  return text;
}
const COLOR_KEYS = new Set(['fill', 'stroke', 'stop-color']);
const GRADIENT_TAGS = new Set(['linearGradient', 'radialGradient']);
/** Ids must start with a letter; vendor UUIDs sometimes start with a digit. */
function safeId(id) { return /^[A-Za-z_]/.test(id) ? id : `g${id}`; }
function remapUrl(value) { return value.replace(/url\(#([^)]+)\)/g, (_, id) => `url(#${safeId(id.trim())})`); }

function escapeAttr(value) { return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }

function serialize(node, ctx) {
  const name = localName(node.name);
  if (node.name.includes(':') && !node.name.startsWith('svg:')) return '';
  if (DROP_WITH_CONTENT.has(name)) return '';
  const effective = { ...node.attributes };
  for (const cls of (node.attributes.class ?? '').split(/\s+/).filter(Boolean)) Object.assign(effective, ctx.css.get(cls) ?? {});
  if (node.attributes.style) Object.assign(effective, parseDeclarations(node.attributes.style));
  if (effective.display === 'none' || effective.visibility === 'hidden') return '';

  // Gradients may inherit stops through href (Inkscape); inline them so no reference remains.
  let children = node.children ?? [];
  if ((name === 'linearGradient' || name === 'radialGradient') && !children.some((child) => localName(child.name) === 'stop')) {
    const href = (node.attributes['xlink:href'] ?? node.attributes.href ?? '').replace(/^#/, '');
    const source = ctx.gradients.get(href);
    if (source) children = source.children;
  }
  // Only gradients inside <defs> matter; anything else there is never painted.
  const visible = name === 'defs' ? children.filter((child) => GRADIENT_TAGS.has(localName(child.name))) : children;
  const inner = visible.filter((child) => child.name !== '#text').map((child) => serialize(child, ctx)).join('');
  if (!KEEP.has(name)) return inner; // unknown containers (a, switch, …) are unwrapped
  if ((name === 'g' || name === 'defs') && !inner) return '';

  if (GRADIENT_TAGS.has(name)) {
    // Keep the first definition of an id; later duplicates would make references ambiguous.
    effective.id = safeId(node.attributes.id ?? '');
    if (ctx.emittedIds.has(effective.id)) return '';
    ctx.emittedIds.add(effective.id);
  }
  if (name === 'stop') {
    effective.offset ??= '0'; // SVG defaults
    effective['stop-color'] ??= '#000000';
  }
  const allowed = [...GEOMETRY[name], ...(name === 'stop' || name === 'defs' ? [] : PRESENTATION)];
  const attrs = [];
  if (name === 'svg') {
    let viewBox = node.attributes.viewBox;
    if (!viewBox) {
      const width = parseFloat(node.attributes.width ?? '');
      const height = parseFloat(node.attributes.height ?? '');
      if (width > 0 && height > 0) viewBox = `0 0 ${width} ${height}`;
    }
    attrs.push(`viewBox="${escapeAttr(viewBox ?? '0 0 24 24')}"`, 'xmlns="http://www.w3.org/2000/svg"');
  } else {
    for (const key of allowed) {
      let value = effective[key];
      if (value === undefined || value === '') continue;
      if (COLOR_KEYS.has(key)) value = remapUrl(normalizeColor(String(value)));
      if (/^-?[\d.]+px$/.test(String(value).trim())) value = String(value).trim().slice(0, -2);
      if (/url\(/.test(value) && !/^url\(#[\w.-]+\)$/.test(value.trim())) continue; // only local paint references
      attrs.push(`${key}="${escapeAttr(value.trim())}"`);
    }
  }
  return `<${name}${attrs.length ? ` ${attrs.join(' ')}` : ''}>${inner}</${name}>`;
}

export function reduceSvg(text) {
  const root = parseTree(text);
  if (!root) throw new Error('No <svg> root element.');
  const css = new Map();
  const gradients = new Map();
  collectCss(root, css);
  collectGradients(root, gradients);
  return serialize({ ...root, name: 'svg' }, { css, gradients, emittedIds: new Set() });
}

// --- Naming --------------------------------------------------------------------------------------------------------
const ACRONYMS = new Set(['ai', 'api', 'apis', 'aws', 'cdn', 'cli', 'db', 'dns', 'ebs', 'ec2', 'ecr', 'ecs', 'efs', 'eks', 'emr', 'gke', 'gpu', 'hpc', 'iam', 'id', 'iot', 'ip', 'k8s', 'kms', 'ml', 'nat', 'nfs', 'sap', 'sdk', 'sql', 'sqs', 'sns', 'ssl', 'sso', 'tpu', 'vm', 'vms', 'vpc', 'vpn', 'waf', 'ui', 'ux', 'hsm', 'ssh', 'tls', 'xr', 'vr', 'ar', 'b2b', 'b2c', 'crm', 'erp']);
function words(text) { return text.replace(/[_]+/g, ' ').replace(/-/g, ' ').replace(/\s+/g, ' ').trim(); }
function titleCase(text) { return words(text).split(' ').map((word) => (ACRONYMS.has(word.toLowerCase()) ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1))).join(' '); }
export function slug(text) { return text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ').replace(/\+/g, ' ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
function aliasesFor(name) {
  const short = name.replace(/^(Amazon|AWS|Azure|Microsoft|Google|Cloud)\s+/i, '');
  return short !== name ? [short] : [];
}

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const path = join(dir, entry.name);
    if (entry.name === '__MACOSX' || entry.name.startsWith('._')) return [];
    return entry.isDirectory() ? walk(path) : entry.name.toLowerCase().endsWith('.svg') ? [path] : [];
  }));
  return files.flat().sort();
}

// --- Provider readers ---------------------------------------------------------------------------------------------
const AWS_CATEGORY_NAMES = { 'Networking-Content-Delivery': 'Networking & Content Delivery', 'Security-Identity': 'Security, Identity & Compliance', 'Front-End-Web-Mobile': 'Front-End Web & Mobile', 'Migration-Modernization': 'Migration & Modernization', 'Internet-of-Things': 'Internet of Things', 'Application-Integration': 'Application Integration' };
function awsCategory(folder) { const raw = folder.replace(/^(Arch|Res)_/, ''); return AWS_CATEGORY_NAMES[raw] ?? words(raw); }

async function readAws(dir) {
  const files = await walk(dir);
  const items = [];
  for (const file of files) {
    const rel = relative(dir, file);
    const service = rel.match(/Architecture-Service-Icons[^/]*\/(Arch_[^/]+)\/64\/Arch_(.+)_64\.svg$/);
    const resource = rel.match(/Resource-Icons[^/]*\/(Res_[^/]+)\/(?:Res_48_Light\/)?Res_(.+?)_48(?:_Light)?\.svg$/);
    const group = rel.match(/Architecture-Group-Icons[^/]*\/(.+)_32\.svg$/);
    if (service) items.push({ file, category: awsCategory(service[1]), name: words(service[2]), kind: 'service' });
    else if (resource && !/dark/i.test(rel)) {
      // "Amazon-Pinpoint_Journey" → "Journey · Amazon Pinpoint": the resource first, its service second.
      const [serviceName, ...resourceParts] = resource[2].split('_');
      const name = resourceParts.length ? `${words(resourceParts.join(' '))} · ${words(serviceName)}` : words(serviceName);
      items.push({ file, category: `${awsCategory(resource[1])} · Ressourcen`, name, kind: 'resource' });
    }
    else if (group && !/dark/i.test(group[1])) items.push({ file, category: 'Gruppen', name: words(basename(group[1])), kind: 'group' });
  }
  return items;
}

async function readAzure(dir) {
  const files = await walk(dir);
  return files.flatMap((file) => {
    const match = file.match(/Icons\/([^/]+)\/\d+-icon-service-(.+)\.svg$/i);
    return match ? [{ file, category: titleCase(match[1]).replace(/ \+ /g, ' + '), name: words(match[2]), kind: 'service' }] : [];
  });
}

const GCP_GROUPS = [
  ['AI & Machine Learning', /(ai|ml|vision|speech|translat|natural_language|dialogflow|automl|vertex|tpu|recommend|document_ai|contact_center|talent|video_intelligence|gemini|agent)/],
  ['Data Analytics', /(bigquery|dataflow|dataproc|pubsub|pub_sub|data_?fusion|composer|datalab|dataprep|looker|analytics|data_catalog|dataplex|datastream|data_studio|genomics|life_sciences)/],
  ['Databases', /(sql|spanner|bigtable|firestore|datastore|memorystore|alloydb|database)/],
  ['Storage', /(storage|filestore|persistent_disk|backup|transfer)/],
  ['Networking', /(network|vpc|load_balanc|dns|cdn|nat|interconnect|vpn|router|armor|traffic|ip|peering|service_directory|private_service)/],
  ['Security & Identity', /(iam|identity|kms|key|secret|security|beyondcorp|certificate|access|policy|recaptcha|web_risk|chronicle|assured|binary_authorization|data_loss|confidential)/],
  ['Compute', /(compute|gpu|bare_metal|vmware|sole_tenancy|shielded|preemptible|instance|os_)/],
  ['Containers & Serverless', /(kubernetes|gke|run|functions|app_engine|anthos|container|artifact|cloud_build|workflows|eventarc|scheduler|tasks|api_gateway|apigee|endpoints)/],
  ['Operations & Management', /(monitoring|logging|trace|debugger|profiler|error|deployment_manager|console|billing|resource|asset|config|operations|cloud_shell|deploy|source|tools|sdk|apis|marketplace|support|optimization|carbon|migrat)/],
  ['IoT & Media', /(iot|media|transcoder|live_stream|game|maps|fleet)/],
];
function gcpCategory(id) { return GCP_GROUPS.find(([, pattern]) => pattern.test(id))?.[0] ?? 'Weitere Produkte'; }

async function readGcp(dir, coreDir) {
  const files = await walk(dir);
  const items = files.flatMap((file) => {
    const id = basename(file, '.svg').toLowerCase();
    return [{ file, category: gcpCategory(id), name: titleCase(id), kind: 'product' }];
  });
  if (coreDir) {
    for (const file of await walk(coreDir)) {
      const match = file.match(/Unique Icons\/([^/]+)\/SVG\/[^/]+-512-color(-rgb)?\.svg$/i);
      if (match) items.push({ file, category: 'Kernprodukte', name: match[1], kind: 'product' });
    }
  }
  return items;
}

const K8S_NAMES = { 'c-role': 'ClusterRole', cm: 'ConfigMap', crb: 'ClusterRoleBinding', crd: 'Custom Resource Definition', cronjob: 'CronJob', deploy: 'Deployment', ds: 'DaemonSet', ep: 'Endpoints', group: 'Group', hpa: 'Horizontal Pod Autoscaler', ing: 'Ingress', job: 'Job', limits: 'LimitRange', netpol: 'NetworkPolicy', ns: 'Namespace', pod: 'Pod', psp: 'PodSecurityPolicy', pv: 'PersistentVolume', pvc: 'PersistentVolumeClaim', quota: 'ResourceQuota', rb: 'RoleBinding', role: 'Role', rs: 'ReplicaSet', sa: 'ServiceAccount', sc: 'StorageClass', secret: 'Secret', sts: 'StatefulSet', svc: 'Service', user: 'User', vol: 'Volume', api: 'API Server', 'c-c-m': 'Cloud Controller Manager', 'c-m': 'Controller Manager', 'k-proxy': 'kube-proxy', kubelet: 'kubelet', sched: 'Scheduler', 'control-plane': 'Control Plane', etcd: 'etcd', node: 'Node' };
const K8S_CATEGORIES = { resources: 'Ressourcen', control_plane_components: 'Control Plane', infrastructure_components: 'Infrastruktur' };
async function readKubernetes(dir) {
  const files = await walk(dir);
  return files.map((file) => {
    const key = basename(file, '.svg');
    const folder = basename(dirname(file));
    return { file, category: K8S_CATEGORIES[folder] ?? 'Ressourcen', name: K8S_NAMES[key] ?? titleCase(key), kind: 'resource', alias: key };
  });
}

// --- Assembly -------------------------------------------------------------------------------------------------------
const PACKAGES = {
  aws: { label: 'AWS', package: 'Icon-package_07312026', version: '2026.07.31' },
  azure: { label: 'Azure', package: 'Azure_Public_Service_Icons_V24', version: 'v24' },
  gcp: { label: 'Google Cloud', package: 'google-cloud-legacy-icons + core-products-icons', version: RETRIEVED },
  kubernetes: { label: 'Kubernetes', package: 'kubernetes/community icons/svg (labeled)', version: RETRIEVED },
};

async function assemble(provider, items, validate, report) {
  const sets = new Map();
  const seen = new Set();
  for (const item of items) {
    let iconSvg;
    try {
      iconSvg = reduceSvg(await readFile(item.file, 'utf8'));
      validate(iconSvg);
    } catch (error) {
      report.skipped.push({ provider, file: relative(ROOT, item.file).replace(/^.*?scratchpad\//, ''), reason: String(error?.issues?.[0]?.message ?? error?.message ?? error).slice(0, 160) });
      continue;
    }
    const categorySlug = slug(item.category);
    let type = `${provider}.${categorySlug}.${slug(item.name)}`;
    for (let n = 2; seen.has(type); n += 1) type = `${provider}.${categorySlug}.${slug(item.name)}-${n}`;
    seen.add(type);
    const setId = `sketchdraw.${provider}.${categorySlug}`;
    if (!sets.has(setId)) sets.set(setId, { id: setId, name: `${PACKAGES[provider].label} · ${item.category}`, version: PACKAGES[provider].version, category: item.category, components: [] });
    const aliases = [...aliasesFor(item.name), ...(item.alias ? [item.alias] : [])];
    sets.get(setId).components.push({ type, name: item.name, ...(aliases.length ? { aliases } : {}), iconSvg });
  }
  const sorted = [...sets.values()].sort((a, b) => a.category.localeCompare(b.category, 'de'));
  for (const set of sorted) set.components.sort((a, b) => a.name.localeCompare(b.name, 'de'));
  return sorted;
}

async function main() {
  const readers = { aws: () => readAws(args.aws), azure: () => readAzure(args.azure), gcp: () => readGcp(args.gcp, args['gcp-core']), kubernetes: () => readKubernetes(args.kubernetes) };
  const missing = Object.keys(readers).filter((provider) => !args[provider]);
  if (missing.length) throw new Error(`Missing package directories: ${missing.map((p) => `--${p}`).join(', ')}`);
  const { validate, cleanup } = await loadValidator();
  const report = { skipped: [] };
  const manifest = { retrieved: RETRIEVED, providers: {} };
  await mkdir(OUT, { recursive: true });
  try {
    for (const [provider, read] of Object.entries(readers)) {
      const sets = await assemble(provider, await read(), validate, report);
      const count = sets.reduce((sum, set) => sum + set.components.length, 0);
      const json = JSON.stringify({ provider, package: PACKAGES[provider].package, retrieved: RETRIEVED, sets });
      await writeFile(join(OUT, `${provider}.json`), `${json}\n`);
      manifest.providers[provider] = { label: PACKAGES[provider].label, package: PACKAGES[provider].package, count, categories: sets.map((set) => ({ id: set.id, name: set.category, count: set.components.length })), bytes: json.length };
      console.log(`${provider}: ${count} icons in ${sets.length} sets, ${(json.length / 1024 / 1024).toFixed(2)} MB, largest set ${(Math.max(...sets.map((set) => JSON.stringify(set).length)) / 1024).toFixed(0)} KB`);
    }
  } finally {
    await cleanup();
  }
  await writeFile(join(OUT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`skipped: ${report.skipped.length}`);
  for (const entry of report.skipped.slice(0, 40)) console.log(`  - ${entry.provider} ${entry.file}: ${entry.reason}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error); process.exit(1); });
}
