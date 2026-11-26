export function closeUnclosedCodeFence(text) {
  const value = String(text || '');
  let open = '';
  for (const line of value.split(/\r\n?|\n/)) {
    const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (!match) continue;
    const [, fence, rest] = match;
    if (!open) {
      if (fence[0] === '~' || !rest.includes('`')) open = fence;
    } else if (fence[0] === open[0] && fence.length >= open.length && /^[ \t]*$/.test(rest)) {
      open = '';
    }
  }
  return open ? `${value}\n${open}` : value;
}
