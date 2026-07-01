import sys
sys.path.insert(0, r'D:\Documents\VibeCoding\GodeX\tools\probe')
from generate_fixtures import make_image_png, make_audio_wav, make_video_mp4_stub
import base64
img = base64.b64encode(make_image_png()).decode()
wav = base64.b64encode(make_audio_wav()).decode()
mp4 = base64.b64encode(make_video_mp4_stub()).decode()
print('// image_test.png b64 len:', len(img))
print('pub const IMAGE_B64: &str =')
for i in range(0, len(img), 76):
    print('    "' + img[i:i+76] + '"')
print(';')
print()
print('// audio_test.wav b64 len:', len(wav))
print('pub const AUDIO_B64: &str =')
for i in range(0, len(wav), 76):
    print('    "' + wav[i:i+76] + '"')
print(';')
print()
print('// video_test.mp4 b64 len:', len(mp4))
print('pub const VIDEO_B64: &str =')
for i in range(0, len(mp4), 76):
    print('    "' + mp4[i:i+76] + '"')
print(';')