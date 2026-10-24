/**
 * 极简 Markdown 渲染器：只覆盖 LLM 回复的常见语法
 * （标题 / 加粗 / 行内代码 / 围栏代码块 / 有序无序列表 / 表格 / 链接）。
 * 先整体转义 HTML 再插入标签——模型输出里的 <script> 之类永远只是文本。
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 行内语法：入参是原始文本，先转义再套标签 */
function inline(raw: string): string {
  const links: string[] = [];
  return escapeHtml(raw.replaceAll('\0', ''))
    .replace(
      /\[([^\]\n]+)\]\((https?:\/\/[^)\s]+|\/(?:finance|procurement|operations|workbench|stock|requests|insights)(?:\/[a-z0-9-]+)*(?:\?(?:[a-z0-9%=._+-]|&amp;)*)?)\)/gi,
      (_, label: string, url: string) => {
        const renderedLabel = label
          .replace(/`([^`\n]+)`/g, '<code>$1</code>')
          .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
        const tag = url.startsWith('/')
          ? `<a href="${url}">${renderedLabel}</a>`
          : `<a href="${url}" target="_blank" rel="noreferrer noopener">${renderedLabel}</a>`;
        return `\0${links.push(tag) - 1}\0`;
      },
    )
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\0(\d+)\0/g, (_, idx: string) => links[Number(idx)]);
}

/** 表格分隔行：| --- | :---: | 之类 */
function isTableDivider(line: string): boolean {
  return /^\|[\s:|-]+\|$/.test(line.trim());
}

function isTableRow(line: string): boolean {
  return line.trim().startsWith('|');
}

function splitRow(line: string): string[] {
  return line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
}

const UL_RE = /^\s*[-*•]\s+/;
/* 中文有序列表常写成「1、内容」（顿号后无空格），. / ) 仍要求空格避免误吃「1.5 倍」 */
const OL_RE = /^\s*\d+(?:[.)]\s+|、)\s*/;

export function renderMarkdown(src: string): string {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let para: string[] = [];
  let inCode = false;
  const codeBuf: string[] = [];

  const flushPara = (): void => {
    if (para.length) {
      out.push(`<p>${para.map(inline).join('<br>')}</p>`);
      para = [];
    }
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // 围栏代码块：内部不做 Markdown，只转义 HTML
    if (/^\s*```/.test(line)) {
      if (inCode) {
        out.push(`<pre><code>${escapeHtml(codeBuf.join('\n'))}</code></pre>`);
        codeBuf.length = 0;
        inCode = false;
      } else {
        flushPara();
        inCode = true;
      }
      i += 1;
      continue;
    }
    if (inCode) {
      codeBuf.push(line);
      i += 1;
      continue;
    }

    if (!line.trim()) {
      flushPara();
      i += 1;
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      flushPara();
      out.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`);
      i += 1;
      continue;
    }

    // 表格：当前行是表头、下一行是分隔行才成立
    if (isTableRow(line) && i + 1 < lines.length && isTableDivider(lines[i + 1])) {
      flushPara();
      const header = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i]) && lines[i].trim()) {
        rows.push(splitRow(lines[i]));
        i += 1;
      }
      const thead = `<thead><tr>${header.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead>`;
      const tbody = rows.length
        ? `<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody>`
        : '';
      out.push(`<table>${thead}${tbody}</table>`);
      continue;
    }

    if (UL_RE.test(line)) {
      flushPara();
      const items: string[] = [];
      while (i < lines.length && UL_RE.test(lines[i])) {
        items.push(`<li>${inline(lines[i].replace(UL_RE, ''))}</li>`);
        i += 1;
      }
      out.push(`<ul>${items.join('')}</ul>`);
      continue;
    }

    if (OL_RE.test(line)) {
      flushPara();
      const items: string[] = [];
      while (i < lines.length && OL_RE.test(lines[i])) {
        items.push(`<li>${inline(lines[i].replace(OL_RE, ''))}</li>`);
        i += 1;
      }
      out.push(`<ol>${items.join('')}</ol>`);
      continue;
    }

    para.push(line);
    i += 1;
  }
  flushPara();
  // 没闭合的代码块也照常输出，别吞内容
  if (inCode) out.push(`<pre><code>${escapeHtml(codeBuf.join('\n'))}</code></pre>`);
  return out.join('');
}
