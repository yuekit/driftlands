// node tools/d3/sheet2.mjs out.jpg cols width file1 file2 ...   (a labelled contact sheet of pictures)
import sharp from 'sharp'; import path from 'path';
const [out, colsS, wS, ...files] = process.argv.slice(2);
const cols = +colsS, w = +wS, h = Math.round(w * 0.5625), rows = Math.ceil(files.length / cols), comp = [];
for (let i = 0; i < files.length; i++) {
  const label = path.basename(files[i]).replace(/\.(png|jpg)$/, '');
  const svg = Buffer.from(`<svg width="${w}" height="24" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="rgba(0,0,0,0.55)"/><text x="6" y="17" font-family="Helvetica" font-size="14" fill="#fff">${label}</text></svg>`);
  comp.push({ input: await sharp(files[i]).resize(w, h, { fit: 'cover' }).composite([{ input: svg, top: 0, left: 0 }]).toBuffer(), left: (i % cols) * w, top: Math.floor(i / cols) * h });
}
await sharp({ create: { width: cols * w, height: rows * h, channels: 3, background: '#222' } }).composite(comp).jpeg({ quality: 86 }).toFile(out);
