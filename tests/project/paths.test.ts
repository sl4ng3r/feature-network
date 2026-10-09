import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { openProject } from '../../src/project/root.js';
import { resolveProjectPath } from '../../src/project/paths.js';
import { cleanup, tree } from './helpers.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(cleanup)); });
async function fresh() { const root = await tree(); roots.push(root); return root; }

// Real filesystem/Git/process integration: finite hosted-runner budget; unit defaults stay unchanged.
describe('repository integration', { timeout: 20000 }, () => {
describe('project paths', () => {
  it.each(['../outside', '/etc/passwd', 'C:\\Windows\\file', 'C:relative', '\\\\server\\share', 'src\\..\\outside', 'src/../outside', '', '.', 'src//file', 'src/./file', 'a\u0000b'])('rejects_absolute_traversal_and_external_symlinks: %s', async path => {
    const project = await openProject(await fresh());
    await expect(resolveProjectPath(project, path)).rejects.toMatchObject({ code: 'unsafe_path' });
  });

  it('rejects_external_symlinks_even_with_missing_descendants', async () => {
    const root = await fresh(); const outside = await fresh();
    await symlink(outside, join(root, 'escape'));
    const project = await openProject(root);
    await expect(resolveProjectPath(project, 'escape/missing/file')).rejects.toMatchObject({ code: 'unsafe_path' });
    await symlink(join(outside, 'missing'), join(root, 'dangling'));
    await expect(resolveProjectPath(project, 'dangling/file')).rejects.toMatchObject({ code: 'unsafe_path' });
  });

  it('handles_unicode_spaces_and_missing_reference', async () => {
    const root = await fresh(); await mkdir(join(root, 'code Ü'));
    await writeFile(join(root, 'code Ü/hello world.ts'), 'example');
    const project = await openProject(root);
    expect(await resolveProjectPath(project, 'code Ü/hello world.ts')).toBe(join(project.root, 'code Ü/hello world.ts'));
    expect(await resolveProjectPath(project, 'missing Ü/file.ts')).toBe(join(project.root, 'missing Ü/file.ts'));
    await symlink(join(root, 'code Ü'), join(root, 'alias'));
    expect(await resolveProjectPath(project, 'alias/hello world.ts')).toBe(join(project.root, 'code Ü/hello world.ts'));
  });

  it('permits_dangling_internal_symlinks_as_missing_paths', async () => {
    const root = await fresh(); const project = await openProject(root);
    await symlink(join(root, 'missing'), join(root, 'future'));
    expect(await resolveProjectPath(project, 'future/file.ts')).toBe(join(project.root, 'missing/file.ts'));
  });

  it('rejects_symlink_cycles', async () => {
    const root = await fresh(); const project = await openProject(root);
    await symlink('two', join(root, 'one')); await symlink('one', join(root, 'two'));
    await expect(resolveProjectPath(project, 'one/file.ts')).rejects.toMatchObject({ code: 'unsafe_path' });
  });

  it('rechecks_storage_symlinks_replaced_after_binding', async () => {
    const root = await fresh(); const project = await openProject(root);
    await symlink(await fresh(), join(root, 'network-spec'));
    await expect(resolveProjectPath(project, 'network-spec/_meta.yaml')).rejects.toMatchObject({ code: 'unsafe_path' });
  });
});

});
