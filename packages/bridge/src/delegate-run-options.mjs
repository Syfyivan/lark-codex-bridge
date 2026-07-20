export function buildDelegateCodexRunOptions(input = {}) {
  const options = {};
  const copyIfPresent = (key, value) => {
    if (value !== undefined && value !== null && value !== '') options[key] = value;
  };

  copyIfPresent('progress', input.progress);
  copyIfPresent('contextKey', input.contextKey);
  copyIfPresent('cwd', input.cwd);
  copyIfPresent('sandbox', input.sandbox);
  if (Array.isArray(input.messageIds) && input.messageIds.length) {
    options.messageIds = [...input.messageIds];
  }
  copyIfPresent('sessionTitle', input.sessionTitle);
  return options;
}
