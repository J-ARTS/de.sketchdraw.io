import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
export const PROJECT_ROOT = resolve(__dirname, '..');

export const PRODUCT_NAME = 'Sketchdraw';
export const DEFAULT_REPOSITORY = 'J-ARTS/de.sketchdraw.io';

/**
 * Minimum realistic installer size in bytes for production packaging (1 MB).
 * Unit tests can override this parameter when testing synthetic binary fixtures.
 */
export const DEFAULT_MIN_INSTALLER_SIZE_BYTES = 1024 * 1024;

/**
 * Strict semantic version tag pattern: v<major>.<minor>.<patch> with optional prerelease.
 * Build metadata (+) is disallowed in release tags to keep installer filenames deterministic.
 */
export const RELEASE_TAG_REGEX =
  /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?$/;

export const GIT_SHA_REGEX = /^[0-9a-f]{40}$/i;

/**
 * Patterns that must never be uploaded as GitHub Release assets.
 */
export const FORBIDDEN_RELEASE_ASSET_PATTERNS = [
  /\.blockmap$/i,
  /^latest(?:-[a-z0-9]+)?\.ya?ml$/i,
  /^builder-debug\.ya?ml$/i,
  /^builder-effective-config\.ya?ml$/i,
  /\.sha256(?:sum)?$/i,
  /^checksums/i,
  /\.AppImage$/i,
  /\.msi$/i,
  /\.zip$/i,
  /\.tar\.(?:gz|xz|bz2|lz)$/i,
  /\.7z$/i
];

/**
 * Canonical cross-platform release targets for Issue #24.
 */
export const RELEASE_TARGETS = Object.freeze({
  win: Object.freeze({
    platformKey: 'win',
    nodePlatform: 'win32',
    runnerOs: 'Windows',
    runnerLabel: 'windows-2025',
    target: 'nsis',
    arch: 'x64',
    cliPlatformFlag: '--win',
    cliArchFlag: '--x64',
    extension: 'exe',
    osSlug: 'windows',
    displayName: 'Windows x64 (NSIS .exe)',
    unpackedExecutableCandidates: ['win-unpacked/Sketchdraw.exe'],
    expectedAssetName(version) {
      return `${PRODUCT_NAME}-${version}-windows-x64.exe`;
    }
  }),
  mac: Object.freeze({
    platformKey: 'mac',
    nodePlatform: 'darwin',
    runnerOs: 'macOS',
    runnerLabel: 'macos-15',
    target: 'dmg',
    arch: 'arm64',
    cliPlatformFlag: '--mac',
    cliArchFlag: '--arm64',
    extension: 'dmg',
    osSlug: 'macos',
    displayName: 'macOS Apple Silicon M1/arm64 (.dmg)',
    unpackedExecutableCandidates: [
      'mac-arm64/Sketchdraw.app/Contents/MacOS/Sketchdraw',
      'mac/Sketchdraw.app/Contents/MacOS/Sketchdraw'
    ],
    expectedAssetName(version) {
      return `${PRODUCT_NAME}-${version}-macos-arm64.dmg`;
    }
  }),
  linux: Object.freeze({
    platformKey: 'linux',
    nodePlatform: 'linux',
    runnerOs: 'Linux',
    runnerLabel: 'ubuntu-24.04',
    target: 'deb',
    arch: 'x64',
    cliPlatformFlag: '--linux',
    cliArchFlag: '--x64',
    extension: 'deb',
    osSlug: 'linux',
    displayName: 'Linux Debian/Ubuntu x64 (.deb)',
    unpackedExecutableCandidates: [
      'linux-unpacked/de.sketchdraw.io',
      'linux-unpacked/sketchdraw',
      'linux-unpacked/Sketchdraw'
    ],
    expectedAssetName(version) {
      return `${PRODUCT_NAME}-${version}-linux-x64.deb`;
    }
  })
});

export const ORDERED_PLATFORM_KEYS = Object.freeze(['win', 'mac', 'linux']);

/**
 * Reads and parses package.json from the given project root.
 */
export function readPackageJson(rootDir = PROJECT_ROOT) {
  const pkgPath = resolve(rootDir, 'package.json');
  if (!existsSync(pkgPath)) {
    throw new Error(`package.json not found at ${pkgPath}`);
  }
  return JSON.parse(readFileSync(pkgPath, 'utf8'));
}

/**
 * Normalizes and validates a release tag string (e.g. "v0.1.0" or "refs/tags/v0.1.0").
 */
export function parseReleaseTag(rawTag) {
  if (typeof rawTag !== 'string' || rawTag.trim().length === 0) {
    throw new Error('Release tag is required and must be a non-empty string.');
  }
  const trimmed = rawTag.trim();
  const normalizedTag = trimmed.startsWith('refs/tags/')
    ? trimmed.slice('refs/tags/'.length)
    : trimmed;

  const match = RELEASE_TAG_REGEX.exec(normalizedTag);
  if (!match) {
    throw new Error(
      `Invalid release tag "${normalizedTag}". Expected strict v<major>.<minor>.<patch> format (e.g. v0.1.0).`
    );
  }

  const version = normalizedTag.slice(1);
  const prerelease = match[4] ?? null;

  return {
    tag: normalizedTag,
    version,
    prerelease,
    isPrerelease: prerelease !== null
  };
}

/**
 * Verifies that the release tag matches package.json version exactly.
 */
export function verifyVersionAndTag({ packageVersion, rawTag }) {
  if (typeof packageVersion !== 'string' || packageVersion.trim().length === 0) {
    throw new Error('package.json version must be a non-empty string.');
  }
  const normalizedPkgVersion = packageVersion.trim();
  const parsedTag = parseReleaseTag(`v${normalizedPkgVersion}`);
  const actualTag = parseReleaseTag(rawTag);

  if (actualTag.version !== parsedTag.version || actualTag.tag !== `v${normalizedPkgVersion}`) {
    throw new Error(
      `Tag version mismatch: tag "${actualTag.tag}" resolves to version "${actualTag.version}", ` +
        `but package.json has version "${normalizedPkgVersion}" (expected tag "v${normalizedPkgVersion}").`
    );
  }

  return actualTag;
}

/**
 * Default safe git command runner using execFileSync without shell interpolation.
 */
export function defaultRunGit(args, options = {}) {
  return execFileSync('git', args, {
    cwd: options.cwd ?? PROJECT_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}

/**
 * Verifies that a git tag exists, points to a commit, and matches the checked-out HEAD and optional expected SHA.
 */
export function verifyGitTagRevision({
  tag,
  expectedCommitSha = null,
  cwd = PROJECT_ROOT,
  runGit = defaultRunGit
}) {
  const parsed = parseReleaseTag(tag);
  let tagCommitSha;
  try {
    tagCommitSha = runGit(['rev-parse', '--verify', `refs/tags/${parsed.tag}^{commit}`], { cwd });
  } catch (error) {
    throw new Error(
      `Git tag "${parsed.tag}" does not exist locally or does not resolve to a valid commit: ${error.message}`
    );
  }

  if (!GIT_SHA_REGEX.test(tagCommitSha)) {
    throw new Error(
      `Resolved commit SHA for tag "${parsed.tag}" is invalid: "${tagCommitSha}".`
    );
  }

  const headCommitSha = runGit(['rev-parse', '--verify', 'HEAD'], { cwd });
  if (!GIT_SHA_REGEX.test(headCommitSha)) {
    throw new Error(`Resolved HEAD commit SHA is invalid: "${headCommitSha}".`);
  }

  const normalizedTagSha = tagCommitSha.toLowerCase();
  const normalizedHeadSha = headCommitSha.toLowerCase();

  if (normalizedTagSha !== normalizedHeadSha) {
    throw new Error(
      `Revision mismatch: tag "${parsed.tag}" points to commit ${normalizedTagSha}, ` +
        `but current checked-out HEAD is ${normalizedHeadSha}. Refusing to build or publish from a divergent commit.`
    );
  }

  if (expectedCommitSha !== null && expectedCommitSha !== undefined && expectedCommitSha !== '') {
    if (!GIT_SHA_REGEX.test(expectedCommitSha)) {
      throw new Error(`Expected commit SHA "${expectedCommitSha}" is not a valid 40-char git SHA.`);
    }
    const normalizedExpectedSha = expectedCommitSha.toLowerCase();
    if (normalizedTagSha !== normalizedExpectedSha) {
      throw new Error(
        `Tag integrity violation: tag "${parsed.tag}" resolves to ${normalizedTagSha}, ` +
          `which differs from expected workflow commit ${normalizedExpectedSha}. Existing tags must not be re-pointed.`
      );
    }
  }

  return {
    tag: parsed.tag,
    version: parsed.version,
    isPrerelease: parsed.isPrerelease,
    commitSha: normalizedTagSha
  };
}

/**
 * Verifies that the current runner OS, process.arch, git commit, and package version match the target specification.
 */
export function verifyRunnerEnvironment({
  platformKey,
  actualPlatform = process.platform,
  actualArch = process.arch,
  headCommitSha,
  expectedCommitSha,
  packageVersion,
  rawTag
}) {
  const targetSpec = RELEASE_TARGETS[platformKey];
  if (!targetSpec) {
    throw new Error(
      `Unknown platform key "${platformKey}". Expected one of: ${ORDERED_PLATFORM_KEYS.join(', ')}.`
    );
  }

  const tagInfo = verifyVersionAndTag({ packageVersion, rawTag });

  if (actualPlatform !== targetSpec.nodePlatform) {
    throw new Error(
      `Runner OS mismatch for target "${platformKey}": expected process.platform="${targetSpec.nodePlatform}", ` +
        `got "${actualPlatform}".`
    );
  }

  if (actualArch !== targetSpec.arch) {
    throw new Error(
      `Runner architecture mismatch for target "${platformKey}" (${targetSpec.displayName}): ` +
        `expected process.arch="${targetSpec.arch}", got "${actualArch}".`
    );
  }

  if (!GIT_SHA_REGEX.test(headCommitSha ?? '')) {
    throw new Error(`Invalid HEAD commit SHA: "${headCommitSha}".`);
  }
  if (!GIT_SHA_REGEX.test(expectedCommitSha ?? '')) {
    throw new Error(`Invalid expected commit SHA: "${expectedCommitSha}".`);
  }

  const normalizedHead = headCommitSha.toLowerCase();
  const normalizedExpected = expectedCommitSha.toLowerCase();
  if (normalizedHead !== normalizedExpected) {
    throw new Error(
      `Runner commit mismatch on ${platformKey}: checked-out HEAD (${normalizedHead}) ` +
        `does not match verified release commit (${normalizedExpected}).`
    );
  }

  return {
    platformKey: targetSpec.platformKey,
    target: targetSpec.target,
    arch: targetSpec.arch,
    nodePlatform: actualPlatform,
    nodeArch: actualArch,
    version: tagInfo.version,
    tag: tagInfo.tag,
    commitSha: normalizedExpected,
    expectedAssetName: targetSpec.expectedAssetName(tagInfo.version)
  };
}

/**
 * Verifies that existing build artifacts (dist/index.html, dist-electron/main.cjs, dist-electron/preload.cjs) exist.
 */
export function verifyBuildPrerequisites(rootDir = PROJECT_ROOT) {
  const requiredFiles = [
    'dist/index.html',
    'dist-electron/main.cjs',
    'dist-electron/preload.cjs',
    'dist-mcp/server.cjs',
    'electron-builder.json',
    'package.json'
  ];

  const missingOrEmpty = [];
  for (const relPath of requiredFiles) {
    const fullPath = resolve(rootDir, relPath);
    if (!existsSync(fullPath)) {
      missingOrEmpty.push(`${relPath} (missing)`);
      continue;
    }
    const st = statSync(fullPath);
    if (!st.isFile() || st.size === 0) {
      missingOrEmpty.push(`${relPath} (empty)`);
    }
  }

  if (missingOrEmpty.length > 0) {
    throw new Error(
      `Build prerequisites are missing before packaging: ${missingOrEmpty.join(', ')}. ` +
        `Run "npm run build" before packaging.`
    );
  }
}

function hasNonEmptyEnv(env, key) {
  return typeof env[key] === 'string' && env[key].trim().length > 0;
}

function normalizeOptionalSigningEnvironment(env) {
  const normalized = { ...env };
  const optionalKeys = [
    'CSC_LINK', 'CSC_KEY_PASSWORD', 'CSC_NAME', 'CSC_KEYCHAIN', 'CSC_IDENTITY_AUTO_DISCOVERY',
    'CSC_INSTALLER_LINK', 'CSC_INSTALLER_KEY_PASSWORD', 'WIN_CSC_LINK', 'WIN_CSC_KEY_PASSWORD',
    'APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER',
    'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID', 'APPLE_KEYCHAIN', 'APPLE_KEYCHAIN_PROFILE',
  ];
  const passwordSources = {
    CSC_KEY_PASSWORD: ['CSC_LINK', 'WIN_CSC_LINK'],
    WIN_CSC_KEY_PASSWORD: ['WIN_CSC_LINK'],
    CSC_INSTALLER_KEY_PASSWORD: ['CSC_INSTALLER_LINK'],
  };
  for (const key of optionalKeys) {
    if (typeof env[key] !== 'string' || env[key].trim().length !== 0) continue;
    // A configured certificate can legitimately have an empty password. Keep
    // that override, especially a Windows-specific one over a global password.
    if (passwordSources[key]?.some(source => hasNonEmptyEnv(env, source))) continue;
    // An omitted Windows link uses the generic certificate; an explicitly empty
    // Windows password can still override its password. A blank link, however,
    // is the Actions placeholder handled below, not this existing valid setup.
    if (key === 'WIN_CSC_KEY_PASSWORD' && !Object.hasOwn(env, 'WIN_CSC_LINK') && hasNonEmptyEnv(env, 'CSC_LINK')) continue;
    // Actions exposes unset secrets as ''. Builder treats a blank CSC_LINK as
    // a real path (the project directory), and blank platform links mask fallback.
    delete normalized[key];
  }
  return normalized;
}

/**
 * Determines code-signing and notarization settings based on configured environment variables.
 * Never reads or logs secret values, and never fabricates certificates or Apple Team IDs.
 */
export function resolveSigningConfiguration(platformKey, env = process.env) {
  if (platformKey === 'mac') {
    const hasMacCert = hasNonEmptyEnv(env, 'CSC_LINK') || hasNonEmptyEnv(env, 'CSC_NAME');
    const hasApiKeyNotarization =
      hasNonEmptyEnv(env, 'APPLE_API_KEY') &&
      hasNonEmptyEnv(env, 'APPLE_API_KEY_ID') &&
      hasNonEmptyEnv(env, 'APPLE_API_ISSUER');
    const hasAppleIdNotarization =
      hasNonEmptyEnv(env, 'APPLE_ID') &&
      hasNonEmptyEnv(env, 'APPLE_APP_SPECIFIC_PASSWORD') &&
      hasNonEmptyEnv(env, 'APPLE_TEAM_ID');
    // electron-builder resolves named profiles from the default macOS keychain when no
    // explicit keychain path is provided. APPLE_KEYCHAIN only overrides that location.
    const hasKeychainNotarization = hasNonEmptyEnv(env, 'APPLE_KEYCHAIN_PROFILE');

    const hasNotarizationCredentials =
      hasApiKeyNotarization || hasAppleIdNotarization || hasKeychainNotarization;

    if (hasMacCert && hasNotarizationCredentials) {
      return {
        mode: 'developer-id-notarized',
        signed: true,
        notarized: true,
        summary: 'Developer ID signed and Apple notarized',
        extraCliArgs: ['-c.mac.notarize=true'],
        envOverrides: {}
      };
    }

    if (hasMacCert) {
      return {
        mode: 'developer-id-signed',
        signed: true,
        notarized: false,
        summary: 'Developer ID signed (notarization credentials not configured)',
        extraCliArgs: ['-c.mac.notarize=false'],
        envOverrides: {}
      };
    }

    // Without Developer ID credentials, use ad-hoc signing ("-") so macOS arm64 (Apple Silicon)
    // code-signature & JIT entitlement checks remain intact without fabricating certificates.
    return {
      mode: 'adhoc-unsigned',
      signed: false,
      notarized: false,
      summary: 'Ad-hoc signed for Apple Silicon arm64 compatibility (no Developer ID / notarization configured)',
      extraCliArgs: ['-c.mac.identity=-', '-c.mac.notarize=false', '-c.mac.timestamp=none'],
      envOverrides: {
        CSC_IDENTITY_AUTO_DISCOVERY: 'false'
      }
    };
  }

  if (platformKey === 'win') {
    const hasWinCert = hasNonEmptyEnv(env, 'WIN_CSC_LINK') || hasNonEmptyEnv(env, 'CSC_LINK');
    if (hasWinCert) {
      return {
        mode: 'authenticode-signed',
        signed: true,
        notarized: false,
        summary: 'Authenticode signed',
        extraCliArgs: [],
        envOverrides: {}
      };
    }

    return {
      mode: 'unsigned',
      signed: false,
      notarized: false,
      summary: 'Unsigned (no Authenticode certificate configured)',
      extraCliArgs: [],
      envOverrides: {
        CSC_IDENTITY_AUTO_DISCOVERY: 'false'
      }
    };
  }

  if (platformKey === 'linux') {
    return {
      mode: 'unsigned',
      signed: false,
      notarized: false,
      summary: 'Standard Debian archive (.deb, unsigned)',
      extraCliArgs: [],
      envOverrides: {
        CSC_IDENTITY_AUTO_DISCOVERY: 'false'
      }
    };
  }

  throw new Error(`Unsupported platform key "${platformKey}" for signing resolution.`);
}

/**
 * Computes the lowercase hex SHA-256 digest of a file.
 */
export function computeSha256(filePath) {
  const hash = createHash('sha256');
  const fd = openSync(filePath, 'r');
  const buffer = Buffer.alloc(1024 * 1024);
  try {
    let count;
    while ((count = readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, count));
    return hash.digest('hex');
  } finally { closeSync(fd); }
}

function readBytesAt(filePath, offset, length) {
  const fd = openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const bytesRead = readSync(fd, buffer, 0, length, offset);
    return buffer.subarray(0, bytesRead);
  } finally {
    closeSync(fd);
  }
}

/**
 * Inspects a binary file's magic headers/trailers to verify format and CPU architecture.
 * Supports:
 * - Windows PE (.exe): DOS MZ + PE\0\0 header + Machine type (0x8664 = x64, 0x014c = i386 NSIS stub, 0xaa64 = arm64)
 * - macOS Mach-O: 64-bit Mach-O (0xfeedfacf) or Universal Fat binary + CPU_TYPE_ARM64 (0x0100000c)
 * - macOS UDIF Disk Image (.dmg): 512-byte trailing "koly" block
 * - Linux ELF64: \x7fELF + ELFCLASS64 + EM_X86_64 (0x003e)
 * - Linux Debian package (.deb): Unix ar archive "!<arch>\n" + "debian-binary" member
 */
export function inspectBinaryFile(filePath) {
  if (!existsSync(filePath)) {
    throw new Error(`Binary file does not exist: ${filePath}`);
  }
  const st = statSync(filePath);
  if (!st.isFile() || st.size < 16) {
    throw new Error(`Binary file is too small or not a regular file: ${filePath} (${st.size} bytes)`);
  }

  const head = readBytesAt(filePath, 0, Math.min(st.size, 512));

  // 1. Check Windows PE ("MZ")
  if (head[0] === 0x4d && head[1] === 0x5a && head.length >= 0x40) {
    const peOffset = head.readUInt32LE(0x3c);
    if (peOffset > 0 && peOffset + 6 <= st.size) {
      const peHeader = readBytesAt(filePath, peOffset, 6);
      if (
        peHeader.length === 6 &&
        peHeader[0] === 0x50 &&
        peHeader[1] === 0x45 &&
        peHeader[2] === 0x00 &&
        peHeader[3] === 0x00
      ) {
        const machine = peHeader.readUInt16LE(4);
        const archMap = {
          0x8664: 'x64',
          0x014c: 'ia32',
          0xaa64: 'arm64'
        };
        return {
          format: 'pe',
          machine,
          arch: archMap[machine] ?? `unknown-0x${machine.toString(16)}`,
          sizeBytes: st.size
        };
      }
    }
  }

  // 2. Check Mach-O 64-bit (little-endian MH_MAGIC_64: 0xcf 0xfa 0xed 0xfe)
  if (
    head.length >= 8 &&
    head[0] === 0xcf &&
    head[1] === 0xfa &&
    head[2] === 0xed &&
    head[3] === 0xfe
  ) {
    const cpuType = head.readUInt32LE(4);
    const archMap = {
      0x0100000c: 'arm64',
      0x01000007: 'x64'
    };
    return {
      format: 'macho64',
      cpuType,
      arch: archMap[cpuType] ?? `unknown-0x${cpuType.toString(16)}`,
      sizeBytes: st.size
    };
  }

  // 3. Check Mach-O Universal / Fat binary (big-endian FAT_MAGIC: 0xca 0xfe 0xba 0xbe)
  if (
    head.length >= 8 &&
    head[0] === 0xca &&
    head[1] === 0xfe &&
    head[2] === 0xba &&
    head[3] === 0xbe
  ) {
    const nfatArch = head.readUInt32BE(4);
    const architectures = [];
    for (let i = 0; i < Math.min(nfatArch, 8); i += 1) {
      const entryOffset = 8 + i * 20;
      if (entryOffset + 4 <= head.length) {
        const cpuType = head.readUInt32BE(entryOffset);
        if (cpuType === 0x0100000c) architectures.push('arm64');
        else if (cpuType === 0x01000007) architectures.push('x64');
        else architectures.push(`unknown-0x${cpuType.toString(16)}`);
      }
    }
    return {
      format: 'macho-universal',
      architectures,
      arch: architectures.includes('arm64') ? 'arm64' : architectures[0] ?? 'unknown',
      sizeBytes: st.size
    };
  }

  // 4. Check Linux ELF ("\x7fELF")
  if (
    head.length >= 20 &&
    head[0] === 0x7f &&
    head[1] === 0x45 &&
    head[2] === 0x4c &&
    head[3] === 0x46
  ) {
    const elfClass = head[4]; // 2 = 64-bit
    const elfData = head[5]; // 1 = little-endian
    const machine = elfData === 1 ? head.readUInt16LE(18) : head.readUInt16BE(18);
    const archMap = {
      0x003e: 'x64',
      0x00b7: 'arm64',
      0x0003: 'ia32'
    };
    return {
      format: elfClass === 2 ? 'elf64' : 'elf32',
      machine,
      arch: archMap[machine] ?? `unknown-0x${machine.toString(16)}`,
      sizeBytes: st.size
    };
  }

  // 5. Check Debian archive ("!<arch>\n" followed by "debian-binary")
  const arSignature = head.subarray(0, 8).toString('ascii');
  if (arSignature === '!<arch>\n' && head.length >= 24) {
    const firstMemberName = head.subarray(8, 24).toString('ascii').trim();
    if (firstMemberName.startsWith('debian-binary')) {
      return {
        format: 'deb',
        firstMember: firstMemberName,
        sizeBytes: st.size
      };
    }
  }

  // 6. Check Apple UDIF DMG ("koly" trailer in last 512 bytes)
  if (st.size >= 512) {
    const trailer = readBytesAt(filePath, st.size - 512, 4);
    if (
      trailer.length === 4 &&
      trailer[0] === 0x6b &&
      trailer[1] === 0x6f &&
      trailer[2] === 0x6c &&
      trailer[3] === 0x79
    ) {
      return {
        format: 'dmg',
        trailerSignature: 'koly',
        sizeBytes: st.size
      };
    }
  }

  throw new Error(`Unrecognized or corrupted binary format in file: ${filePath}`);
}

/**
 * Verifies the unpacked application binary generated by electron-builder matches the target architecture.
 */
export function verifyUnpackedBinaryArchitecture({ platformKey, releaseDir }) {
  const targetSpec = RELEASE_TARGETS[platformKey];
  if (!targetSpec) {
    throw new Error(`Unknown platform key "${platformKey}".`);
  }

  const candidatePaths = targetSpec.unpackedExecutableCandidates.map((rel) =>
    resolve(releaseDir, rel)
  );
  const existingPath = candidatePaths.find((fullPath) => existsSync(fullPath));

  if (!existingPath) {
    throw new Error(
      `Unpacked application binary for "${platformKey}" not found. Checked: ${candidatePaths.join(', ')}`
    );
  }

  const inspection = inspectBinaryFile(existingPath);

  if (platformKey === 'win') {
    if (inspection.format !== 'pe' || inspection.arch !== 'x64') {
      throw new Error(
        `Windows unpacked binary architecture mismatch at ${existingPath}: ` +
          `expected PE x64, got format="${inspection.format}" arch="${inspection.arch}".`
      );
    }
  } else if (platformKey === 'mac') {
    const validMacFormat =
      inspection.format === 'macho64' || inspection.format === 'macho-universal';
    if (!validMacFormat || inspection.arch !== 'arm64') {
      throw new Error(
        `macOS unpacked binary architecture mismatch at ${existingPath}: ` +
          `expected Mach-O arm64, got format="${inspection.format}" arch="${inspection.arch}".`
      );
    }
  } else if (platformKey === 'linux') {
    if (inspection.format !== 'elf64' || inspection.arch !== 'x64') {
      throw new Error(
        `Linux unpacked binary architecture mismatch at ${existingPath}: ` +
          `expected ELF64 x64, got format="${inspection.format}" arch="${inspection.arch}".`
      );
    }
  }

  return {
    executablePath: existingPath,
    ...inspection
  };
}

/**
 * Verifies that a packaged installer file has a valid binary container format for its platform.
 */
export function verifyInstallerBinaryHeader({ platformKey, installerPath }) {
  const inspection = inspectBinaryFile(installerPath);

  if (platformKey === 'win') {
    // NSIS setup wrapper is a PE executable (either x64 0x8664 or NSIS Unicode stub 0x014c wrapping x64 payload)
    if (
      inspection.format !== 'pe' ||
      (inspection.arch !== 'x64' && inspection.arch !== 'ia32')
    ) {
      throw new Error(
        `Windows NSIS installer binary check failed for ${installerPath}: ` +
          `expected PE executable, got format="${inspection.format}" arch="${inspection.arch}".`
      );
    }
  } else if (platformKey === 'mac') {
    if (inspection.format !== 'dmg' || inspection.trailerSignature !== 'koly') {
      throw new Error(
        `macOS DMG installer binary check failed for ${installerPath}: ` +
          `expected UDIF DMG with "koly" trailer, got format="${inspection.format}".`
      );
    }
  } else if (platformKey === 'linux') {
    if (inspection.format !== 'deb') {
      throw new Error(
        `Linux Debian installer binary check failed for ${installerPath}: ` +
          `expected Debian ar archive, got format="${inspection.format}".`
      );
    }
  } else {
    throw new Error(`Unknown platform key "${platformKey}".`);
  }

  return inspection;
}

/**
 * Checks whether a filename matches any forbidden release asset pattern.
 */
export function isForbiddenReleaseAsset(fileName) {
  return FORBIDDEN_RELEASE_ASSET_PATTERNS.some((pattern) => pattern.test(fileName));
}

/**
 * Default electron-builder runner using execFileSync without shell interpolation.
 */
export function defaultRunElectronBuilder(args, options = {}) {
  const cliPath = resolve(
    options.rootDir ?? PROJECT_ROOT,
    'node_modules',
    'electron-builder',
    'cli.js'
  );
  if (!existsSync(cliPath)) {
    throw new Error(`electron-builder CLI not found at ${cliPath}`);
  }
  execFileSync(process.execPath, [cliPath, ...args], {
    cwd: options.rootDir ?? PROJECT_ROOT,
    env: options.env ?? process.env,
    stdio: 'inherit'
  });
}

export function defaultRunInstallerSmoke({ platformKey, installerPath, version, commitSha,
  rootDir = PROJECT_ROOT, releaseDir = resolve(rootDir, 'release'), env = process.env }) {
  const outputPath = resolve(releaseDir, `smoke-${platformKey}.json`);
  rmSync(outputPath, { force: true });
  execFileSync(process.execPath, [resolve(rootDir, 'scripts/release-installer-smoke.mjs'),
    '--platform', platformKey, '--installer', installerPath, '--version', version,
    '--commit', commitSha, '--output', outputPath], {
    cwd: rootDir, env, stdio: 'inherit', timeout: 300_000,
  });
  return JSON.parse(readFileSync(outputPath, 'utf8'));
}

export function verifyInstallerSmokeEvidence(smoke, expected) {
  if (!smoke || smoke.schemaVersion !== 1 || smoke.passed !== true ||
      smoke.source !== 'installer-extracted' || smoke.appIsPackaged !== true || smoke.sandbox !== true ||
      smoke.platformKey !== expected.platformKey || smoke.version !== expected.version ||
      smoke.commitSha !== expected.commitSha || smoke.installerSha256 !== expected.installerSha256 ||
      smoke.appVersion !== expected.version || smoke.appArch !== expected.arch ||
      smoke.mcp?.initialized !== true || smoke.mcp?.deniedWithoutGrant !== true || !Array.isArray(smoke.mcp.tools)) {
    throw new Error('Missing or mismatched real installer/app/MCP smoke evidence.');
  }
  const tools = ['sketchdraw_read_document', 'sketchdraw_find_elements', 'sketchdraw_analyze_document',
    'sketchdraw_apply_commands', 'sketchdraw_read_code', 'sketchdraw_apply_code'].sort();
  if (JSON.stringify([...smoke.mcp.tools].sort()) !== JSON.stringify(tools)) throw new Error('Incomplete packaged MCP tool surface.');
  for (const file of ['dist/index.html', 'dist-electron/main.cjs', 'dist-electron/preload.cjs', 'dist-mcp/server.cjs']) {
    if (!/^[a-f0-9]{64}$/.test(smoke.bundleHashes?.[file] ?? '')) throw new Error(`Missing packaged bundle hash: ${file}`);
  }
}

/**
 * Packages the single platform installer, verifies both unpacked and installer binaries,
 * and stages ONLY the verified installer + its manifest JSON in stagingDir.
 */
export function packagePlatformInstaller({
  platformKey,
  rawTag,
  commitSha,
  rootDir = PROJECT_ROOT,
  releaseDir = resolve(rootDir, 'release'),
  stagingDir = resolve(releaseDir, 'staged', platformKey),
  minSizeBytes = DEFAULT_MIN_INSTALLER_SIZE_BYTES,
  env = process.env,
  actualPlatform = process.platform,
  actualArch = process.arch,
  runElectronBuilder = defaultRunElectronBuilder,
  runInstallerSmoke = defaultRunInstallerSmoke,
}) {
  const pkg = readPackageJson(rootDir);
  const verifiedEnv = verifyRunnerEnvironment({
    platformKey,
    actualPlatform,
    actualArch,
    headCommitSha: commitSha,
    expectedCommitSha: commitSha,
    packageVersion: pkg.version,
    rawTag
  });

  verifyBuildPrerequisites(rootDir);

  const targetSpec = RELEASE_TARGETS[platformKey];
  const signing = resolveSigningConfiguration(platformKey, env);

  const builderArgs = [
    targetSpec.cliPlatformFlag,
    targetSpec.cliArchFlag,
    '--config',
    'electron-builder.json',
    '--publish',
    'never',
    ...signing.extraCliArgs
  ];

  const builderEnv = {
    ...normalizeOptionalSigningEnvironment(env),
    ...signing.envOverrides
  };
  // Never pass GITHUB_TOKEN or GH_TOKEN to electron-builder so it cannot auto-publish
  delete builderEnv.GITHUB_TOKEN;
  delete builderEnv.GH_TOKEN;

  // An earlier artifact must never stand in for this build.
  rmSync(resolve(releaseDir, verifiedEnv.expectedAssetName), { force: true });
  runElectronBuilder(builderArgs, { rootDir, env: builderEnv });

  const expectedAssetName = verifiedEnv.expectedAssetName;
  const installerPath = resolve(releaseDir, expectedAssetName);

  if (!existsSync(installerPath)) {
    throw new Error(
      `Expected installer "${expectedAssetName}" was not generated in ${releaseDir}.`
    );
  }

  const installerStats = statSync(installerPath);
  if (!installerStats.isFile() || installerStats.size < minSizeBytes) {
    throw new Error(
      `Generated installer "${expectedAssetName}" is smaller than minimum threshold ` +
        `(${installerStats.size} bytes < ${minSizeBytes} bytes).`
    );
  }

  const unpackedInspection = verifyUnpackedBinaryArchitecture({
    platformKey,
    releaseDir
  });
  const installerInspection = verifyInstallerBinaryHeader({
    platformKey,
    installerPath
  });

  const sha256 = computeSha256(installerPath);
  const smoke = runInstallerSmoke({ platformKey, installerPath, version: verifiedEnv.version,
    commitSha: verifiedEnv.commitSha, rootDir, releaseDir, env: builderEnv });
  verifyInstallerSmokeEvidence(smoke, { platformKey, version: verifiedEnv.version,
    commitSha: verifiedEnv.commitSha, installerSha256: sha256, arch: targetSpec.arch });
  if (computeSha256(installerPath) !== sha256) throw new Error('Installer changed after smoke verification.');

  // Stage ONLY the single verified installer and its manifest file
  rmSync(stagingDir, { recursive: true, force: true });
  mkdirSync(stagingDir, { recursive: true });

  const stagedInstallerPath = resolve(stagingDir, expectedAssetName);
  copyFileSync(installerPath, stagedInstallerPath);

  const manifest = {
    schemaVersion: 1,
    productName: PRODUCT_NAME,
    version: verifiedEnv.version,
    tag: verifiedEnv.tag,
    commitSha: verifiedEnv.commitSha,
    platformKey: targetSpec.platformKey,
    osSlug: targetSpec.osSlug,
    displayName: targetSpec.displayName,
    target: targetSpec.target,
    arch: targetSpec.arch,
    runnerLabel: targetSpec.runnerLabel,
    processPlatform: actualPlatform,
    processArch: actualArch,
    fileName: expectedAssetName,
    sizeBytes: installerStats.size,
    sha256,
    signing: {
      mode: signing.mode,
      signed: signing.signed,
      notarized: signing.notarized,
      summary: signing.summary
    },
    smokeVerification: smoke,
    binaryVerification: {
      installerFormat: installerInspection.format,
      unpackedFormat: unpackedInspection.format,
      unpackedArch: unpackedInspection.arch
    }
  };

  const stagedManifestPath = resolve(stagingDir, `${expectedAssetName}.manifest.json`);
  writeFileSync(stagedManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  // Verify staging directory contains strictly those two files
  const stagedEntries = readdirSync(stagingDir).sort();
  const expectedEntries = [expectedAssetName, `${expectedAssetName}.manifest.json`].sort();
  if (
    stagedEntries.length !== 2 ||
    stagedEntries[0] !== expectedEntries[0] ||
    stagedEntries[1] !== expectedEntries[1]
  ) {
    throw new Error(
      `Staging directory ${stagingDir} contains unexpected files: ${stagedEntries.join(', ')}`
    );
  }

  return {
    stagedInstallerPath,
    stagedManifestPath,
    manifest
  };
}

/**
 * Recursively collects all regular files in a directory.
 */
function listFilesRecursively(dirPath) {
  if (!existsSync(dirPath)) {
    throw new Error(`Artifacts directory does not exist: ${dirPath}`);
  }
  const results = [];
  for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = join(dirPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...listFilesRecursively(fullPath));
    } else if (entry.isFile()) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Validates the complete set of 3 platform installers and their manifests prior to release creation/publication.
 * Ensures:
 * - No forbidden files (.blockmap, latest.yml, builder-debug.yml, checksum files, extra archives) exist
 * - Exactly 3 installer files and 3 manifest files exist
 * - Filenames match Sketchdraw-<version>-windows-x64.exe, Sketchdraw-<version>-macos-arm64.dmg, Sketchdraw-<version>-linux-x64.deb
 * - Every installer passes binary header validation, size threshold, SHA-256 verification, and commit/version/arch checks
 */
export function validateCollectedReleaseArtifacts({
  artifactsDir,
  version,
  tag,
  commitSha,
  minSizeBytes = DEFAULT_MIN_INSTALLER_SIZE_BYTES
}) {
  const parsedTag = verifyVersionAndTag({ packageVersion: version, rawTag: tag });
  if (!GIT_SHA_REGEX.test(commitSha ?? '')) {
    throw new Error(`Invalid commit SHA "${commitSha}".`);
  }
  const normalizedCommitSha = commitSha.toLowerCase();

  const allFiles = listFilesRecursively(artifactsDir);
  if (allFiles.length === 0) {
    throw new Error(`No files found in artifacts directory: ${artifactsDir}`);
  }

  const forbiddenFound = [];
  const manifestFilesByName = new Map();
  const installerFilesByName = new Map();

  for (const filePath of allFiles) {
    const name = basename(filePath);
    if (isForbiddenReleaseAsset(name)) {
      forbiddenFound.push(name);
      continue;
    }
    if (name.endsWith('.manifest.json')) {
      if (manifestFilesByName.has(name)) {
        throw new Error(`Duplicate manifest file found in artifacts directory: ${name}`);
      }
      manifestFilesByName.set(name, filePath);
    } else {
      if (installerFilesByName.has(name)) {
        throw new Error(`Duplicate installer file found in artifacts directory: ${name}`);
      }
      installerFilesByName.set(name, filePath);
    }
  }

  if (forbiddenFound.length > 0) {
    throw new Error(
      `Forbidden build or updater artifacts detected in release bundle: ${forbiddenFound.join(', ')}. ` +
        `Only the three verified installer packages may be staged.`
    );
  }

  const expectedInstallers = ORDERED_PLATFORM_KEYS.map((platformKey) => {
    const spec = RELEASE_TARGETS[platformKey];
    return {
      platformKey,
      spec,
      expectedName: spec.expectedAssetName(parsedTag.version)
    };
  });

  const expectedNameSet = new Set(expectedInstallers.map((item) => item.expectedName));
  const unexpectedInstallers = [...installerFilesByName.keys()].filter(
    (name) => !expectedNameSet.has(name)
  );
  if (unexpectedInstallers.length > 0) {
    throw new Error(
      `Unexpected installer or extra files found in release artifacts: ${unexpectedInstallers.join(', ')}. ` +
        `Expected strictly: ${[...expectedNameSet].join(', ')}.`
    );
  }

  const missingInstallers = expectedInstallers
    .map((item) => item.expectedName)
    .filter((name) => !installerFilesByName.has(name));
  if (missingInstallers.length > 0) {
    throw new Error(
      `Incomplete release artifact set. Missing installer packages: ${missingInstallers.join(', ')}.`
    );
  }

  if (installerFilesByName.size !== 3) {
    throw new Error(
      `Expected exactly 3 installer files, found ${installerFilesByName.size}.`
    );
  }

  if (manifestFilesByName.size !== 3) {
    throw new Error(
      `Expected exactly 3 artifact manifest files, found ${manifestFilesByName.size}.`
    );
  }

  const validatedArtifacts = [];

  for (const { platformKey, spec, expectedName } of expectedInstallers) {
    const installerPath = installerFilesByName.get(expectedName);
    const manifestName = `${expectedName}.manifest.json`;
    const manifestPath = manifestFilesByName.get(manifestName);

    if (!manifestPath) {
      throw new Error(`Missing build manifest "${manifestName}" for installer "${expectedName}".`);
    }

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const st = statSync(installerPath);

    if (!st.isFile() || st.size < minSizeBytes) {
      throw new Error(
        `Installer "${expectedName}" failed size check (${st.size} bytes < ${minSizeBytes} bytes).`
      );
    }

    if (manifest.fileName !== expectedName) {
      throw new Error(
        `Manifest filename mismatch for "${expectedName}": manifest records "${manifest.fileName}".`
      );
    }
    if (manifest.version !== parsedTag.version) {
      throw new Error(
        `Manifest version mismatch for "${expectedName}": expected "${parsedTag.version}", got "${manifest.version}".`
      );
    }
    if (manifest.tag !== parsedTag.tag) {
      throw new Error(
        `Manifest tag mismatch for "${expectedName}": expected "${parsedTag.tag}", got "${manifest.tag}".`
      );
    }
    if (
      typeof manifest.commitSha !== 'string' ||
      manifest.commitSha.toLowerCase() !== normalizedCommitSha
    ) {
      throw new Error(
        `Manifest commit mismatch for "${expectedName}": expected "${normalizedCommitSha}", got "${manifest.commitSha}".`
      );
    }
    if (manifest.platformKey !== platformKey) {
      throw new Error(
        `Manifest platformKey mismatch for "${expectedName}": expected "${platformKey}", got "${manifest.platformKey}".`
      );
    }
    if (manifest.target !== spec.target) {
      throw new Error(
        `Manifest target mismatch for "${expectedName}": expected "${spec.target}", got "${manifest.target}".`
      );
    }
    if (manifest.arch !== spec.arch) {
      throw new Error(
        `Manifest architecture mismatch for "${expectedName}": expected "${spec.arch}", got "${manifest.arch}".`
      );
    }
    if (manifest.processArch !== spec.arch) {
      throw new Error(
        `Manifest runner process.arch mismatch for "${expectedName}": expected "${spec.arch}", got "${manifest.processArch}".`
      );
    }
    if (manifest.processPlatform !== spec.nodePlatform) {
      throw new Error(
        `Manifest runner process.platform mismatch for "${expectedName}": expected "${spec.nodePlatform}", got "${manifest.processPlatform}".`
      );
    }
    if (
      !manifest.binaryVerification ||
      manifest.binaryVerification.unpackedArch !== spec.arch
    ) {
      throw new Error(
        `Manifest unpacked binary architecture check missing or mismatched for "${expectedName}": ` +
          `expected "${spec.arch}", got "${manifest.binaryVerification?.unpackedArch}".`
      );
    }

    const binaryInspection = verifyInstallerBinaryHeader({
      platformKey,
      installerPath
    });

    if (st.size !== manifest.sizeBytes) {
      throw new Error(
        `Installer size mismatch for "${expectedName}": file has ${st.size} bytes, manifest recorded ${manifest.sizeBytes} bytes.`
      );
    }

    const actualSha256 = computeSha256(installerPath).toLowerCase();
    const expectedSha256 = String(manifest.sha256 ?? '').toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(expectedSha256) || actualSha256 !== expectedSha256) {
      throw new Error(
        `SHA-256 checksum mismatch for "${expectedName}": computed ${actualSha256}, manifest recorded ${expectedSha256}.`
      );
    }

    verifyInstallerSmokeEvidence(manifest.smokeVerification, {
      platformKey, version: parsedTag.version, commitSha: normalizedCommitSha,
      installerSha256: actualSha256, arch: spec.arch,
    });

    validatedArtifacts.push({
      platformKey,
      displayName: spec.displayName,
      target: spec.target,
      arch: spec.arch,
      fileName: expectedName,
      filePath: installerPath,
      sizeBytes: st.size,
      sha256: actualSha256,
      signing: manifest.signing ?? {
        mode: 'unsigned',
        signed: false,
        notarized: false,
        summary: 'Unsigned'
      },
      binaryInspection
    });
  }

  return validatedArtifacts;
}

/**
 * Formats byte counts into a human-readable MiB/KiB string.
 */
export function formatByteSize(bytes) {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MiB (${bytes} B)`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(2)} KiB (${bytes} B)`;
  }
  return `${bytes} B`;
}

/**
 * Generates deterministic Markdown release notes containing the 3 final asset links,
 * SHA-256 checksums, and honest code-signing / platform execution notes.
 * No separate checksum files are attached to the release.
 */
export function generateReleaseNotes({
  version,
  tag,
  commitSha,
  repository = DEFAULT_REPOSITORY,
  artifacts
}) {
  if (!Array.isArray(artifacts) || artifacts.length !== 3) {
    throw new Error('generateReleaseNotes requires exactly 3 validated artifacts.');
  }

  const lines = [
    `# ${PRODUCT_NAME} ${tag}`,
    '',
    `- **Version:** \`${version}\``,
    `- **Git-Tag:** \`${tag}\``,
    `- **Commit-Revision:** \`${commitSha}\``,
    '',
    '## Installationspakete (Direktlinks & SHA-256 Prüfsummen)',
    '',
    '| Plattform | Format / Architektur | Download-Link | Größe | Signaturstatus | SHA-256 Prüfsumme |',
    '| --- | --- | --- | --- | --- | --- |'
  ];

  for (const artifact of artifacts) {
    const downloadUrl = `https://github.com/${repository}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(artifact.fileName)}`;
    const signingLabel = artifact.signing?.summary ?? 'Unsigned';
    lines.push(
      `| ${artifact.displayName} | \`${artifact.target}\` (\`${artifact.arch}\`) | [${artifact.fileName}](${downloadUrl}) | ${formatByteSize(artifact.sizeBytes)} | ${signingLabel} | \`${artifact.sha256}\` |`
    );
  }

  lines.push(
    '',
    '### SHA-256 Prüfsummen (Textformat)',
    '',
    '```text'
  );

  for (const artifact of artifacts) {
    lines.push(`${artifact.sha256}  ${artifact.fileName}`);
  }

  lines.push(
    '```',
    '',
    '## Hinweise zu Signierung und Ausführung',
    '',
    '- **macOS Apple Silicon (M1/arm64 `.dmg`):** Nativ für `arm64` gebaut. Sofern keine Apple Developer ID / Notarisierungs-Secrets konfiguriert waren, ist das App-Bundle für die native Ausführung auf Apple Silicon ad-hoc signiert (`codesign --sign -`). Beim ersten Öffnen ohne Apple-Notarisierung kann macOS Gatekeeper eine Bestätigung über *Systemeinstellungen → Datenschutz & Sicherheit → Dennoch öffnen* erfordern.',
    '- **Windows x64 (NSIS `.exe`):** 64-Bit-Installer für Windows 10/11 (`x64`). Ohne hinterlegtes Authenticode-Zertifikat zeigt Windows SmartScreen beim ersten Start ggf. einen Hinweis für unsignierte Anwendungen an.',
    '- **Linux Debian/Ubuntu x64 (`.deb`):** 64-Bit-Debian-Paket (`x64`/`amd64`), installierbar über `sudo apt install ./Sketchdraw-' +
      `${version}-linux-x64.deb\`.`
  );

  lines.push('', releaseOwnershipMarker({ repository, tag, commitSha, artifacts }));
  return `${lines.join('\n')}\n`;
}

/**
 * Default GitHub CLI runner using execFileSync without shell interpolation.
 * Passes GITHUB_TOKEN strictly via environment variables and never logs token values.
 */
export function defaultRunGh(args, options = {}) {
  const token = options.env?.GITHUB_TOKEN ?? process.env.GITHUB_TOKEN;
  if (typeof token !== 'string' || token.trim().length === 0) {
    throw new Error('GITHUB_TOKEN environment variable is required for GitHub CLI operations.');
  }

  return execFileSync('gh', args, {
    cwd: options.cwd ?? PROJECT_ROOT,
    env: {
      ...process.env,
      ...options.env,
      GITHUB_TOKEN: token,
      GH_TOKEN: token
    },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'], timeout: options.timeoutMs ?? 120_000, maxBuffer: 4 * 1024 * 1024
  }).trim();
}

/**
 * Fetches release metadata for a tag via the GitHub REST API (`gh api`).
 * The tag endpoint can return 404 for drafts, so search all release pages before
 * returning null. Preserve REST metadata for the publisher's ownership guards.
 */
export function fetchReleaseByTag({ repository, tag, runGh = defaultRunGh, env = process.env }) {
  const encodedTag = encodeURIComponent(tag);
  let rawJson;
  try {
    rawJson = runGh(
      ['api', `repos/${repository}/releases/tags/${encodedTag}`],
      { env }
    );
  } catch (error) {
    const message = String(error.stderr ?? error.message ?? '');
    if (!/\bHTTP 404\b/.test(message)) {
      throw new Error(`Failed to query GitHub release for tag "${tag}": ${message}`);
    }
    let pages;
    try {
      pages = JSON.parse(runGh(
        ['api', `repos/${repository}/releases?per_page=100`, '--paginate', '--slurp'],
        { env }
      ));
    } catch (listError) {
      throw new Error(`Failed to list GitHub releases for tag "${tag}": ${String(listError.stderr ?? listError.message ?? '')}`);
    }
    if (!Array.isArray(pages) || pages.length === 0 || pages.some(page => !Array.isArray(page) || page.some(
      release => !release || typeof release !== 'object' || Array.isArray(release) || typeof release.tag_name !== 'string'
    ))) throw new Error('Malformed paginated GitHub releases response; refusing to assume release absence.');
    const matches = pages.flat().filter(release => release.tag_name === tag);
    if (matches.length > 1) throw new Error(`Multiple GitHub releases match tag "${tag}"; refusing ambiguous release identity.`);
    return matches[0] ?? null;
  }
  // Parsing is outside the request catch: bad JSON is never an HTTP 404.
  const release = JSON.parse(rawJson);
  if (!release || typeof release !== 'object' || Array.isArray(release) || typeof release.tag_name !== 'string') {
    throw new Error('Malformed GitHub release response; refusing to assume release absence.');
  }
  return release;
}

export function releaseOwnershipMarker({ repository, tag, commitSha, artifacts }) {
  return `<!-- sketchdraw-release-v1:${JSON.stringify({
    repository, tag, commitSha,
    assets: artifacts.map(({ fileName, sizeBytes, sha256 }) => ({ fileName, sizeBytes, sha256 }))
  })} -->`;
}

export function verifyManagedRelease({ releaseData, repository, tag, commitSha, artifacts }) {
  if (!Number.isSafeInteger(releaseData?.id) || releaseData.id <= 0 ||
      releaseData.tag_name !== tag || typeof releaseData.draft !== 'boolean' ||
      releaseData.author?.login !== 'github-actions[bot]' || releaseData.author?.type !== 'Bot') {
    throw new Error('Release is not an identified GitHub Actions managed release; refusing mutation.');
  }
  const markers = String(releaseData.body ?? '').match(/<!-- sketchdraw-release-v1:.*? -->/g) ?? [];
  if (markers.length !== 1 || markers[0] !== releaseOwnershipMarker({ repository, tag, commitSha, artifacts })) {
    throw new Error('Release ownership, revision, or artifact identity mismatch; refusing mutation.');
  }
}

export function verifyRemoteTag({ repository, tag, commitSha, runGh = defaultRunGh, env = process.env }) {
  let data = JSON.parse(runGh(['api', `repos/${repository}/git/ref/tags/${encodeURIComponent(tag)}`], { env }));
  for (let depth = 0; depth < 8; depth++) {
    const object = data.object;
    if (!object || !GIT_SHA_REGEX.test(object.sha ?? '')) throw new Error('Invalid remote tag object.');
    if (object.type === 'commit') {
      if (object.sha.toLowerCase() !== commitSha.toLowerCase()) throw new Error('Remote tag revision changed.');
      return;
    }
    if (object.type !== 'tag') throw new Error('Remote tag does not resolve to a commit.');
    data = JSON.parse(runGh(['api', `repos/${repository}/git/tags/${object.sha}`], { env }));
  }
  throw new Error('Remote annotated tag chain exceeds limit.');
}

// Stream downloaded bytes to an owned temporary file, never through a text/JSON decoder.
export function defaultDownloadRemoteAsset({ repository, assetId, destination, env = process.env }) {
  if (!Number.isSafeInteger(assetId) || assetId <= 0) throw new Error('Invalid remote asset ID.');
  const token = env.GITHUB_TOKEN;
  if (typeof token !== 'string' || !token.trim()) throw new Error('GITHUB_TOKEN is required.');
  const fd = openSync(destination, 'wx', 0o600);
  try {
    execFileSync('gh', ['api', `repos/${repository}/releases/assets/${assetId}`,
      '--header', 'Accept: application/octet-stream'], {
      env: { ...process.env, ...env, GITHUB_TOKEN: token, GH_TOKEN: token },
      stdio: ['ignore', fd, 'pipe'], timeout: 120_000, maxBuffer: 64 * 1024,
    });
  } finally { closeSync(fd); }
}

export function verifyRemoteReleaseAssets({
  releaseData, validatedArtifacts, expectedCommitSha, requireCommitInBody = false,
  allowPartial = false, repository = DEFAULT_REPOSITORY,
  downloadAsset = defaultDownloadRemoteAsset, env = process.env,
}) {
  if (!Array.isArray(releaseData?.assets)) throw new Error('Remote release is missing its assets array.');
  const expected = new Map(validatedArtifacts.map(a => [a.fileName, a]));
  const names = new Set();
  if (releaseData.assets.length > 3 || (!allowPartial && releaseData.assets.length !== 3)) {
    throw new Error('Remote release must contain exactly 3 assets (or a verified partial draft).');
  }
  for (const remote of releaseData.assets) {
    const local = expected.get(remote.name);
    if (!local || names.has(remote.name)) throw new Error('Remote release contains foreign assets or duplicate names.');
    names.add(remote.name);
    if (remote.size !== local.sizeBytes || remote.state !== 'uploaded') {
      throw new Error(`Remote asset size/state mismatch: ${remote.name}`);
    }
    let digest;
    if (typeof remote.digest === 'string' && /^sha256:[a-f0-9]{64}$/i.test(remote.digest)) {
      digest = remote.digest.slice(7).toLowerCase();
    } else {
      const directory = mkdtempSync(join(tmpdir(), 'sketchdraw-remote-asset-'));
      const destination = join(directory, 'asset.bin');
      try {
        downloadAsset({ repository, assetId: remote.id, destination, env });
        if (statSync(destination).size !== local.sizeBytes) throw new Error('Downloaded asset size mismatch.');
        digest = computeSha256(destination);
      } finally { rmSync(directory, { recursive: true, force: true }); }
    }
    if (digest !== local.sha256) throw new Error(`Remote asset SHA-256 mismatch: ${remote.name}`);
  }
  if (requireCommitInBody && !String(releaseData.body ?? '').includes(expectedCommitSha)) {
    throw new Error('Release body does not reference the expected commit.');
  }
  return true;
}

export function publishGitHubRelease({
  artifactsDir, rawTag, expectedCommitSha, repository = DEFAULT_REPOSITORY,
  rootDir = PROJECT_ROOT, minSizeBytes = DEFAULT_MIN_INSTALLER_SIZE_BYTES,
  env = process.env, runGit = defaultRunGit, runGh = defaultRunGh,
  downloadAsset = defaultDownloadRemoteAsset,
}) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error('Invalid repository.');
  const pkg = readPackageJson(rootDir);
  const tagInfo = verifyVersionAndTag({ packageVersion: pkg.version, rawTag });
  const revision = verifyGitTagRevision({ tag: tagInfo.tag, expectedCommitSha, cwd: rootDir, runGit });
  const artifacts = validateCollectedReleaseArtifacts({
    artifactsDir, version: revision.version, tag: revision.tag, commitSha: revision.commitSha, minSizeBytes,
  });
  const ownership = { repository, tag: revision.tag, commitSha: revision.commitSha, artifacts };
  const verify = (releaseData, allowPartial) => {
    verifyManagedRelease({ releaseData, ...ownership });
    verifyRemoteReleaseAssets({ releaseData, validatedArtifacts: artifacts,
      expectedCommitSha: revision.commitSha, allowPartial, repository, downloadAsset, env });
  };
  const read = () => fetchReleaseByTag({ repository, tag: revision.tag, runGh, env });
  const verifyTag = () => verifyRemoteTag({ ...ownership, runGh, env });
  const outcome = (status, release) => ({ status, tag: revision.tag, version: revision.version,
    commitSha: revision.commitSha, releaseUrl: release.html_url ?? `https://github.com/${repository}/releases/tag/${revision.tag}`,
    assets: artifacts.map(({ fileName, sizeBytes, sha256 }) => ({ fileName, sizeBytes, sha256 })) });

  verifyTag();
  let release = read();
  if (release) {
    // No writes (including notes/title edits) before ownership and every existing byte identity passes.
    verify(release, release.draft);
    if (!release.draft) return outcome('already-published-idempotent', release);
  } else {
    const directory = mkdtempSync(join(tmpdir(), 'sketchdraw-release-notes-'));
    try {
      const notes = join(directory, 'notes.md');
      writeFileSync(notes, generateReleaseNotes({ ...ownership, version: revision.version }), { mode: 0o600 });
      const args = ['release', 'create', revision.tag, '--repo', repository,
        '--verify-tag', '--draft', '--title', `${PRODUCT_NAME} ${revision.tag}`, '--notes-file', notes];
      if (revision.isPrerelease) args.push('--prerelease');
      runGh(args, { cwd: rootDir, env });
    } finally { rmSync(directory, { recursive: true, force: true }); }
    release = read();
    verify(release, true);
    if (!release.draft) throw new Error('New draft unexpectedly became public.');
  }
  const releaseId = release.id;
  for (const artifact of artifacts) {
    // Re-read before each upload: a competing release replacement or foreign asset must not be edited.
    verifyTag();
    release = read();
    verify(release, release.draft);
    if (release.id !== releaseId) throw new Error('Release identity changed during upload.');
    if (!release.draft) return outcome('already-published-idempotent', release);
    if (release.assets.some(asset => asset.name === artifact.fileName)) continue;
    // The ID-scoped API fails on a concurrent name collision. Never delete or clobber any asset.
    runGh(['api', '--method', 'POST',
      `https://uploads.github.com/repos/${repository}/releases/${releaseId}/assets?name=${encodeURIComponent(artifact.fileName)}`,
      '--header', 'Content-Type: application/octet-stream', '--input', artifact.filePath], { cwd: rootDir, env, timeoutMs: 600_000 });
  }
  verifyTag();
  release = read();
  verify(release, false);
  if (release.id !== releaseId) throw new Error('Release identity changed before publication.');
  if (!release.draft) return outcome('already-published-idempotent', release);
  runGh(['api', '--method', 'PATCH', `repos/${repository}/releases/${releaseId}`,
    '--field', 'draft=false', '--field', `prerelease=${revision.isPrerelease}`], { cwd: rootDir, env });
  const published = read();
  verify(published, false);
  if (published.id !== releaseId || published.draft) throw new Error('Publication could not be verified.');
  return outcome('published', published);
}

/**
 * Simple CLI flag parser for structured `--key value` arguments.
 */
export function parseCliArgs(argv) {
  const [subcommand, ...rest] = argv;
  const options = {};
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (!token.startsWith('--')) {
      throw new Error(`Unexpected positional argument "${token}". Use named --flags.`);
    }
    const key = token.slice(2);
    const next = rest[i + 1];
    if (next === undefined || next.startsWith('--')) {
      options[key] = 'true';
    } else {
      options[key] = next;
      i += 1;
    }
  }
  return { subcommand, options };
}

function writeGithubOutput(outputPath, keyValuePairs) {
  if (!outputPath) return;
  const lines = Object.entries(keyValuePairs).map(([k, v]) => `${k}=${v}`);
  writeFileSync(outputPath, `${lines.join('\n')}\n`, { encoding: 'utf8', flag: 'a' });
}

/**
 * CLI Entrypoint dispatcher.
 */
export function runCli(argv = process.argv.slice(2)) {
  const { subcommand, options } = parseCliArgs(argv);

  if (subcommand === 'preflight') {
    const rawTag = options.tag ?? process.env.RELEASE_TAG ?? process.env.GITHUB_REF_NAME ?? '';
    const expectedCommitSha = options.commit ?? process.env.RELEASE_COMMIT ?? null;
    const pkg = readPackageJson(PROJECT_ROOT);
    const tagInfo = verifyVersionAndTag({ packageVersion: pkg.version, rawTag });
    const verified = verifyGitTagRevision({
      tag: tagInfo.tag,
      expectedCommitSha,
      cwd: PROJECT_ROOT
    });

    writeGithubOutput(process.env.GITHUB_OUTPUT, {
      tag: verified.tag,
      version: verified.version,
      commit_sha: verified.commitSha,
      is_prerelease: String(verified.isPrerelease)
    });

    console.log(
      JSON.stringify(
        {
          ok: true,
          step: 'preflight',
          tag: verified.tag,
          version: verified.version,
          commitSha: verified.commitSha,
          isPrerelease: verified.isPrerelease
        },
        null,
        2
      )
    );
    return;
  }

  if (subcommand === 'verify-env') {
    const platformKey = options.platform ?? process.env.TARGET_PLATFORM;
    const rawTag = options.tag ?? process.env.RELEASE_TAG;
    const expectedCommitSha = options.commit ?? process.env.RELEASE_COMMIT;
    const pkg = readPackageJson(PROJECT_ROOT);
    const headCommitSha = defaultRunGit(['rev-parse', '--verify', 'HEAD'], {
      cwd: PROJECT_ROOT
    });

    const verified = verifyRunnerEnvironment({
      platformKey,
      actualPlatform: process.platform,
      actualArch: process.arch,
      headCommitSha,
      expectedCommitSha,
      packageVersion: pkg.version,
      rawTag
    });

    console.log(JSON.stringify({ ok: true, step: 'verify-env', ...verified }, null, 2));
    return;
  }

  if (subcommand === 'package') {
    const platformKey = options.platform ?? process.env.TARGET_PLATFORM;
    const rawTag = options.tag ?? process.env.RELEASE_TAG;
    const commitSha = options.commit ?? process.env.RELEASE_COMMIT;
    const stagingDir = options['staging-dir']
      ? resolve(PROJECT_ROOT, options['staging-dir'])
      : resolve(PROJECT_ROOT, 'release', 'staged', platformKey);

    const result = packagePlatformInstaller({
      platformKey,
      rawTag,
      commitSha,
      rootDir: PROJECT_ROOT,
      stagingDir
    });

    console.log(
      JSON.stringify(
        {
          ok: true,
          step: 'package',
          stagedInstallerPath: result.stagedInstallerPath,
          stagedManifestPath: result.stagedManifestPath,
          manifest: result.manifest
        },
        null,
        2
      )
    );
    return;
  }

  if (subcommand === 'validate-artifacts') {
    const artifactsDir = resolve(PROJECT_ROOT, options['artifacts-dir'] ?? 'release/collected');
    const rawTag = options.tag ?? process.env.RELEASE_TAG;
    const commitSha = options.commit ?? process.env.RELEASE_COMMIT;
    const pkg = readPackageJson(PROJECT_ROOT);
    const tagInfo = verifyVersionAndTag({ packageVersion: pkg.version, rawTag });

    const validated = validateCollectedReleaseArtifacts({
      artifactsDir,
      version: tagInfo.version,
      tag: tagInfo.tag,
      commitSha
    });

    console.log(
      JSON.stringify(
        {
          ok: true,
          step: 'validate-artifacts',
          count: validated.length,
          artifacts: validated.map((item) => ({
            platformKey: item.platformKey,
            fileName: item.fileName,
            sizeBytes: item.sizeBytes,
            sha256: item.sha256
          }))
        },
        null,
        2
      )
    );
    return;
  }

  if (subcommand === 'publish') {
    const artifactsDir = resolve(PROJECT_ROOT, options['artifacts-dir'] ?? 'release/collected');
    const rawTag = options.tag ?? process.env.RELEASE_TAG;
    const expectedCommitSha = options.commit ?? process.env.RELEASE_COMMIT;
    const repository = options.repo ?? process.env.GITHUB_REPOSITORY ?? DEFAULT_REPOSITORY;

    const result = publishGitHubRelease({
      artifactsDir,
      rawTag,
      expectedCommitSha,
      repository,
      rootDir: PROJECT_ROOT
    });

    console.log(JSON.stringify({ ok: true, step: 'publish', ...result }, null, 2));
    return;
  }

  throw new Error(
    `Unknown or missing subcommand "${subcommand ?? ''}". ` +
      `Supported subcommands: preflight, verify-env, package, validate-artifacts, publish.`
  );
}

if (process.argv[1] && resolve(process.argv[1]) === __filename) {
  try {
    runCli();
  } catch (error) {
    console.error(`[release] ERROR: ${error.message}`);
    process.exitCode = 1;
  }
}
