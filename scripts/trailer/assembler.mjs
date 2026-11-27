// Assemble frames/montage/fNNNNN.jpg (30 i/s) + musique → MP4 H.264/AAC.
// Usage : node assembler.mjs <ffmpeg.exe> <musique.wav> <sortie.mp4>
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const ICI = dirname(fileURLToPath(import.meta.url));
// DECALAGE : secondes de musique sautées au début (pour caler ses temps sur
// les coupes du montage).
const [,, FFMPEG, MUSIQUE, SORTIE, DECALAGE = '0'] = process.argv;
const FPS = 30;
const n = readdirSync(join(ICI, 'frames', 'montage')).filter(f => f.endsWith('.jpg')).length;
const total = n / FPS;
console.log(`${n} images → ${total.toFixed(2)} s`);
execFileSync(FFMPEG, [
  '-y', '-hide_banner', '-loglevel', 'error',
  '-framerate', String(FPS), '-i', join(ICI, 'frames', 'montage', 'f%05d.jpg'),
  '-ss', DECALAGE, '-i', MUSIQUE,
  '-filter_complex',
  `[0:v]scale=1920:1080:flags=lanczos:in_range=jpeg:out_range=mpeg,format=yuv420p,fade=t=in:st=0:d=0.5,fade=t=out:st=${(total - 1.0).toFixed(2)}:d=1.0[v];` +
  `[1:a]atrim=0:${total.toFixed(2)},afade=t=out:st=${(total - 2.2).toFixed(2)}:d=2.2[a]`,
  '-map', '[v]', '-map', '[a]',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-profile:v', 'high', '-level', '4.1', '-movflags', '+faststart',
  '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
  '-c:a', 'aac', '-b:a', '192k', '-shortest', SORTIE,
], { stdio: 'inherit' });
console.log('écrit :', SORTIE);
