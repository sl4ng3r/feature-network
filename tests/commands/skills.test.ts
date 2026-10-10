import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const names = ['init', 'status', 'show', 'impact', 'check', 'sync'] as const;
function skillManifest(text: string, name: string) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]+)$/.exec(text);
  expect(match, `${name} needs parseable frontmatter and a nonempty body`).not.toBeNull();
  return parse(match![1]!);
}
async function registration(name: string) {
  const root = new URL(`../../plugin/skills/${name}/`, import.meta.url);
  let text: string;
  try { text = await readFile(new URL('SKILL.md', root), 'utf8'); }
  catch { expect.fail(`${name} skill registration is missing`); }
  return { manifest: skillManifest(text, name), openai: parse(await readFile(new URL('agents/openai.yaml', root), 'utf8')) };
}
function menuEntry(value: Awaited<ReturnType<typeof registration>>) {
  return { name: value.manifest.name, description: value.openai.interface.short_description,
    label: value.openai.interface.display_name, implicitCodex: value.openai.policy.allow_implicit_invocation,
    implicitCopilotCLI: value.manifest['disable-model-invocation'] !== true };
}

describe('native skill registrations (not live host acceptance)', () => {
  it('general_registration_is_available_for_development_without_superpowers_opt_in', async () => {
    const { manifest, openai } = await registration('feature-network');
    const entry = menuEntry({ manifest, openai });
    expect(entry.name).toBe('feature-network');
    expect(entry.implicitCodex).toBe(true); expect(entry.implicitCopilotCLI).toBe(true);
    expect(manifest.description).toMatch(/^Use when /);
    expect(entry.description.length).toBeGreaterThan(20); expect(entry.label).toBe('FeatureNetwork');
    expect(Object.keys(openai).sort()).toEqual(['interface', 'policy']);
    expect(Object.keys(openai.policy)).toEqual(['allow_implicit_invocation']);
    expect(manifest).not.toHaveProperty('allow_implicit_invocation');
    expect(openai).not.toHaveProperty('disable-model-invocation');
  });
  it('six_named_commands_have_descriptions', async () => {
    const entries = await Promise.all(names.map(async suffix => menuEntry(await registration(`feature-network-${suffix}`))));
    expect(entries.map(e => e.name)).toEqual(names.map(suffix => `feature-network-${suffix}`));
    expect(new Set(entries.map(e => e.description)).size).toBe(6);
    for (const entry of entries) {
      expect(entry.name.startsWith('feature-net')).toBe(true);
      expect(entry.description.length).toBeGreaterThan(20);
      expect(entry.label).toBe(entry.name);
    }
  });
  it.each(names)('%s command native policy excludes implicit invocation', async suffix => {
    const { manifest, openai } = await registration(`feature-network-${suffix}`);
    const entry = menuEntry({ manifest, openai });
    expect(entry.implicitCodex).toBe(false); expect(entry.implicitCopilotCLI).toBe(false);
    expect(manifest['user-invocable']).toBe(true);
    expect(manifest.description).toMatch(/^Use when /);
    expect(manifest).not.toHaveProperty('allow_implicit_invocation');
    expect(openai).not.toHaveProperty('disable-model-invocation');
  });
});

// YAML permits CRLF line breaks; the contract checker must not reject a
// valid Markdown registration merely because Git converted its line endings.
it.each(['\n', '\r\n'])('frontmatter_accepts_valid_line_breaks_%j', async newline => {
  const text = await readFile(new URL('../../plugin/skills/feature-network-init/SKILL.md', import.meta.url), 'utf8');
  const manifest = skillManifest(text.replace(/\r?\n/g, newline), 'feature-network-init');
  expect(manifest.name).toBe('feature-network-init');
  expect(manifest['user-invocable']).toBe(true);
  expect(manifest['disable-model-invocation']).toBe(true);
});

// Instruction contracts, not proof that a host model follows the instructions.
describe('development and impact instruction contracts', () => {
  it('ordinary_coding_authorization_survives_unspecified_command_classification', async () => {
    const text = await readFile(new URL('../../plugin/skills/feature-network/SKILL.md', import.meta.url), 'utf8');
    expect(text).toMatch(/plain coding request.*unspecified/s);
    expect(text).toMatch(/does not withdraw.*product.*authorization/i);
    expect(text).toMatch(/actual.*current-turn changes/s);
    expect(text).toContain('Explicit `status`, `show`, `impact`, and `check` stay read-only');
  });
  it.each(['feature-network', 'feature-network-impact'])('%s resolves direct origins before traversing dependents', async name => {
    const text = await readFile(new URL(`../../plugin/skills/${name}/SKILL.md`, import.meta.url), 'utf8');
    expect(text).toMatch(/network_context.*direct(?:ly)?(?: changed)?(?: feature)? roots/s);
    expect(text).toMatch(/do not.*dependents.*(?:origin|seed)/i);
    expect(text).toContain('network_impact({ids:["user-profile"],direction:"both",depth:2})');
    expect(text).toMatch(/incoming.*dependents/i);
    expect(text).toMatch(/zero-length.*(?:origin|seed)/i);
    expect(text).toContain('network_impact({cursor: result.nextCursor})');
  });
});
