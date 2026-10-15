from pathlib import Path
import base64, html, re

root = Path.cwd()
source = root / 'LESSON8-HOMEWORK.md'
out = root / 'artifacts' / 'lesson8-feishu-import.html'
lines = source.read_text(encoding='utf-8').splitlines()

def inline(text):
    pattern = re.compile(r'(!\[[^\]]*\]\([^)]*\)|\[[^\]]+\]\([^)]*\)|\*\*[^*]+\*\*|`[^`]+`)')
    pieces = []
    pos = 0
    for m in pattern.finditer(text):
        pieces.append(html.escape(text[pos:m.start()]))
        token = m.group(0)
        if token.startswith('!['):
            alt, path = re.fullmatch(r'!\[(.*?)\]\((.*?)\)', token).groups()
            file = (root / path).resolve()
            mime = 'image/png' if file.suffix.lower() == '.png' else 'image/jpeg'
            data = base64.b64encode(file.read_bytes()).decode('ascii')
            pieces.append(f'<img src="data:{mime};base64,{data}" alt="{html.escape(alt)}" style="width:90%;height:auto;display:block;margin:12px auto">')
        elif token.startswith('['):
            label, url = re.fullmatch(r'\[(.*?)\]\((.*?)\)', token).groups()
            if not url.startswith(('https://', 'http://')):
                pieces.append(f'<span>{html.escape(label)}（仓库内文件：{html.escape(url)}）</span>')
            else:
                pieces.append(f'<a href="{html.escape(url, quote=True)}">{html.escape(label)}</a>')
        elif token.startswith('**'):
            pieces.append('<strong>' + html.escape(token[2:-2]) + '</strong>')
        elif token.startswith('`'):
            pieces.append('<code>' + html.escape(token[1:-1]) + '</code>')
        pos = m.end()
    pieces.append(html.escape(text[pos:]))
    return ''.join(pieces)

parts = ['<html><head><meta charset="utf-8"><style>body{font-family:Arial,"Microsoft YaHei",sans-serif;color:#20262e;line-height:1.65;font-size:11pt}h1,h2,h3{color:#111}h1{font-size:20pt;margin:0 0 16pt}h2{font-size:15pt;margin:22pt 0 8pt}h3{font-size:12pt;margin:16pt 0 6pt}p{margin:5pt 0 9pt}table{border-collapse:collapse;width:100%;margin:8pt 0 14pt}th,td{border:1px solid #c8d1dc;padding:6px 8px;vertical-align:top}th{background:#17365d;color:white;text-align:left}tr:nth-child(even) td{background:#f4f6f8}li{margin:3pt 0}code{font-family:Consolas,monospace;background:#f2f4f7}</style></head><body>']
i = 0
first_title = True
while i < len(lines):
    raw = lines[i]
    line = raw.strip()
    if not line or line == '---':
        i += 1
        continue
    if line.startswith('# '):
        if first_title:
            first_title = False
        else:
            parts.append('<h1>' + inline(line[2:]) + '</h1>')
        i += 1
        continue
    if line.startswith('## '):
        parts.append('<h2>' + inline(line[3:]) + '</h2>')
        i += 1
        continue
    if line.startswith('### '):
        parts.append('<h3>' + inline(line[4:]) + '</h3>')
        i += 1
        continue
    if line.startswith('| '):
        rows = []
        while i < len(lines) and lines[i].strip().startswith('|'):
            vals = re.split(r'\s*\|\s*', lines[i].strip().strip('|'))
            if not all(re.fullmatch(r'-+', v.strip()) for v in vals):
                rows.append(vals)
            i += 1
        if rows:
            parts.append('<table><thead><tr>' + ''.join('<th>' + inline(c) + '</th>' for c in rows[0]) + '</tr></thead><tbody>')
            for row in rows[1:]:
                parts.append('<tr>' + ''.join('<td>' + inline(c) + '</td>' for c in row) + '</tr>')
            parts.append('</tbody></table>')
        continue
    if line.startswith('!['):
        parts.append('<p>' + inline(line) + '</p>')
        i += 1
        continue
    if line.startswith('- '):
        parts.append('<ul>')
        while i < len(lines) and lines[i].strip().startswith('- '):
            parts.append('<li>' + inline(lines[i].strip()[2:]) + '</li>')
            i += 1
        parts.append('</ul>')
        continue
    if re.match(r'^\d+\.\s+', line):
        parts.append('<ol>')
        while i < len(lines) and re.match(r'^\d+\.\s+', lines[i].strip()):
            parts.append('<li>' + inline(re.sub(r'^\d+\.\s+', '', lines[i].strip())) + '</li>')
            i += 1
        parts.append('</ol>')
        continue
    parts.append('<p>' + inline(line) + '</p>')
    i += 1
parts.append('</body></html>')
out.write_text(''.join(parts), encoding='utf-8')
print(f'Wrote {out} ({out.stat().st_size} bytes)')
