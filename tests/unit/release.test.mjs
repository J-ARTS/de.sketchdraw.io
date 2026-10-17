import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  DEFAULT_REPOSITORY,
  FORBIDDEN_RELEASE_ASSET_PATTERNS,
  PROJECT_ROOT,
  RELEASE_TARGETS,
  computeSha256,
  generateReleaseNotes,
  inspectBinaryFile,
  isForbiddenReleaseAsset,
  packagePlatformInstaller,
  parseReleaseTag,
  publishGitHubRelease,
  resolveSigningConfiguration,
  validateCollectedReleaseArtifacts,
  verifyGitTagRevision,
  verifyInstallerBinaryHeader,
  verifyRunnerEnvironment,
  verifyUnpackedBinaryArchitecture,
  verifyVersionAndTag,
  verifyRemoteReleaseAssets,
  releaseOwnershipMarker,
  verifyBuildPrerequisites
} from '../../scripts/release.mjs';

const SAMPLE_COMMIT = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const OTHER_COMMIT = 'ffffffffffffffffffffffffffffffffffffffff';

function createPeBuffer(machine = 0x8664, totalSize = 2048) {
  const buf = Buffer.alloc(totalSize, 0);
  buf[0] = 0x4d; // 'M'
  buf[1] = 0x5a; // 'Z'
  const peOffset = 0x80;
  buf.writeUInt32LE(peOffset, 0x3c);
  buf[peOffset] = 0x50; // 'P'
  buf[peOffset + 1] = 0x45; // 'E'
  buf[peOffset + 2] = 0x00;
  buf[peOffset + 3] = 0x00;
  buf.writeUInt16LE(machine, peOffset + 4);
  return buf;
}

function createMachO64Buffer(cpuType = 0x0100000c, totalSize = 2048) {
  const buf = Buffer.alloc(totalSize, 0);
  // Little-endian MH_MAGIC_64 (0xfeedfacf -> cf fa ed fe)
  buf[0] = 0xcf;
  buf[1] = 0xfa;
  buf[2] = 0xed;
  buf[3] = 0xfe;
  buf.writeUInt32LE(cpuType, 4);
  return buf;
}

function createDmgBuffer(totalSize = 2048) {
  const buf = Buffer.alloc(totalSize, 0);
  // UDIF "koly" trailer at last 512 bytes
  const trailerOffset = totalSize - 512;
  buf.write('koly', trailerOffset, 'ascii');
  return buf;
}

function createElf64Buffer(machine = 0x003e, totalSize = 2048) {
  const buf = Buffer.alloc(totalSize, 0);
  buf[0] = 0x7f;
  buf[1] = 0x45; // 'E'
  buf[2] = 0x4c; // 'L'
  buf[3] = 0x46; // 'F'
  buf[4] = 2; // ELFCLASS64
  buf[5] = 1; // ELFDATA2LSB (little-endian)
  buf.writeUInt16LE(machine, 18);
  return buf;
}

function createDebBuffer(totalSize = 2048) {
  const buf = Buffer.alloc(totalSize, 0);
  buf.write('!<arch>\n', 0, 'ascii');
  buf.write('debian-binary   ', 8, 'ascii');
  return buf;
}

function createSyntheticProjectRoot(baseDir, version = '0.1.0') {
  mkdirSync(join(baseDir, 'dist'), { recursive: true });
  mkdirSync(join(baseDir, 'dist-electron'), { recursive: true });
  mkdirSync(join(baseDir, 'dist-mcp'), { recursive: true });
  writeFileSync(
    join(baseDir, 'package.json'),
    JSON.stringify({ name: 'de.sketchdraw.io', version, main: 'dist-electron/main.cjs' }, null, 2)
  );
  writeFileSync(join(baseDir, 'electron-builder.json'), '{}');
  writeFileSync(join(baseDir, 'dist', 'index.html'), '<!doctype html><html></html>');
  writeFileSync(join(baseDir, 'dist-electron', 'main.cjs'), 'module.exports = {};');
  writeFileSync(join(baseDir, 'dist-electron', 'preload.cjs'), 'module.exports = {};');
  writeFileSync(join(baseDir, 'dist-mcp', 'server.cjs'), 'module.exports = {};');
}

function stageAllThreePlatforms(tempRoot, { version = '0.1.0', tag = 'v0.1.0', commitSha = SAMPLE_COMMIT } = {}) {
  createSyntheticProjectRoot(tempRoot, version);
  const collectedDir = join(tempRoot, 'collected');
  mkdirSync(collectedDir, { recursive: true });

  const platformFixtures = [
    {
      platformKey: 'win',
      actualPlatform: 'win32',
      actualArch: 'x64',
      unpackedRelPath: 'win-unpacked/Sketchdraw.exe',
      unpackedBytes: createPeBuffer(0x8664, 4096),
      installerBytes: createPeBuffer(0x014c, 8192)
    },
    {
      platformKey: 'mac',
      actualPlatform: 'darwin',
      actualArch: 'arm64',
      unpackedRelPath: 'mac-arm64/Sketchdraw.app/Contents/MacOS/Sketchdraw',
      unpackedBytes: createMachO64Buffer(0x0100000c, 4096),
      installerBytes: createDmgBuffer(8192)
    },
    {
      platformKey: 'linux',
      actualPlatform: 'linux',
      actualArch: 'x64',
      unpackedRelPath: 'linux-unpacked/de.sketchdraw.io',
      unpackedBytes: createElf64Buffer(0x003e, 4096),
      installerBytes: createDebBuffer(8192)
    }
  ];

  for (const fixture of platformFixtures) {
    const releaseDir = join(tempRoot, `release-${fixture.platformKey}`);
    const stagingDir = join(collectedDir, fixture.platformKey);
    const assetName = RELEASE_TARGETS[fixture.platformKey].expectedAssetName(version);

    packagePlatformInstaller({
      platformKey: fixture.platformKey,
      rawTag: tag,
      commitSha,
      rootDir: tempRoot,
      releaseDir,
      stagingDir,
      minSizeBytes: 1024,
      env: {},
      actualPlatform: fixture.actualPlatform,
      actualArch: fixture.actualArch,
      // Unit fixture only: real installer smoke is exercised on each native release runner.
      runInstallerSmoke({ installerPath }) {
        return { schemaVersion: 1, passed: true, source: 'installer-extracted',
          platformKey: fixture.platformKey, version, commitSha, installerSha256: computeSha256(installerPath),
          appIsPackaged: true, appVersion: version, appArch: fixture.actualArch, sandbox: true,
          bundleHashes: Object.fromEntries(['dist/index.html', 'dist-electron/main.cjs', 'dist-electron/preload.cjs', 'dist-mcp/server.cjs'].map(file => [file, computeSha256(join(tempRoot,file))])),
          mcp: { initialized: true, deniedWithoutGrant: true, tools: ['sketchdraw_read_document', 'sketchdraw_find_elements', 'sketchdraw_analyze_document', 'sketchdraw_apply_commands', 'sketchdraw_read_code', 'sketchdraw_apply_code'] } };
      },
      runElectronBuilder() {
        const unpackedFull = join(releaseDir, fixture.unpackedRelPath);
        mkdirSync(resolve(unpackedFull, '..'), { recursive: true });
        writeFileSync(unpackedFull, fixture.unpackedBytes);
        writeFileSync(join(releaseDir, assetName), fixture.installerBytes);
        // Also simulate extra electron-builder files in releaseDir that must NOT be staged
        writeFileSync(join(releaseDir, `${assetName}.blockmap`), 'blockmap-data');
        writeFileSync(join(releaseDir, 'builder-debug.yml'), 'debug: true');
        writeFileSync(join(releaseDir, 'latest.yml'), 'version: 0.1.0');
      }
    });
  }

  return collectedDir;
}

test('electron-builder.json configures exact targets, deterministic artifact names, and disables auto-publish', () => {
  const configPath = resolve(PROJECT_ROOT, 'electron-builder.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));

  assert.equal(config.appId, 'io.sketchdraw.de');
  assert.equal(config.productName, 'Sketchdraw');
  assert.equal(config.publish, null);
  assert.ok(config.files.includes('dist-mcp/**/*'));
  assert.equal(config.directories?.output, 'release');

  // Windows x64 NSIS .exe
  assert.deepEqual(config.win?.target, [{ target: 'nsis', arch: ['x64'] }]);
  assert.equal(config.nsis?.artifactName, '${productName}-${version}-windows-${arch}.${ext}');
  assert.equal(config.nsis?.differentialPackage, false);

  // macOS arm64 .dmg
  assert.deepEqual(config.mac?.target, [{ target: 'dmg', arch: ['arm64'] }]);
  assert.equal(config.dmg?.artifactName, '${productName}-${version}-macos-${arch}.${ext}');
  assert.equal(config.dmg?.writeUpdateInfo, false);
  assert.equal(config.dmg?.sign, false);

  // Linux x64 .deb (explicit -linux-x64.${ext} so electron-builder does not emit -amd64.deb)
  assert.deepEqual(config.linux?.target, [{ target: 'deb', arch: ['x64'] }]);
  assert.equal(config.deb?.artifactName, '${productName}-${version}-linux-x64.${ext}');
  assert.equal(config.linux?.maintainer, 'J-ARTS');
  assert.equal(config.extraMetadata?.homepage, 'https://github.com/J-ARTS/de.sketchdraw.io');
});

test('parseReleaseTag and verifyVersionAndTag validate strict v<package.version> tags', () => {
  const parsed = parseReleaseTag('v0.1.0');
  assert.deepEqual(parsed, {
    tag: 'v0.1.0',
    version: '0.1.0',
    prerelease: null,
    isPrerelease: false
  });

  const parsedRef = parseReleaseTag('refs/tags/v1.2.3-beta.1');
  assert.deepEqual(parsedRef, {
    tag: 'v1.2.3-beta.1',
    version: '1.2.3-beta.1',
    prerelease: 'beta.1',
    isPrerelease: true
  });

  assert.throws(() => parseReleaseTag('0.1.0'), /Invalid release tag/);
  assert.throws(() => parseReleaseTag('v01.1.0'), /Invalid release tag/);
  assert.throws(() => parseReleaseTag('v0.1.0+build123'), /Invalid release tag/);

  const verified = verifyVersionAndTag({ packageVersion: '0.1.0', rawTag: 'v0.1.0' });
  assert.equal(verified.tag, 'v0.1.0');
  assert.equal(verified.version, '0.1.0');

  assert.throws(
    () => verifyVersionAndTag({ packageVersion: '0.1.0', rawTag: 'v0.2.0' }),
    /Tag version mismatch/
  );
});

test('verifyGitTagRevision enforces tag existence, HEAD match, and prevents tag re-pointing', () => {
  const verified = verifyGitTagRevision({
    tag: 'v0.1.0',
    expectedCommitSha: SAMPLE_COMMIT,
    runGit(args) {
      if (args[2] === 'refs/tags/v0.1.0^{commit}') return SAMPLE_COMMIT;
      if (args[2] === 'HEAD') return SAMPLE_COMMIT;
      throw new Error(`Unexpected git args: ${args.join(' ')}`);
    }
  });
  assert.equal(verified.commitSha, SAMPLE_COMMIT);

  // Fails when HEAD differs from tag commit
  assert.throws(
    () =>
      verifyGitTagRevision({
        tag: 'v0.1.0',
        runGit(args) {
          if (args[2] === 'refs/tags/v0.1.0^{commit}') return SAMPLE_COMMIT;
          return OTHER_COMMIT;
        }
      }),
    /Revision mismatch/
  );

  // Fails when tag was moved to a commit different from expectedCommitSha
  assert.throws(
    () =>
      verifyGitTagRevision({
        tag: 'v0.1.0',
        expectedCommitSha: OTHER_COMMIT,
        runGit() {
          return SAMPLE_COMMIT;
        }
      }),
    /Tag integrity violation/
  );
});

test('verifyRunnerEnvironment enforces exact OS, process.arch (including arm64 on macOS), and commit SHA', () => {
  const macEnv = verifyRunnerEnvironment({
    platformKey: 'mac',
    actualPlatform: 'darwin',
    actualArch: 'arm64',
    headCommitSha: SAMPLE_COMMIT,
    expectedCommitSha: SAMPLE_COMMIT,
    packageVersion: '0.1.0',
    rawTag: 'v0.1.0'
  });
  assert.equal(macEnv.expectedAssetName, 'Sketchdraw-0.1.0-macos-arm64.dmg');

  // Reject Intel x64 runner when building macOS arm64 target
  assert.throws(
    () =>
      verifyRunnerEnvironment({
        platformKey: 'mac',
        actualPlatform: 'darwin',
        actualArch: 'x64',
        headCommitSha: SAMPLE_COMMIT,
        expectedCommitSha: SAMPLE_COMMIT,
        packageVersion: '0.1.0',
        rawTag: 'v0.1.0'
      }),
    /Runner architecture mismatch for target "mac"/
  );

  // Reject wrong OS
  assert.throws(
    () =>
      verifyRunnerEnvironment({
        platformKey: 'win',
        actualPlatform: 'linux',
        actualArch: 'x64',
        headCommitSha: SAMPLE_COMMIT,
        expectedCommitSha: SAMPLE_COMMIT,
        packageVersion: '0.1.0',
        rawTag: 'v0.1.0'
      }),
    /Runner OS mismatch/
  );
});

test('resolveSigningConfiguration uses honest ad-hoc/unsigned defaults and enables signing/notarization only when secrets exist', () => {
  const macUnsigned = resolveSigningConfiguration('mac', {});
  assert.equal(macUnsigned.mode, 'adhoc-unsigned');
  assert.equal(macUnsigned.signed, false);
  assert.equal(macUnsigned.notarized, false);
  assert.ok(macUnsigned.extraCliArgs.includes('-c.mac.identity=-'));
  assert.ok(macUnsigned.extraCliArgs.includes('-c.mac.notarize=false'));
  assert.equal(macUnsigned.envOverrides.CSC_IDENTITY_AUTO_DISCOVERY, 'false');

  const macSignedOnly = resolveSigningConfiguration('mac', {
    CSC_LINK: 'base64-cert-placeholder'
  });
  assert.equal(macSignedOnly.mode, 'developer-id-signed');
  assert.equal(macSignedOnly.signed, true);
  assert.equal(macSignedOnly.notarized, false);

  const macNotarized = resolveSigningConfiguration('mac', {
    CSC_LINK: 'base64-cert-placeholder',
    APPLE_API_KEY: 'key',
    APPLE_API_KEY_ID: 'key-id',
    APPLE_API_ISSUER: 'issuer-id'
  });
  assert.equal(macNotarized.mode, 'developer-id-notarized');
  assert.equal(macNotarized.signed, true);
  assert.equal(macNotarized.notarized, true);
  assert.ok(macNotarized.extraCliArgs.includes('-c.mac.notarize=true'));

  const winUnsigned = resolveSigningConfiguration('win', {});
  assert.equal(winUnsigned.mode, 'unsigned');
  assert.equal(winUnsigned.signed, false);

  const winSigned = resolveSigningConfiguration('win', { WIN_CSC_LINK: 'cert' });
  assert.equal(winSigned.mode, 'authenticode-signed');
  assert.equal(winSigned.signed, true);
});

function captureBuilderSettings(t, platformKey, env) {
  const root = mkdtempSync(join(tmpdir(), 'release-signing-env-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  createSyntheticProjectRoot(root);
  const before = { ...env };
  const stopAtBuilder = new Error('Signing environment captured; no native packaging in this unit test.');
  let captured;
  assert.throws(() => packagePlatformInstaller({
    platformKey, rawTag: 'v0.1.0', commitSha: SAMPLE_COMMIT, rootDir: root, env,
    actualPlatform: RELEASE_TARGETS[platformKey].nodePlatform,
    actualArch: RELEASE_TARGETS[platformKey].arch,
    runElectronBuilder(args, options) {
      captured = { args, env: options.env };
      throw stopAtBuilder;
    },
    runInstallerSmoke() { assert.fail('A failed builder must never reach installer smoke.'); },
  }), error => error === stopAtBuilder);
  assert.deepEqual(env, before, 'Caller environment must remain unchanged');
  return captured;
}

const EMPTY_ACTIONS_SIGNING_SECRETS = Object.freeze({
  CSC_LINK: '', CSC_KEY_PASSWORD: '', CSC_NAME: '',
  WIN_CSC_LINK: '', WIN_CSC_KEY_PASSWORD: '',
  APPLE_API_KEY: '', APPLE_API_KEY_ID: '', APPLE_API_ISSUER: '',
  APPLE_ID: '', APPLE_APP_SPECIFIC_PASSWORD: '', APPLE_TEAM_ID: '',
});

for (const platformKey of ['mac', 'win']) {
  test(`package ${platformKey}: unset GitHub Actions secrets never become empty certificate paths`, t => {
    const input = { ...EMPTY_ACTIONS_SIGNING_SECRETS, PATH: '/synthetic/toolchain', UNRELATED_EMPTY: '',
      CSC_INSTALLER_LINK: '  ', CSC_INSTALLER_KEY_PASSWORD: '', CSC_KEYCHAIN: '',
      APPLE_KEYCHAIN: '', APPLE_KEYCHAIN_PROFILE: '\t', CSC_IDENTITY_AUTO_DISCOVERY: '' };
    assert.deepEqual(resolveSigningConfiguration(platformKey, input), resolveSigningConfiguration(platformKey, {}));
    const captured = captureBuilderSettings(t, platformKey, input);
    for (const key of Object.keys(input).filter(key => /^(CSC_|WIN_CSC_|APPLE_)/.test(key))) {
      if (key === 'CSC_IDENTITY_AUTO_DISCOVERY') continue;
      assert.equal(Object.hasOwn(captured.env, key), false, `${key} must be absent, not empty`);
    }
    assert.equal(captured.env.CSC_IDENTITY_AUTO_DISCOVERY, 'false');
    assert.equal(captured.env.PATH, input.PATH);
    assert.equal(captured.env.UNRELATED_EMPTY, '');
    if (platformKey === 'mac') {
      assert.ok(captured.args.includes('-c.mac.identity=-'));
      assert.ok(captured.args.includes('-c.mac.notarize=false'));
    }
  });
}

test('package mac: complete signing and notarization values reach the builder unchanged', t => {
  const input = { ...EMPTY_ACTIONS_SIGNING_SECRETS,
    CSC_LINK: '/synthetic/certificate.p12', CSC_KEY_PASSWORD: ' password with spaces ',
    APPLE_API_KEY: '/synthetic/AuthKey.p8', APPLE_API_KEY_ID: 'key-id', APPLE_API_ISSUER: 'issuer-id' };
  const captured = captureBuilderSettings(t, 'mac', input);
  for (const key of ['CSC_LINK', 'CSC_KEY_PASSWORD', 'APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER']) {
    assert.equal(captured.env[key], input[key]);
  }
  assert.ok(captured.args.includes('-c.mac.notarize=true'));
  assert.equal(Object.hasOwn(captured.env, 'APPLE_ID'), false);
  assert.equal(Object.hasOwn(captured.env, 'WIN_CSC_LINK'), false);
});

test('package win: blank Windows certificate option does not mask the real generic certificate', t => {
  const input = { ...EMPTY_ACTIONS_SIGNING_SECRETS, CSC_LINK: '/synthetic/windows.p12', CSC_KEY_PASSWORD: 'real-password' };
  const captured = captureBuilderSettings(t, 'win', input);
  assert.equal(captured.env.CSC_LINK, input.CSC_LINK);
  assert.equal(captured.env.CSC_KEY_PASSWORD, input.CSC_KEY_PASSWORD);
  assert.equal(Object.hasOwn(captured.env, 'WIN_CSC_LINK'), false);
  assert.equal(Object.hasOwn(captured.env, 'WIN_CSC_KEY_PASSWORD'), false);
  assert.equal(resolveSigningConfiguration('win', captured.env).mode, 'authenticode-signed');
});

test('package win: explicit empty password overrides the generic password when the Windows link is absent', t => {
  const input = { CSC_LINK: '/synthetic/passwordless.p12', CSC_KEY_PASSWORD: 'wrong-global-password',
    WIN_CSC_KEY_PASSWORD: '' };
  const captured = captureBuilderSettings(t, 'win', input);
  assert.equal(Object.hasOwn(captured.env, 'WIN_CSC_LINK'), false);
  assert.equal(Object.hasOwn(captured.env, 'WIN_CSC_KEY_PASSWORD'), true);
  assert.equal(captured.env.WIN_CSC_KEY_PASSWORD, '');
  assert.equal(captured.env.CSC_LINK, input.CSC_LINK);
  assert.equal(captured.env.CSC_KEY_PASSWORD, input.CSC_KEY_PASSWORD);
  assert.equal(resolveSigningConfiguration('win', captured.env).mode, 'authenticode-signed');
});

test('package signing preserves deliberately empty certificate passwords and builder failures', t => {
  for (const [platformKey, input, passwordKey] of [
    ['mac', { CSC_LINK: '/synthetic/passwordless.p12', CSC_KEY_PASSWORD: '' }, 'CSC_KEY_PASSWORD'],
    ['win', { WIN_CSC_LINK: '/synthetic/passwordless.p12', WIN_CSC_KEY_PASSWORD: '', CSC_KEY_PASSWORD: 'wrong-global-password' }, 'WIN_CSC_KEY_PASSWORD'],
    ['mac', { CSC_LINK: '/synthetic/app.p12', CSC_INSTALLER_LINK: '/synthetic/installer.p12', CSC_INSTALLER_KEY_PASSWORD: '' }, 'CSC_INSTALLER_KEY_PASSWORD'],
  ]) {
    const captured = captureBuilderSettings(t, platformKey, input);
    assert.equal(Object.hasOwn(captured.env, passwordKey), true);
    assert.equal(captured.env[passwordKey], '');
    for (const [key, value] of Object.entries(input)) assert.equal(captured.env[key], value);
  }
});

test('package mac: partial notarization retains the existing explicit non-notarized mode', t => {
  const input = { ...EMPTY_ACTIONS_SIGNING_SECRETS, CSC_LINK: '/synthetic/app.p12', APPLE_API_KEY: '/synthetic/key.p8' };
  const captured = captureBuilderSettings(t, 'mac', input);
  assert.equal(captured.env.APPLE_API_KEY, input.APPLE_API_KEY);
  assert.equal(Object.hasOwn(captured.env, 'APPLE_API_KEY_ID'), false);
  assert.ok(captured.args.includes('-c.mac.notarize=false'));
  assert.equal(resolveSigningConfiguration('mac', captured.env).mode, 'developer-id-signed');
});

test('inspectBinaryFile and binary architecture verifiers validate PE, Mach-O arm64, UDIF DMG, ELF64, and Debian .deb', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'sketchdraw-bin-test-'));
  try {
    const winExe = join(tempDir, 'win-unpacked', 'Sketchdraw.exe');
    mkdirSync(join(tempDir, 'win-unpacked'), { recursive: true });
    writeFileSync(winExe, createPeBuffer(0x8664));

    const macBin = join(tempDir, 'mac-arm64', 'Sketchdraw.app', 'Contents', 'MacOS', 'Sketchdraw');
    mkdirSync(resolve(macBin, '..'), { recursive: true });
    writeFileSync(macBin, createMachO64Buffer(0x0100000c));

    const linuxBin = join(tempDir, 'linux-unpacked', 'de.sketchdraw.io');
    mkdirSync(join(tempDir, 'linux-unpacked'), { recursive: true });
    writeFileSync(linuxBin, createElf64Buffer(0x003e));

    assert.equal(
      verifyUnpackedBinaryArchitecture({ platformKey: 'win', releaseDir: tempDir }).arch,
      'x64'
    );
    assert.equal(
      verifyUnpackedBinaryArchitecture({ platformKey: 'mac', releaseDir: tempDir }).arch,
      'arm64'
    );
    assert.equal(
      verifyUnpackedBinaryArchitecture({ platformKey: 'linux', releaseDir: tempDir }).arch,
      'x64'
    );

    // Overwrite macOS binary with x86_64 Mach-O and ensure arm64 check rejects it
    writeFileSync(macBin, createMachO64Buffer(0x01000007));
    assert.throws(
      () => verifyUnpackedBinaryArchitecture({ platformKey: 'mac', releaseDir: tempDir }),
      /macOS unpacked binary architecture mismatch/
    );

    const dmgPath = join(tempDir, 'Sketchdraw-0.1.0-macos-arm64.dmg');
    writeFileSync(dmgPath, createDmgBuffer(2048));
    assert.equal(
      verifyInstallerBinaryHeader({ platformKey: 'mac', installerPath: dmgPath }).format,
      'dmg'
    );

    const debPath = join(tempDir, 'Sketchdraw-0.1.0-linux-x64.deb');
    writeFileSync(debPath, createDebBuffer(2048));
    assert.equal(
      verifyInstallerBinaryHeader({ platformKey: 'linux', installerPath: debPath }).format,
      'deb'
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('validateCollectedReleaseArtifacts accepts valid 3-platform bundle and rejects forbidden files, tampering, or commit mismatch', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'sketchdraw-stage-test-'));
  try {
    const collectedDir = stageAllThreePlatforms(tempRoot);

    const validated = validateCollectedReleaseArtifacts({
      artifactsDir: collectedDir,
      version: '0.1.0',
      tag: 'v0.1.0',
      commitSha: SAMPLE_COMMIT,
      minSizeBytes: 1024
    });

    assert.equal(validated.length, 3);
    assert.deepEqual(
      validated.map((item) => item.fileName),
      [
        'Sketchdraw-0.1.0-windows-x64.exe',
        'Sketchdraw-0.1.0-macos-arm64.dmg',
        'Sketchdraw-0.1.0-linux-x64.deb'
      ]
    );

    // 1. Forbidden blockmap / updater YAML in collected directory must fail validation
    const strayBlockmap = join(collectedDir, 'win', 'Sketchdraw-0.1.0-windows-x64.exe.blockmap');
    writeFileSync(strayBlockmap, 'forbidden');
    assert.throws(
      () =>
        validateCollectedReleaseArtifacts({
          artifactsDir: collectedDir,
          version: '0.1.0',
          tag: 'v0.1.0',
          commitSha: SAMPLE_COMMIT,
          minSizeBytes: 1024
        }),
      /Forbidden build or updater artifacts detected/
    );
    rmSync(strayBlockmap);

    // 2. Corrupted installer content (SHA-256 mismatch) must fail validation
    const debPath = join(collectedDir, 'linux', 'Sketchdraw-0.1.0-linux-x64.deb');
    const originalDeb = readFileSync(debPath);
    const tamperedDeb = Buffer.from(originalDeb);
    tamperedDeb[tamperedDeb.length - 1] ^= 0xff;
    writeFileSync(debPath, tamperedDeb);

    assert.throws(
      () =>
        validateCollectedReleaseArtifacts({
          artifactsDir: collectedDir,
          version: '0.1.0',
          tag: 'v0.1.0',
          commitSha: SAMPLE_COMMIT,
          minSizeBytes: 1024
        }),
      /SHA-256 checksum mismatch/
    );
    writeFileSync(debPath, originalDeb);

    // 3. Commit SHA mismatch across artifacts must fail validation
    assert.throws(
      () =>
        validateCollectedReleaseArtifacts({
          artifactsDir: collectedDir,
          version: '0.1.0',
          tag: 'v0.1.0',
          commitSha: OTHER_COMMIT,
          minSizeBytes: 1024
        }),
      /Manifest commit mismatch/
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

function publishFixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'sketchdraw-release-retry-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const artifactsDir = stageAllThreePlatforms(root);
  const artifacts = validateCollectedReleaseArtifacts({ artifactsDir, version: '0.1.0', tag: 'v0.1.0', commitSha: SAMPLE_COMMIT, minSizeBytes: 1024 });
  const ownership = { repository: DEFAULT_REPOSITORY, tag: 'v0.1.0', commitSha: SAMPLE_COMMIT, artifacts };
  const state = { release: null, mutations: [], uploads: [], failAfterFirstUpload: false, remoteCommit: SAMPLE_COMMIT };
  const remoteAsset = artifact => ({ id: artifacts.indexOf(artifact) + 1, name: artifact.fileName,
    size: artifact.sizeBytes, state: 'uploaded', digest: `sha256:${artifact.sha256}` });
  const makeRelease = (draft = true, assets = []) => ({ id: 42, tag_name: 'v0.1.0', draft,
    author: { login: 'github-actions[bot]', type: 'Bot' }, body: releaseOwnershipMarker(ownership), assets });
  const runGh = args => {
    if (args[0] === 'api' && args[1].includes('/git/ref/')) return JSON.stringify({ object: { type: 'commit', sha: state.remoteCommit } });
    if (args[0] === 'api' && args[1].includes('/releases/tags/')) {
      if (!state.release) throw new Error('HTTP 404: Not Found');
      return JSON.stringify(state.release);
    }
    state.mutations.push(args);
    assert.ok(!args.includes('--clobber'));
    assert.ok(!args.includes('delete'));
    if (args[0] === 'release' && args[1] === 'create') {
      state.release = makeRelease();
      state.release.body = readFileSync(args[args.indexOf('--notes-file') + 1], 'utf8');
      return '';
    }
    if (args[0] === 'api' && args[2] === 'POST') {
      assert.ok(args[3].includes('/releases/42/assets?name='));
      const name = new URL(args[3]).searchParams.get('name');
      assert.ok(!state.release.assets.some(a => a.name === name), 'Never overwrite a remote name');
      state.release.assets.push(remoteAsset(artifacts.find(a => a.fileName === name)));
      state.uploads.push(name);
      if (state.failAfterFirstUpload) { state.failAfterFirstUpload = false; throw new Error('Response lost after upload'); }
      return '';
    }
    if (args[0] === 'api' && args[2] === 'PATCH') {
      assert.equal(state.release.assets.length, 3);
      assert.equal(args[3], `repos/${DEFAULT_REPOSITORY}/releases/42`);
      state.release.draft = false;
      return '';
    }
    throw new Error(`Unexpected gh operation: ${args.join(' ')}`);
  };
  const publish = (overrides = {}) => publishGitHubRelease({ artifactsDir, rawTag: 'v0.1.0', expectedCommitSha: SAMPLE_COMMIT,
    rootDir: root, minSizeBytes: 1024, env: {}, runGit: () => SAMPLE_COMMIT, runGh, ...overrides });
  return { root, artifactsDir, artifacts, ownership, state, makeRelease, remoteAsset, publish };
}

test('publishes a verified draft once; repeat is read-only and partial upload retry preserves existing bytes', t => {
  const f = publishFixture(t);
  f.state.failAfterFirstUpload = true;
  assert.throws(() => f.publish(), /Response lost/);
  assert.equal(f.state.release.draft, true);
  assert.equal(f.state.release.assets.length, 1);
  assert.equal(f.publish().status, 'published');
  assert.equal(f.state.uploads.length, 3, 'Exactly three uploads across both attempts');
  const writes = f.state.mutations.length;
  assert.equal(f.publish().status, 'already-published-idempotent');
  assert.equal(f.state.mutations.length, writes);
});

test('foreign draft, wrong revision, same-name different bytes and moved tag abort before any mutation', t => {
  const f = publishFixture(t);
  const cases = [
    release => { release.author = { login: 'human', type: 'User' }; },
    release => { release.body = 'manual foreign draft'; },
    release => { release.body = release.body.replace(SAMPLE_COMMIT, OTHER_COMMIT); },
    release => { release.assets[0].digest = `sha256:${'f'.repeat(64)}`; },
    release => { release.assets[0].state = 'starter'; },
    release => { release.assets.push({ name: 'manual.pdf' }); },
  ];
  for (const corrupt of cases) {
    f.state.release = f.makeRelease(true, f.artifacts.map(f.remoteAsset));
    corrupt(f.state.release);
    assert.throws(() => f.publish());
    assert.equal(f.state.mutations.length, 0);
  }
  f.state.release = f.makeRelease();
  f.state.remoteCommit = OTHER_COMMIT;
  assert.throws(() => f.publish(), /Remote tag revision changed/);
  assert.equal(f.state.mutations.length, 0);
});

test('missing remote digest hashes real downloaded bytes; equal-size corruption or download failure refuses identity', t => {
  const f = publishFixture(t);
  const releaseData = f.makeRelease(false, f.artifacts.map(f.remoteAsset));
  for (const asset of releaseData.assets) delete asset.digest;
  let downloads = 0;
  const verify = downloadAsset => verifyRemoteReleaseAssets({ releaseData, validatedArtifacts: f.artifacts,
    expectedCommitSha: SAMPLE_COMMIT, repository: DEFAULT_REPOSITORY, downloadAsset });
  assert.equal(verify(({ assetId, destination }) => {
    downloads++;
    writeFileSync(destination, readFileSync(f.artifacts[assetId - 1].filePath));
  }), true);
  assert.equal(downloads, 3);
  assert.throws(() => verify(({ assetId, destination }) => {
    const bytes = readFileSync(f.artifacts[assetId - 1].filePath); bytes[bytes.length - 1] ^= 1;
    writeFileSync(destination, bytes);
  }), /SHA-256 mismatch/);
  assert.throws(() => verify(() => { throw new Error('Download interrupted'); }), /Download interrupted/);
});

test('remote release replacement between verification and upload cannot modify the replacement', t => {
  const f = publishFixture(t);
  f.state.release = f.makeRelease();
  let reads = 0;
  const runGh = args => {
    if (args[0] !== 'api' || args[1] === '--method') throw new Error('MUTATION ATTEMPT');
    if (args[1].includes('/git/ref/')) return JSON.stringify({ object: { type: 'commit', sha: SAMPLE_COMMIT } });
    reads++;
    return JSON.stringify({ ...f.state.release, id: reads > 1 ? 99 : 42 });
  };
  assert.throws(() => f.publish({ runGh }), /Release identity changed/);
});

test('missing MCP build and missing or unrelated installer smoke stop the release gate', t => {
  const f = publishFixture(t);
  rmSync(join(f.root, 'dist-mcp/server.cjs'));
  assert.throws(() => verifyBuildPrerequisites(f.root), /dist-mcp\/server.cjs/);
  const manifestPath = join(f.artifactsDir, 'mac', 'Sketchdraw-0.1.0-macos-arm64.dmg.manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  for (const corrupt of [m => { delete m.smokeVerification; }, m => { m.smokeVerification.installerSha256 = 'f'.repeat(64); }, m => { m.smokeVerification.mcp.initialized = false; }, m => { m.smokeVerification.mcp.deniedWithoutGrant = false; }]) {
    const copy = structuredClone(manifest); corrupt(copy); writeFileSync(manifestPath, JSON.stringify(copy));
    assert.throws(() => validateCollectedReleaseArtifacts({ artifactsDir: f.artifactsDir,
      version: '0.1.0', tag: 'v0.1.0', commitSha: SAMPLE_COMMIT, minSizeBytes: 1024 }), /smoke evidence/);
  }
});

test('failed real smoke prevents creating a staged installer', t => {
  const root = mkdtempSync(join(tmpdir(), 'release-smoke-gate-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  createSyntheticProjectRoot(root);
  const releaseDir = join(root, 'release');
  assert.throws(() => packagePlatformInstaller({ platformKey: 'win', rawTag: 'v0.1.0', commitSha: SAMPLE_COMMIT,
    rootDir: root, releaseDir, actualPlatform: 'win32', actualArch: 'x64', minSizeBytes: 1024, env: {},
    runElectronBuilder() {
      mkdirSync(join(releaseDir, 'win-unpacked'), { recursive: true });
      writeFileSync(join(releaseDir, 'win-unpacked/Sketchdraw.exe'), createPeBuffer());
      writeFileSync(join(releaseDir, 'Sketchdraw-0.1.0-windows-x64.exe'), createPeBuffer());
    }, runInstallerSmoke() { throw new Error('Real extracted executable failed to start'); }
  }), /failed to start/);
  assert.equal(existsSync(join(releaseDir, 'staged/win')), false);
});

test('generateReleaseNotes includes all 3 direct download links and SHA-256 checksums without extra checksum files', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'sketchdraw-notes-test-'));
  try {
    const collectedDir = stageAllThreePlatforms(tempRoot);
    const validated = validateCollectedReleaseArtifacts({
      artifactsDir: collectedDir,
      version: '0.1.0',
      tag: 'v0.1.0',
      commitSha: SAMPLE_COMMIT,
      minSizeBytes: 1024
    });

    const notes = generateReleaseNotes({
      version: '0.1.0',
      tag: 'v0.1.0',
      commitSha: SAMPLE_COMMIT,
      repository: DEFAULT_REPOSITORY,
      artifacts: validated
    });

    for (const item of validated) {
      assert.ok(
        notes.includes(
          `https://github.com/J-ARTS/de.sketchdraw.io/releases/download/v0.1.0/${item.fileName}`
        ),
        `Release notes missing download URL for ${item.fileName}`
      );
      assert.ok(
        notes.includes(`${item.sha256}  ${item.fileName}`),
        `Release notes missing SHA-256 entry for ${item.fileName}`
      );
    }

    assert.ok(isForbiddenReleaseAsset('SHA256SUMS.txt') || isForbiddenReleaseAsset('checksums.txt'));
    assert.ok(isForbiddenReleaseAsset('Sketchdraw-0.1.0-windows-x64.exe.blockmap'));
    assert.ok(isForbiddenReleaseAsset('latest-mac.yml'));
    assert.ok(isForbiddenReleaseAsset('builder-debug.yml'));
    assert.equal(FORBIDDEN_RELEASE_ASSET_PATTERNS.length > 5, true);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('CI and Release workflow files preserve all existing tests and enforce release security constraints', () => {
  const ciYaml = readFileSync(resolve(PROJECT_ROOT, '.github/workflows/ci.yml'), 'utf8');
  const releaseYaml = readFileSync(resolve(PROJECT_ROOT, '.github/workflows/release.yml'), 'utf8');

  // CI workflow preserves all required test suites and supports workflow_call
  assert.ok(ciYaml.includes('workflow_call:'));
  assert.ok(ciYaml.includes('npm run typecheck:config'));
  assert.ok(ciYaml.includes('npm run typecheck'));
  assert.ok(ciYaml.includes('node --test tests/unit/*.test.mjs'));
  assert.ok(ciYaml.includes('npm run test:unit'));
  assert.ok(ciYaml.includes('npm run build'));
  assert.ok(ciYaml.includes('npm run test:ui'));
  assert.ok(ciYaml.includes('npm run test:electron'));

  // Release workflow uses explicit runner labels, Node 22.16.0, least-privilege permissions, and no wildcard release/** uploads
  assert.ok(releaseYaml.includes('windows-2025'));
  assert.ok(releaseYaml.includes('macos-15'));
  assert.ok(releaseYaml.includes('ubuntu-24.04'));
  assert.ok(releaseYaml.includes("NODE_VERSION: '22.16.0'"));
  assert.ok(releaseYaml.includes('contents: write'));
  assert.equal(releaseYaml.includes('release/**'), false);
  assert.ok(!/run:.*\$(?:TARGET_PLATFORM|RELEASE_TAG|RELEASE_COMMIT)/.test(releaseYaml));
  assert.ok(releaseYaml.includes('xvfb-run'));
  assert.ok(releaseYaml.includes('smoke-${{ matrix.platform }}'));
});
