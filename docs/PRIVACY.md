# Sketchdraw Privacy Policy

Last updated: 24 November 2026. Applies to Sketchdraw 0.1.10 and later. The German version is [DATENSCHUTZ.md](DATENSCHUTZ.md); if the two differ, the German text applies to users in Germany.

This policy describes which personal data Sketchdraw (the desktop app for Windows, macOS and Linux, and its session relay) handles. It is based on the source code of this repository.

## In short

- Sketchdraw has **no user accounts**, **no advertising**, **no analytics, no telemetry and no crash reporting**. The publisher does not receive your documents.
- Your documents and settings are stored **on your device**.
- The app opens network connections **only** for these purposes: the **update check**, **collaboration sessions** that you start or join, **plugins** (Jira, Azure Boards, Confluence, Git) that you set up yourself, and **web embeds** that a document contains.
- Collaboration data is **end-to-end encrypted**. The network operators and helper peers involved see technical connection data (such as IP addresses), not your drawing.

## Who is responsible

Jeremy Teichmann (J-ARTS) publishes Sketchdraw and is the controller for the data processing described here that the publisher itself carries out (the relay in section 3 and the repository on GitHub). Contact: through the [issues of the repository](https://github.com/J-ARTS/de.sketchdraw.io/issues) or the profile [J-ARTS](https://github.com/J-ARTS).

## 1. Data on your device

| What | Where | Content |
| --- | --- | --- |
| Documents | Files you save, and a recovery cache in the browser storage of the app (IndexedDB) | Your diagrams and their history |
| Settings | Browser storage of the app (`localStorage`) | Preferences, tool defaults, custom components, the display name you use in sessions, the chosen session route and relay address |
| Plugin settings | `plugins.json` in the app data folder | Server addresses and user names of your plugins. **Access tokens and passwords are encrypted with the operating system's secure storage** (Electron `safeStorage`); where it is unavailable, the app does not store them. |
| Update settings | `updates.json` in the app data folder | Whether automatic checks are on, and a dismissed version |

This data does not leave your device unless you share a document, join a session or use a plugin. You can delete it by deleting the files, clearing the app data and uninstalling the app.

## 2. Update check

By default the app asks GitHub for the newest release **15 seconds after the start and then every six hours** (`https://api.github.com/repos/J-ARTS/de.sketchdraw.io/releases/latest`). The request contains the app name and version (`Sketchdraw/<version>`) and, as for any internet request, your IP address. When you install an update, the app downloads the installer from `github.com` and checks size and SHA-256. The app has a setting to turn the automatic check off. GitHub processes the requests under its own [privacy statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement); the publisher only sees the aggregate download statistics GitHub offers repository owners.

## 3. Collaboration sessions

Connections are only opened when you **start or join a session**. A session link carries the keys and the address of the room; whoever has the link **and the PIN** can join, so share both carefully. Content, PIN and keys are encrypted end to end between the participants. What the other participants see: the **display name** you set, your **cursor and selection**, and the document.

How the devices reach each other depends on the route the host chooses:

- **Direct route (peer-to-peer):** The devices connect directly via the HyperDHT network. Participants learn **each other's IP addresses**. To find each other, the app contacts the public HyperDHT bootstrap nodes (`node1.hyperdht.org`, `node2.hyperdht.org`, `node3.hyperdht.org`) and other nodes of the DHT, which see IP addresses and the fact that a lookup took place for a topic (a hash, not the document).
- **Volunteer helper peers:** While a session runs, your device may **forward encrypted records for other participants** when no direct path exists, and may use helpers of other participants in the same way. A helper sees IP addresses, times and amounts of data, never the content, the PIN or a key.
- **Cloudflare relay route:** All devices connect to one relay (a Cloudflare Worker) and the relay forwards the encrypted records. The app ships with the address of the relay the publisher runs (`sketchdraw-relay.jeremy-teichman74.workers.dev`); you can enter another relay or run your own (`relay/` in the repository). The relay sees **IP addresses, connection times, the session topic (a hash of the host's public key) and amounts of data**. It stores nothing: the room lives in memory and disappears when the last connection ends. The relay writes no logs; the Cloudflare observability features are switched off. Cloudflare, as the platform operator, processes the connections technically under its own [privacy policy](https://www.cloudflare.com/privacypolicy/).

You choose the route per session. The legal basis for processing IP addresses to create the connection is the performance of the function you requested (Art. 6(1)(b) GDPR) and, for operating the relay, the publisher's legitimate interest in a working service (Art. 6(1)(f) GDPR).

## 4. Plugins

Plugins for **Jira, Azure Boards (Azure DevOps), Confluence and Git remotes** connect to the servers whose addresses and credentials **you** enter. The app sends requests only to those servers, with the credentials you stored, and shows or writes back the content you ask for (for example tickets or wiki pages). The operators of those services process the data under their own privacy terms. Nothing goes through a server of the publisher. Credentials are encrypted as described in section 1.

## 5. Embedded web pages

A document can contain a **web embed**, a live preview of a web page (an `iframe`). The page is loaded **as soon as the document with the embed is shown**, also when the document came from someone else, and the app sends no referrer. The operator of that page sees your **IP address** and the usual technical data of your browser engine, and may set cookies in the embed. The app does not load web pages by itself otherwise. If you do not want a page to be contacted, remove the embed before you open the document or do not open documents from sources you do not trust. The embedded page is subject to its operator's privacy policy.

## 6. Agent access (MCP)

Sketchdraw offers a **local** connection for AI agents (for example Claude Code, OpenAI Codex or Google Antigravity) that you run on the same computer. An agent that you connect can read and change the document that is open. Sketchdraw sends nothing to the agent's provider; what the agent does with the data is governed by that provider's terms and your settings there. Documents from browser or session guests do not get this access.

## 7. What the publisher does not do

No advertising, tracking, profiling or sale of data. No cookies. Fonts, icons and the diagram renderer ship with the app and are not loaded from the internet; images are not loaded from other sites. Web pages are only contacted for embeds (section 5), plugins (section 4) and the update check (section 2). Hosting the repository and its downloads is done by GitHub.

## 8. Your rights

If personal data of yours is processed by the publisher (in practice: IP addresses at the relay), you have the right to **access, rectification, erasure, restriction, data portability** and **objection**, and the right to complain to a data protection supervisory authority, for example the one of your place of residence. Because the relay stores no data and keeps no logs, the publisher usually cannot link a connection to a person afterwards. Write to the contact in section "Who is responsible" for requests.

## 9. Children

Sketchdraw is a professional tool and is not aimed at children.

## 10. Changes

When the app changes what it sends over the network, this policy is updated in the same release. The history is in the Git repository.
