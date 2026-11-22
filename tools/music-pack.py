#!/usr/bin/env python3
"""Make a music pack for APEX PURSUIT from a folder of MP3s (4D.1).

    pip install mutagen
    python tools/music-pack.py "C:/Music/My racing mix"            # writes play/music/
    python tools/music-pack.py <folder> --out dist/music

The pack is a `music/` folder next to the game page: `tracks.js` (the list), the audio files
and their covers. The game finds it by itself. Music packs are personal: play/music/ is in
.gitignore so your songs never go into the public repository.
"""
import argparse, json, os, re, shutil, sys

try:
    from mutagen import File as MFile
    from mutagen.id3 import ID3
except ImportError:
    sys.exit("Needs mutagen:  pip install mutagen")

AUDIO = ('.mp3', '.m4a', '.aac', '.ogg', '.oga', '.opus', '.wav', '.flac')


def clean(s):
    s = re.sub(r'\.(mp3|m4a|aac|ogg|oga|opus|wav|flac)$', '', s, flags=re.I)
    s = re.sub(r'\s*\(spotisaver\)\s*', ' ', s, flags=re.I)
    s = re.sub(r'#U([0-9a-fA-F]{4})', lambda m: chr(int(m.group(1), 16)), s)
    return re.sub(r'\s+', ' ', s).strip()


def slug(s):
    s = re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-')
    return s[:40] or 'track'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('folder')
    ap.add_argument('--out', default=os.path.join(os.path.dirname(__file__), '..', 'play', 'music'))
    o = ap.parse_args()
    files = sorted(f for f in os.listdir(o.folder) if f.lower().endswith(AUDIO))
    if not files:
        sys.exit('No audio files in ' + o.folder)
    out = os.path.abspath(o.out)
    os.makedirs(os.path.join(out, 'covers'), exist_ok=True)
    tracks = []
    for i, f in enumerate(files, 1):
        src = os.path.join(o.folder, f)
        base = clean(f)
        artist, title = (base.split(' - ', 1) + [''])[:2] if ' - ' in base else ('', base)
        album, dur, cover = '', 0, None
        m = MFile(src)
        if m is not None and m.info:
            dur = round(float(getattr(m.info, 'length', 0) or 0), 1)
        try:
            tag = ID3(src)
            if tag.get('TIT2'): title = clean(str(tag['TIT2']))
            if tag.get('TPE1'): artist = ', '.join(str(x) for x in tag['TPE1'].text).replace('/', ', ')
            if tag.get('TALB'): album = str(tag['TALB'])
            pics = tag.getall('APIC')
            if pics:
                cover = pics[0]
        except Exception:
            pass
        if not title:
            title = base
        ext = os.path.splitext(f)[1].lower()
        name = f'{i:02d}-{slug(title)}{ext}'
        shutil.copyfile(src, os.path.join(out, name))
        entry = {'id': f'{i:02d}-{slug(title)}', 'file': name, 'title': title, 'artist': artist, 'album': album, 'dur': dur}
        if cover is not None:
            cext = '.png' if 'png' in (cover.mime or '') else '.jpg'
            cname = f'covers/{i:02d}{cext}'
            with open(os.path.join(out, cname), 'wb') as fh:
                fh.write(cover.data)
            entry['cover'] = cname
        tracks.append(entry)
        print(f'{i:2d}. {title} — {artist}')
    with open(os.path.join(out, 'tracks.js'), 'w', encoding='utf-8') as fh:
        fh.write('// APEX PURSUIT music pack (tools/music-pack.py). Personal: not for the public repository.\n')
        fh.write('window.__APEX_TRACKS__ = ' + json.dumps(tracks, ensure_ascii=False, indent=1) + ';\n')
    print(f'\n{len(tracks)} tracks → {out}')


if __name__ == '__main__':
    main()
