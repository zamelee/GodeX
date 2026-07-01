#!/usr/bin/env python
"""Generate ground-truth fixtures for the model probe.

Outputs three files into the --out directory (default ./tools/probe/fixtures):

  image_test.png  64x64 PNG, solid red background, large white "RED" text
                  - tests color recognition + character OCR
                  - expected keyword in model reply: "red" / "红色" / "RED"

  audio_test.wav  1.0s mono 8kHz 16-bit PCM, 440Hz sine wave
                  - tests audio input recognition
                  - expected keyword in model reply: "audio" / "sound" /
                    "声音" / "beep" / "tone" / "440" / "sine"

  video_test.mp4  tiny ISO BMFF (mp4) stub: ftyp+moov+mdat with 1s of
                  solid color frames (not playable by stock decoders but
                  some upstreams still accept the multipart)
                  - tests video input recognition
                  - expected keyword in model reply: "video" / "视频" /
                    "frame" / "play" / "image"

Each fixture is also dumped as base64 (no header) to stdout for easy
copying into Rust source via include_str!().
"""
import argparse, base64, io, os, struct, sys, wave, math, zlib

# -------- image --------
def make_image_png(w=128, h=128):
    """128x128 PNG: solid red background, large white "RED" text in the middle."""
    try:
        from PIL import Image, ImageDraw, ImageFont
    except ImportError:
        # Fall back: pure-stdlib PNG without text. Model won't see "RED"
        # but at least it'll see red, which is still ground-truth-ish.
        return _png_solid_red(w, h)
    img = Image.new('RGB', (w, h), (220, 30, 30))   # saturated red
    d = ImageDraw.Draw(img)
    # Try common font paths on Windows; fall back to default bitmap.
    font = None
    for fp in (r'C:\Windows\Fonts\arialbd.ttf',
               r'C:\Windows\Fonts\Arial Bold.ttf',
               r'C:\Windows\Fonts\arial.ttf'):
        if os.path.exists(fp):
            try:
                font = ImageFont.truetype(fp, 56)
                break
            except Exception:
                pass
    if font is None:
        font = ImageFont.load_default()
    # Center the text. textbbox is supported on Pillow >= 8.0
    try:
        l, t, r, b = d.textbbox((0, 0), 'RED', font=font)
        tw, th = r - l, b - t
    except AttributeError:
        tw, th = d.textsize('RED', font=font)
    d.text(((w - tw) / 2, (h - th) / 2 - 4), 'RED', fill=(255, 255, 255), font=font)
    # Add a thin black border for shape recognition
    d.rectangle([(2, 2), (w - 3, h - 3)], outline=(0, 0, 0), width=2)
    buf = io.BytesIO()
    img.save(buf, 'PNG', optimize=True)
    return buf.getvalue()

def _png_solid_red(w, h):
    sig = b'\x89PNG\r\n\x1a\n'
    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    ihdr = struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)
    raw = b''.join(b'\x00' + bytes([220, 30, 30]) * w for _ in range(h))
    idat = zlib.compress(raw, 9)
    return sig + chunk(b'IHDR', ihdr) + chunk(b'IDAT', idat) + chunk(b'IEND', b'')

# -------- audio --------
def make_audio_wav(seconds=1.0, rate=8000, freq=440.0):
    n = int(seconds * rate)
    buf = io.BytesIO()
    with wave.open(buf, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        frames = bytearray()
        for i in range(n):
            sample = int(16384 * math.sin(2 * math.pi * freq * i / rate))
            frames.extend(struct.pack('<h', sample))
        w.writeframesraw(bytes(frames))
    return buf.getvalue()

# -------- video --------
def make_video_mp4_stub():
    """Minimal ISO BMFF (mp4): ftyp + moov with empty stbl + 1-byte mdat.
    Not playable. We just need a file the upstream will accept as 'video/mp4'."""
    ftyp  = b'\x00\x00\x00\x18ftypisom' + b'\x00\x00\x02\x00' + b'isomiso2avc1mp41'
    free  = b'\x00\x00\x00\x08free'
    mdat  = b'\x00\x00\x00\x09mdat' + b'\x00'   # 1 byte of payload
    moov  = b'\x00\x00\x00\x08moov'              # empty moov container (no mvhd/trak)
    # some upstreams reject empty moov; add a tiny mvhd so the box is at least
    # structurally valid
    mvhd  = (
        b'\x00\x00\x00\x6cmvhd'                  # box size 108
        b'\x00\x00\x00\x00'                      # version + flags
        + b'\x00\x00\x00\x00' * 2                # creation/modification time
        + struct.pack('>I', 1000)                # timescale
        + struct.pack('>I', 1000)                # duration
        + b'\x00\x01\x00\x00'                    # rate 1.0
        + b'\x00\x01\x00\x00'                    # volume 1.0
        + b'\x00' * 10                           # reserved
        + struct.pack('>9I', 0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000)  # matrix
        + b'\x00' * 24                           # pre_defined
        + struct.pack('>I', 2)                   # next track id
    )
    moov_real = b'\x00\x00\x00\x08moov' + mvhd
    # recompute moov box size
    moov_size = len(moov_real)
    moov_real = struct.pack('>I', moov_size) + moov_real[4:]
    return ftyp + free + moov_real + mdat

# -------- main --------
def main():
    p = argparse.ArgumentParser()
    p.add_argument('--out', default=os.path.join(os.path.dirname(__file__), 'fixtures'))
    a = p.parse_args()
    os.makedirs(a.out, exist_ok=True)
    files = {
        'image_test.png':  make_image_png(),
        'audio_test.wav':  make_audio_wav(),
        'video_test.mp4':  make_video_mp4_stub(),
    }
    print('--- file sizes ---')
    for name, data in files.items():
        pth = os.path.join(a.out, name)
        with open(pth, 'wb') as f:
            f.write(data)
        print(f'  {name:20}  {len(data):>6} bytes  {pth}')
    print()
    print('--- base64 (for include_str! in Rust) ---')
    for name, data in files.items():
        b64 = base64.b64encode(data).decode('ascii')
        print(f'// {name}  len={len(data)}  b64_len={len(b64)}')
        # wrap to 76 columns
        for i in range(0, len(b64), 76):
            print(f'"{b64[i:i+76]}"')
        print()

if __name__ == '__main__':
    main()