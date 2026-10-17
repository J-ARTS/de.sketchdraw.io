import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sandboxProfile } from '../../scripts/linux-sandbox.mjs';

test('CI sandbox profile binds one literal binary including paths with spaces', () => {
  const first = sandboxProfile('/tmp/Sketchdraw Installer/extracted/sketchdraw');
  assert.match(first, /"\/tmp\/Sketchdraw Installer\/extracted\/sketchdraw" flags=\(unconfined\)/);
  assert.match(first, /\n  userns,\n/);
  assert.notEqual(first, sandboxProfile('/tmp/Another Installer/extracted/sketchdraw'));
});

test('profile creation rejects paths that could broaden or inject a privileged rule', () => {
  for (const path of ['relative/electron', '/tmp/*/electron', '/tmp/?/electron', '/tmp/{one,two}/electron', '/tmp/[abc]/electron', '/tmp/"electron', '/tmp/electron\nuserns,', '/tmp/electron\\*']) {
    assert.throws(() => sandboxProfile(path));
  }
});
