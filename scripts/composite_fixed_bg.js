const sharp = require('sharp');
const fs = require('fs');

async function testPersonComposite() {
  const SIZE = 1000;
  const svg = `
  <svg width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}" xmlns="http://www.w3.org/2000/svg">
    <path d="
      M 500,28
      C 410,28 340,65 295,160
      C 270,230 280,310 295,380
      C 260,420 220,460 215,510
      C 210,570 240,630 280,700
      C 320,740 400,750 500,750
      C 600,750 680,740 720,700
      C 760,630 790,570 785,510
      C 780,460 740,420 705,380
      C 720,310 730,230 705,160
      C 660,65 590,28 500,28
      Z
    " fill="white" />
  </svg>
  `;

  const maskBuf = await sharp(Buffer.from(svg))
    .resize(SIZE, SIZE)
    .blur(6)
    .toBuffer();

  const idle = await sharp('public/avatar/character_idle.webp').resize(SIZE, SIZE).raw().toBuffer();
  const small = await sharp('public/avatar/character_mouth_small.webp').resize(SIZE, SIZE).raw().toBuffer();
  const wide = await sharp('public/avatar/character_mouth_wide.webp').resize(SIZE, SIZE).raw().toBuffer();
  const blink = await sharp('public/avatar/character_blink.webp').resize(SIZE, SIZE).raw().toBuffer();
  const mask = await sharp(maskBuf).raw().toBuffer();

  async function composite(foreground, filename) {
    const out = Buffer.alloc(SIZE * SIZE * 3);
    for (let i = 0; i < SIZE * SIZE; i++) {
      const alpha = mask[i * 4 + 3] / 255;
      const idx = i * 3;
      out[idx] = Math.round(idle[idx] * (1 - alpha) + foreground[idx] * alpha);
      out[idx+1] = Math.round(idle[idx+1] * (1 - alpha) + foreground[idx+1] * alpha);
      out[idx+2] = Math.round(idle[idx+2] * (1 - alpha) + foreground[idx+2] * alpha);
    }
    await sharp(out, { raw: { width: SIZE, height: SIZE, channels: 3 } })
      .webp({ quality: 95 })
      .toFile('public/avatar/' + filename);
  }

  await composite(small, 'char_small_fixedbg.webp');
  await composite(wide, 'char_wide_fixedbg.webp');
  await composite(blink, 'char_blink_fixedbg.webp');
  console.log('Fixed-bg images generated!');
}

testPersonComposite();
