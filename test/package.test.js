import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

test('npm package lifecycle builds the real hport bin entrypoint', () => {
  const distDir = path.join(repoRoot, 'dist');
  const packDir = mkdtempSync(path.join(tmpdir(), 'hport-pack-'));

  rmSync(distDir, { recursive: true, force: true });

  try {
    const packed = spawnSync(npmCommand, ['pack', '--silent', '--pack-destination', packDir], {
      cwd: repoRoot,
      encoding: 'utf8'
    });

    assert.equal(packed.status, 0, packed.stderr || packed.stdout);
    assert.equal(existsSync(path.join(distDir, 'index.js')), true, 'npm pack must build dist/index.js');

    const help = spawnSync(process.execPath, ['bin.js', '--help'], {
      cwd: repoRoot,
      encoding: 'utf8'
    });

    assert.equal(help.status, 0, help.stderr || help.stdout);
    assert.match(help.stdout, /Usage: hport/);

    const packageVersion = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).version;
    const version = spawnSync(process.execPath, ['bin.js', '--version'], {
      cwd: repoRoot,
      encoding: 'utf8'
    });

    assert.equal(version.status, 0, version.stderr || version.stdout);
    assert.equal(version.stdout.trim(), packageVersion);
  } finally {
    rmSync(packDir, { recursive: true, force: true });
    rmSync(distDir, { recursive: true, force: true });
  }
});
