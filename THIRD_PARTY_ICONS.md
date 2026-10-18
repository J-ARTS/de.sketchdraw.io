# Third-party architecture icons

Sketchdraw includes a small offline starter set of official architecture icons. The source SVG geometry and colors are preserved. Editor metadata and unsupported XML attributes are removed so the files can pass the application’s strict, script-free SVG parser. The icon files remain subject to their publishers’ terms and trademarks; the project’s PolyForm Noncommercial license does not replace those terms.

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

## Implementation

The curated SVG strings are stored in `src/catalog/official-icons.ts`. `src/catalog/icon.ts` parses them into an allowlisted element tree and rejects scripts, event handlers, remote resources, external paint references, unsafe namespaces, and malformed geometry before any icon reaches the renderer or export path.
