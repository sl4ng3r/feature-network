import { exec } from '../project/helpers.js';

/** A fresh checkout needs one actual build before any offline-bundle consumer. */
export default async function buildTestBundle(): Promise<void> {
  await exec(process.execPath, ['scripts/build-plugin.mjs'], { timeout: 20_000 });
}
