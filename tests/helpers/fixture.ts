export const validBackupYaml = `schema: 1
id: backup
summary: Saves a local demo profile for restoration.
key_points:
  - Includes persistent profile fields.
  - Excludes temporary session state.
code:
  - path: src/backup.ts
    symbol: createBackup
evidence:
  - path: tests/backup.test.ts
relations:
  - to: user-profile
    type: reads
    status: evidenced
    evidence:
      - path: src/backup.ts
    when: Persistent fields change.
    check: Verify a backup and restore roundtrip.
hypotheses:
  - text: Export may require a size limit.
`;

export const minimalFeatureYaml = `schema: 1
id: backup
summary: Saves a local demo profile.
key_points: []
code:
  - path: docs/backup.md
`;
