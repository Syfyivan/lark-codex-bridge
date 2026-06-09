export function closeUnclosedCodeFence(text) {
  const value = String(text || '');
  const fenceCount = (value.match(/```/g) || []).length;
  return fenceCount % 2 === 1 ? `${value}\n\`\`\`` : value;
}
