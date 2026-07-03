import os
fp1='D:/Documents/VibeCoding/GodeX/chrome-browser-mcp/src/index.ts'
c1=open(fp1,encoding='utf-8').read()
lines1=c1.split('\n')
print('index.ts L275:', repr(lines1[274]))

fp2='D:/Documents/VibeCoding/GodeX/chrome-browser-mcp/src/chrome.ts'
c2=open(fp2,encoding='utf-8').read()
lines2=c2.split('\n')
print('chrome.ts L74:', repr(lines2[73]))
print('chrome.ts L78:', repr(lines2[77]))

fp3='D:/Documents/VibeCoding/GodeX/chrome-browser-mcp/src/tools/basic.ts'
c3=open(fp3,encoding='utf-8').read()
lines3=c3.split('\n')
print('basic.ts L36:', repr(lines3[35]))

fp4='D:/Documents/VibeCoding/GodeX/chrome-browser-mcp/src/utils/port-finder.ts'
c4=open(fp4,encoding='utf-8').read()
lines4=c4.split('\n')
print('port-finder.ts L104:', repr(lines4[103]))
print('port-finder.ts L121:', repr(lines4[120]))
