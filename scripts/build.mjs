import { rolldown } from 'rolldown';
import { cp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { stagedBuild } from './staged-build.mjs';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { localScriptRulesPath, prepareAdguardAssets } from './adguard-assets.mjs';
import { compactRulesAdapter, unusedFilterCatalogGuard } from './build-adapters.mjs';
import { extendedCssAdapter } from './extended-css-adapter.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
async function build(out) {
await mkdir(out, { recursive: true });
await cp(`${root}public`, out, { recursive: true });
const snapshot = await prepareAdguardAssets(out);
const compactAdapter = await compactRulesAdapter();
const cosmeticAdapter = await extendedCssAdapter();
for (const [input, format] of [[{background:`${root}src/background.ts`,popup:`${root}src/popup.ts`,options:`${root}src/options.ts`}, 'esm'], [{content:`${root}src/content.ts`}, 'iife'], [{ 'youtube-main': `${root}src/youtube-entry.ts` }, 'iife'], [{ 'assistant-inject': fileURLToPath(import.meta.resolve('@adguard/tswebextension/assistant-inject')) }, 'iife'], [{ gpc: fileURLToPath(import.meta.resolve('@adguard/tswebextension/mv3/gpc')) }, 'iife'], [{ 'hide-document-referrer': fileURLToPath(import.meta.resolve('@adguard/tswebextension/mv3/hide-document-referrer')) }, 'iife']]) {
  const bundle = await rolldown({ input, platform:'browser', treeshake:true, plugins: [compactAdapter.plugin, cosmeticAdapter.plugin, unusedFilterCatalogGuard(), { name: 'preverified-local-script-rules', resolveId(id) { return id === 'rea:local-script-rules' ? localScriptRulesPath : null; } }] });
  try { await bundle.write({ dir:out, format, entryFileNames:'[name].js', chunkFileNames:'chunks/[name]-[hash].js', minify:true, sourcemap:false }); }
  finally { await bundle.close(); }
}
compactAdapter.verify();
cosmeticAdapter.verify();
await writeFile(`${out}/build-adapters.json`,JSON.stringify([compactAdapter.metadata,cosmeticAdapter.metadata],null,2));
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) { crc ^= byte; for (let i=0;i<8;i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const bytes=Buffer.from(type); const len=Buffer.alloc(4); len.writeUInt32BE(data.length); const crc=Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([bytes,data]))); return Buffer.concat([len,bytes,data,crc]);
}
function parseBrandIcon(svg) {
  const match=svg.trim().match(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 (\d+) (\d+)">\s*<title>Safora<\/title>\s*<rect width="(\d+)" height="(\d+)" rx="(\d+)" fill="(#[a-f\d]{6})"\/>\s*<polygon points="([\d.,\s]+)" fill="(#[a-f\d]{6})"\/>\s*<\/svg>$/u);
  if(!match) throw new Error('Safora icon must contain the supported rounded rectangle and polygon SVG only.');
  const [,width,height,rectWidth,rectHeight,radius,background,points,foreground]=match;
  const size=Number(width),rounding=Number(radius);
  if(size<=0 || width!==height || width!==rectWidth || height!==rectHeight || rounding>size/2) throw new Error('Safora icon dimensions or corner radius are invalid.');
  const polygon=points.trim().split(/\s+/u).map(point=>{
    if(!/^\d+(?:\.\d+)?,\d+(?:\.\d+)?$/u.test(point)) throw new Error('Safora icon polygon contains an invalid point.');
    const pair=point.split(',').map(Number);
    if(pair.some(value=>!Number.isFinite(value) || value<0 || value>size)) throw new Error('Safora icon polygon lies outside its view box.');
    return pair;
  });
  if(polygon.length<3) throw new Error('Safora icon polygon needs at least three points.');
  const color=value=>[1,3,5].map(offset=>Number.parseInt(value.slice(offset,offset+2),16));
  return {size,rounding,polygon,background:color(background),foreground:color(foreground)};
}
const brandIcon=parseBrandIcon(await readFile(`${root}public/icons/safora.svg`,'utf8'));
function insidePolygon(x,y,polygon) {
  let hit=false;
  for(let i=0,j=polygon.length-1;i<polygon.length;j=i++) { const [a,b]=polygon[i], [c,d]=polygon[j]; if((b>y)!==(d>y) && x<(c-a)*(y-b)/(d-b)+a) hit=!hit; }
  return hit;
}
function insideTile(x,y) {
  const {size,rounding}=brandIcon;
  const cx=Math.max(rounding,Math.min(size-rounding,x)),cy=Math.max(rounding,Math.min(size-rounding,y));
  return (x-cx)**2+(y-cy)**2<=rounding**2;
}
function icon(size) {
  const pixels=Buffer.alloc(size*(size*4+1));
  for(let y=0;y<size;y++) for(let x=0;x<size;x++) {
    let alpha=0,white=0;
    for(let dy=0;dy<4;dy++) for(let dx=0;dx<4;dx++) { const px=(x+(dx+.5)/4)/size*brandIcon.size,py=(y+(dy+.5)/4)/size*brandIcon.size; if(insideTile(px,py)){alpha++; if(insidePolygon(px,py,brandIcon.polygon)) white++;} }
    const at=y*(size*4+1)+1+x*4;
    for(let channel=0;channel<3;channel++) pixels[at+channel]=alpha?Math.round((brandIcon.background[channel]*(alpha-white)+brandIcon.foreground[channel]*white)/alpha):0;
    pixels[at+3]=Math.round(alpha/16*255);
  }
  const header=Buffer.alloc(13);header.writeUInt32BE(size,0);header.writeUInt32BE(size,4);header[8]=8;header[9]=6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
}
await mkdir(`${out}/icons`,{recursive:true});
for(const size of [16,32,48,128]) await writeFile(`${out}/icons/${size}.png`,icon(size));
const manifest=JSON.parse(await readFile(`${out}/manifest.json`,'utf8'));
console.log(`Built ${manifest.name} ${manifest.version}: ${snapshot.networkRules.toLocaleString()} static network rules, ${snapshot.cosmeticRules.toLocaleString()} cosmetic/script rules in ${snapshot.filters.length} lists (${snapshot.packageVersion}).`);
}
await stagedBuild(root, build, async stage => {
  const result = await promisify(execFile)(process.execPath, [`${root}scripts/validate.mjs`, '--dist', stage], { maxBuffer: 8 * 1024 * 1024 });
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
});
