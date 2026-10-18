# Third-party architecture icons

Sketchdraw includes the official architecture icon libraries of AWS, Microsoft Azure, Google Cloud, and Kubernetes for offline use, plus a small starter set kept for existing documents and agent integrations. The source SVG geometry and colors are preserved. Editor metadata and unsupported XML attributes are removed so the files can pass the application’s strict, script-free SVG parser. The icon files remain subject to their publishers’ terms and trademarks; the project’s PolyForm Noncommercial license does not replace those terms.

Retrieved on 2026-10-18.

## Amazon Web Services

- Source: [AWS Architecture Icons](https://aws.amazon.com/architecture/icons/)
- Package: `Architecture-Service-Icons_07312026`, 32 px SVG variants
- Included services: Amazon EC2, AWS Lambda, Amazon S3, Amazon RDS, Amazon DynamoDB, Amazon API Gateway, Amazon SQS, and Amazon EKS
- Usage: AWS publishes the package for architecture diagrams, training material, and technical documentation. The AWS architecture icon terms and AWS trademark guidelines apply.

## Microsoft Azure

- Source: [Azure architecture icons](https://learn.microsoft.com/azure/architecture/icons/)
- Package: `Azure_Public_Service_Icons_V24`
- Included services: Virtual Machines, Function Apps, Storage Accounts, SQL Database, Azure Cosmos DB, Virtual Networks, Key Vaults, and Kubernetes Services
- Usage: Microsoft permits these icons in architecture diagrams, training materials, and documentation. Do not crop, flip, rotate, distort, or alter the icons; Microsoft’s terms of use and trademark guidelines apply.

## Google Cloud

- Source: [Google Cloud product icons](https://cloud.google.com/icons)
- Package: current official Google Cloud product icon SVG archive at retrieval time
- Included services: Compute Engine, Cloud Run, Cloud Storage, Cloud SQL, BigQuery, Google Kubernetes Engine, Vertex AI, and Apigee
- Usage: Google’s brand resource and trademark rules apply. The icons identify Google Cloud products and are stored without geometric or color changes.

## Kubernetes

- Source: [Kubernetes community icons](https://github.com/kubernetes/community/tree/master/icons)
- Included resources: Pod, Deployment, Service, Ingress, ConfigMap, Secret, Persistent Volume, and Node
- License: [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0) or [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/), as stated by the icon directory README
- Trademark: The Kubernetes name and logo are governed by the [CNCF trademark guidelines](https://www.linuxfoundation.org/legal/trademark-usage).

## Full libraries (since 2026-10-18, #92)

The library panel offers the complete packages, reduced and validated by `scripts/import-official-icons.mjs` (run with `npm run icons:import -- --aws <dir> --azure <dir> --gcp <dir> --gcp-core <dir> --kubernetes <dir>`):

| Provider | Package | Icons |
| --- | --- | --- |
| AWS | `Icon-package_07312026` (service icons 64 px, resource icons 48 px light, group icons 32 px) | 784 |
| Microsoft Azure | `Azure_Public_Service_Icons_V24` | 713 |
| Google Cloud | `google-cloud-legacy-icons` (product icons) and `core-products-icons` (512 px color) | 235 |
| Kubernetes | `kubernetes/community` `icons/svg/*/labeled` | 39 |

The import keeps geometry and colors. It only removes what the strict parser rejects and does not draw anyway (titles, metadata, editor namespaces, clip paths, `<defs>` children other than gradients), converts CSS classes, inline styles, named and `rgb()` colors and `px` units into equivalent attributes, prefixes gradient ids that start with a digit, and applies SVG defaults for missing gradient stop attributes. Icons that would still fail validation are skipped and reported. The generated data lives in `src/catalog/official/*.json`, one component set per provider category, loaded on demand by the renderer.

## Implementation

The curated SVG strings are stored in `src/catalog/official-icons.ts`. `src/catalog/icon.ts` parses them into an allowlisted element tree and rejects scripts, event handlers, remote resources, external paint references, unsafe namespaces, and malformed geometry before any icon reaches the renderer or export path.
