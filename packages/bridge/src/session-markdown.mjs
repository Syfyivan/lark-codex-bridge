function escapeMarkdownHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeMarkdownUrl(value) {
  const raw = String(value || '').trim();
  if (!/^https?:\/\/[^\s<>"']+$/i.test(raw)) return '';
  return raw;
}

function splitTrailingUrlPunctuation(value) {
  let url = String(value || '');
  let suffix = '';
  while (url && /[.,!?;:，。！？；：、)\]}]$/u.test(url)) {
    suffix = `${url.slice(-1)}${suffix}`;
    url = url.slice(0, -1);
  }
  return { url, suffix };
}

function linkifyEscapedHtml(value) {
  return String(value || '').replace(/https?:\/\/[^\s<]+/g, rawUrl => {
    const { url, suffix } = splitTrailingUrlPunctuation(rawUrl);
    const href = safeMarkdownUrl(url.replace(/&amp;/g, '&'));
    if (!href) return rawUrl;
    return `<a href="${escapeMarkdownHtml(href)}" target="_blank" rel="noreferrer">${url}</a>${suffix}`;
  });
}

export function renderInlineMarkdown(text) {
  const tokens = [];
  const stash = html => {
    const index = tokens.push(html) - 1;
    return `\u0000${index}\u0000`;
  };

  const withProtectedInline = String(text || '')
    .replace(/`([^`\n]+)`/g, (_, code) => stash(`<code>${escapeMarkdownHtml(code)}</code>`))
    .replace(/\[([^\]\n]+)\]\(([^\s)]+)\)/g, (match, label, url) => {
      const href = safeMarkdownUrl(url);
      if (!href) return stash(escapeMarkdownHtml(match));
      return stash(
        `<a href="${escapeMarkdownHtml(href)}" target="_blank" rel="noreferrer">${escapeMarkdownHtml(label)}</a>`,
      );
    });

  let html = escapeMarkdownHtml(withProtectedInline)
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_\n]+)__/g, '<strong>$1</strong>')
    .replace(/(^|[^\*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/(^|[^_])_([^_\n]+)_/g, '$1<em>$2</em>');

  html = linkifyEscapedHtml(html);
  return html.replace(/\u0000(\d+)\u0000/g, (_, index) => tokens[Number(index)] || '');
}

function renderMarkdownListItem(text) {
  const checklist = /^\[([ xX])\]\s+(.+)$/.exec(String(text || '').trim());
  if (!checklist) return renderInlineMarkdown(text);
  const checked = checklist[1].toLowerCase() === 'x';
  return `<span class="md-task" aria-hidden="true">${checked ? '☑' : '☐'}</span> ${renderInlineMarkdown(checklist[2])}`;
}

function splitMarkdownTableRow(line) {
  let source = String(line || '').trim();
  if (!source.includes('|')) return null;
  if (source.startsWith('|')) source = source.slice(1);
  if (source.endsWith('|')) source = source.slice(0, -1);

  const cells = [];
  let current = '';
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (char === '\\' && next === '|') {
      current += '|';
      index += 1;
      continue;
    }
    if (char === '|') {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells.length >= 2 ? cells : null;
}

function markdownTableAlignments(line) {
  const cells = splitMarkdownTableRow(line);
  if (!cells || !cells.every(cell => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, '')))) {
    return null;
  }
  return cells.map(cell => {
    const normalized = cell.replace(/\s+/g, '');
    if (normalized.startsWith(':') && normalized.endsWith(':')) return 'center';
    if (normalized.endsWith(':')) return 'right';
    if (normalized.startsWith(':')) return 'left';
    return '';
  });
}

function normalizeTableCells(cells, size) {
  const normalized = cells.slice(0, size);
  while (normalized.length < size) normalized.push('');
  return normalized;
}

function renderMarkdownTableHtml(headerCells, alignments, rows) {
  const alignAttr = index => {
    const align = alignments[index];
    return align ? ` style="text-align:${align}"` : '';
  };
  const renderCell = (tag, cell, index) =>
    `<${tag}${alignAttr(index)}>${renderInlineMarkdown(cell)}</${tag}>`;
  const width = headerCells.length;
  const header = normalizeTableCells(headerCells, width)
    .map((cell, index) => renderCell('th', cell, index))
    .join('');
  const body = rows
    .map(row => {
      const cells = normalizeTableCells(row, width)
        .map((cell, index) => renderCell('td', cell, index))
        .join('');
      return `<tr>${cells}</tr>`;
    })
    .join('');

  return `<div class="md-table-wrap"><table><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function parseMarkdownTable(lines, startIndex) {
  const headerCells = splitMarkdownTableRow(lines[startIndex]);
  const alignments = markdownTableAlignments(lines[startIndex + 1]);
  if (!headerCells || !alignments) return null;

  const width = headerCells.length;
  const rows = [];
  let index = startIndex + 2;
  while (index < lines.length) {
    const trimmed = String(lines[index] || '').trim();
    if (!trimmed) break;
    const row = splitMarkdownTableRow(lines[index]);
    if (!row) break;
    rows.push(row);
    index += 1;
  }

  return {
    nextIndex: index,
    html: renderMarkdownTableHtml(headerCells, normalizeTableCells(alignments, width), rows),
  };
}

export function renderSessionMarkdownBlockHtml(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let paragraph = [];
  let listType = '';
  let listItems = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push(`<p>${paragraph.map(renderInlineMarkdown).join('<br>')}</p>`);
    paragraph = [];
  };

  const flushList = () => {
    if (!listType) return;
    const tag = listType === 'ol' ? 'ol' : 'ul';
    blocks.push(`<${tag}>${listItems.map(item => `<li>${renderMarkdownListItem(item)}</li>`).join('')}</${tag}>`);
    listType = '';
    listItems = [];
  };

  const startList = (type, item) => {
    flushParagraph();
    if (listType && listType !== type) flushList();
    listType = type;
    listItems.push(item);
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }

    const table = parseMarkdownTable(lines, index);
    if (table) {
      flushParagraph();
      flushList();
      blocks.push(table.html);
      index = table.nextIndex - 1;
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    if (heading) {
      flushParagraph();
      flushList();
      const level = Math.min(6, heading[1].length);
      blocks.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }

    if (/^([-*_])(?:\s*\1){2,}\s*$/.test(trimmed)) {
      flushParagraph();
      flushList();
      blocks.push('<hr>');
      continue;
    }

    const unordered = /^[-*+]\s+(.+)$/.exec(trimmed);
    if (unordered) {
      startList('ul', unordered[1]);
      continue;
    }

    const ordered = /^\d+[.)]\s+(.+)$/.exec(trimmed);
    if (ordered) {
      startList('ol', ordered[1]);
      continue;
    }

    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      flushParagraph();
      flushList();
      blocks.push(`<blockquote>${renderInlineMarkdown(quote[1])}</blockquote>`);
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  flushParagraph();
  flushList();
  return blocks.join('\n');
}
