#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * A start from the sources runs inside the Electron bundle of node_modules. macOS takes the bold menu title, the Dock
 * name and the icon of the About dialog from that bundle, not from the running app, so they read "Electron" (#236).
 * This gives the development bundle the name and the icon of Sketchdraw and signs it again, because macOS on Apple
 * silicon only starts a bundle whose signature matches its content. The installed app is not affected: its bundle is
 * built with the right name and icon.
 *
 * Returns what happened: 'skipped' (not macOS, or nothing to brand), 'current' (already done), 'branded', or 'failed'
 * (the bundle is back in its original state and the start goes on with the Electron name).
 */
export function brandDevElectron({
  electronBinary,
  iconPath,
  name = 'Sketchdraw',
  platform = process.platform,
  run = (command, args) => execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }),
  warn = (message) => console.warn(message),
}) {
  if (platform !== 'darwin' || typeof electronBinary !== 'string') return 'skipped';
  const bundle = path.resolve(electronBinary, '../../..');
  const plist = path.join(bundle, 'Contents', 'Info.plist');
  if (!bundle.endsWith('.app') || !existsSync(plist) || !existsSync(iconPath)) return 'skipped';

  // The marker lives beside the bundle: a reinstall of Electron removes both, and the next start brands again.
  const marker = path.join(path.dirname(bundle), '.sketchdraw-dev-brand');
  const stamp = `${name}\n${createHash('sha256').update(readFileSync(iconPath)).digest('hex')}\n`;
  if (existsSync(marker) && readFileSync(marker, 'utf8') === stamp) return 'current';

  let iconTarget;
  let originalPlist;
  let originalIcon;
  try {
    const iconFile = run('/usr/bin/plutil', ['-extract', 'CFBundleIconFile', 'raw', '-o', '-', plist]).trim();
    if (!iconFile || iconFile.includes('/')) throw new Error('The Electron bundle names no icon file.');
    iconTarget = path.join(bundle, 'Contents', 'Resources', iconFile.endsWith('.icns') ? iconFile : `${iconFile}.icns`);
    originalPlist = readFileSync(plist);
    originalIcon = existsSync(iconTarget) ? readFileSync(iconTarget) : null;

    run('/usr/bin/plutil', ['-replace', 'CFBundleName', '-string', name, plist]);
    run('/usr/bin/plutil', ['-replace', 'CFBundleDisplayName', '-string', name, plist]);
    copyFileSync(iconPath, iconTarget);
    run('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', bundle]);
    // The Dock and Finder cache icons by the modification time of the bundle.
    const now = new Date();
    utimesSync(bundle, now, now);
    writeFileSync(marker, stamp);
    return 'branded';
  } catch (error) {
    // Put the bundle back: its original signature matches the original files again.
    try {
      if (originalPlist) writeFileSync(plist, originalPlist);
      if (iconTarget && originalIcon) writeFileSync(iconTarget, originalIcon);
    } catch { /* nothing more to restore */ }
    warn(`[dev:electron] The Electron bundle keeps its own name and icon: ${error instanceof Error ? error.message : String(error)}`);
    return 'failed';
  }
}
