import urllib.request, re
# Get the HTML and look for endpoint hints
r = urllib.request.urlopen('https://minnimax.chat/v1/files', timeout=15)
html = r.read().decode('utf-8','replace')
print(f'status={r.status}  len={len(html)}')
# Print title and look for API paths mentioned in bundled JS
title = re.search(r'<title>(.*?)</title>', html, re.S)
print('title:', title.group(1) if title else '?')
# Extract any API path patterns
for pat in ['/api', '/upload', '/file', '/v1/', '/assets/', 'index-']:
    found = re.findall(r'["\'](/[^"\']*' + re.escape(pat) + r'[^"\']*)["\']', html)
    if found:
        print(f'  pattern {pat!r}: {sorted(set(found))[:6]}')
# Look for hint lines about file uploads
hint = re.search(r'(文件上传|upload|file)[^<]{0,80}', html, re.I)
print('hint match:', hint.group(0)[:100] if hint else 'none')
