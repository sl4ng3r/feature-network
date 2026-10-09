import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, realpath, symlink, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { openProject, discoverHookProject } from '../../src/project/root.js';
import { cleanup, marker, repo, tree } from './helpers.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(cleanup)); });
async function fresh() { const root = await tree(); roots.push(root); return root; }

describe('project binding', () => {
  it('binds_explicit_root_before_initialization_without_writes', async () => {
    const root = await fresh();
    const project = await openProject(root);
    expect(project.root).toBe(await realpath(root));
    expect(project.networkDir).toBe(join(project.root, 'network-spec'));
    expect(project.runtimeDir).toBe(join(project.root, '.feature-network'));
    expect(project.markerPath).toBe(join(project.root, 'network-spec/_meta.yaml'));
    expect(await readdir(root)).toEqual([]);
  });

  it('accepts_explicit_relative_roots', async () => {
    const root = await fresh();
    expect((await openProject(relative(process.cwd(), root))).root).toBe(await realpath(root));
  });

  it('canonicalizes_a_root_alias', async () => {
    const root = await fresh();
    const alias = join(await fresh(), 'alias');
    await symlink(root, alias);
    expect((await openProject(alias)).root).toBe(await realpath(root));
  });

  it.each(['network-spec', '.feature-network'])('rejects_symlinked_storage_directories: %s', async dir => {
    const root = await fresh();
    const elsewhere = await fresh();
    await symlink(elsewhere, join(root, dir));
    await expect(openProject(root)).rejects.toMatchObject({ code: 'unsafe_path' });
  });

  it.each(['', '   '])('rejects_ambiguous_roots: %s', async root => {
    await expect(openProject(root)).rejects.toMatchObject({ code: 'ambiguous_root' });
  });

  it('finds_nearest_marker_without_crossing_checkout', async () => {
    const root = await fresh(); await repo(root); await marker(root);
    const inner = join(root, 'packages/inner'); await mkdir(join(inner, 'src'), { recursive: true });
    await marker(inner);
    expect((await discoverHookProject(join(inner, 'src')))?.root).toBe(await realpath(inner));
    const nested = join(root, 'embedded'); await mkdir(join(nested, 'src'), { recursive: true });
    await repo(nested);
    expect(await discoverHookProject(join(nested, 'src'))).toBeNull();
    await marker(nested);
    expect((await discoverHookProject(join(nested, 'src')))?.root).toBe(await realpath(nested));
  });

  it('rejects_an_internal_storage_alias_and_a_symlinked_marker', async () => {
    const root = await fresh(); await repo(root); await marker(root);
    const inner = join(root, 'inner'); await mkdir(inner);
    await symlink(join(root, 'network-spec'), join(inner, 'network-spec'));
    await expect(openProject(inner)).rejects.toMatchObject({ code: 'unsafe_path' });
    const other = join(root, 'other'); await mkdir(join(other, 'network-spec'), { recursive: true });
    await symlink(join(root, 'network-spec/_meta.yaml'), join(other, 'network-spec/_meta.yaml'));
    await expect(discoverHookProject(other)).rejects.toMatchObject({ code: 'unsafe_path' });
  });

  it('returns_null_outside_a_checkout_and_never_creates_markers', async () => {
    const root = await fresh(); await marker(root);
    expect(await discoverHookProject(root)).toBeNull();
  });

  it('does_not_bind_an_invalid_or_unsafe_nearer_marker_to_parent', async () => {
    const root = await fresh(); await repo(root); await marker(root);
    const inner = join(root, 'inner'); await mkdir(inner);
    await marker(inner, 'schema: 99\ncoverage: partial\n');
    await expect(discoverHookProject(inner)).rejects.toMatchObject({ code: 'invalid_schema' });
  });
});
