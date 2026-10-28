// Deterministic local PNG icon generator; no downloaded imagery or runtime dependency.
import { deflateSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
function crc32(buffer) { let c = 0xffffffff; for (const b of buffer) { c ^= b; for (let i=0;i<8;i++) c = (c >>> 1) ^ ((c & 1) ? 0xedb88320 : 0); } return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const b = Buffer.from(type), len = Buffer.alloc(4), crc = Buffer.alloc(4); len.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([b,data]))); return Buffer.concat([len,b,data,crc]); }
await mkdir('extension/icons', { recursive: true });
for (const size of [16,32,48,128]) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y=0;y<size;y++) for(let x=0;x<size;x++) {
    const nx=(x+.5)/size, ny=(y+.5)/size, dx=Math.max(.18-nx,0,nx-.82), dy=Math.max(.18-ny,0,ny-.82);
    const inside=dx*dx+dy*dy<.18*.18;
    const leaf=((nx-.48)/.23)**2+((ny-.45)/.30)**2<1 && ny < .78 - nx*.45;
    const cue=Math.hypot(nx-.72,ny-.72)<.075;
    const color = leaf ? [221,237,203] : cue ? [244,211,128] : [39,92,75];
    const offset = y*(size*4+1)+1+x*4; raw.set([...color,inside?255:0],offset);
  }
  const header=Buffer.alloc(13);header.writeUInt32BE(size);header.writeUInt32BE(size,4);header[8]=8;header[9]=6;
  await writeFile(`extension/icons/icon${size}.png`,Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]));
}
