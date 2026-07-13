const BRIDGE_ROOT = 'packages/bridge/';
const CHANGELOG_PATH = `${BRIDGE_ROOT}CHANGELOG.md`;

export function changelogRequiredButMissing(changedFiles = []) {
  const normalized = changedFiles
    .map(file => String(file || '').trim().replace(/^\.\//, ''))
    .filter(Boolean);
  const bridgeChanged = normalized.some(file => file.startsWith(BRIDGE_ROOT) && file !== CHANGELOG_PATH);
  return bridgeChanged && !normalized.includes(CHANGELOG_PATH);
}

export function validateChangelog(content) {
  const text = String(content || '');
  const errors = [];
  if (!/^# Changelog$/m.test(text)) errors.push('missing "# Changelog" heading');
  if (!/^## \[Unreleased\]$/m.test(text)) errors.push('missing "## [Unreleased]" section');
  return errors;
}

