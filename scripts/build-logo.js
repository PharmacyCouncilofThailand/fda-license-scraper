/*
 * Turn the council seal as supplied — a big JPEG, olive on opaque white, with
 * wide empty margins — into the small transparent PNG the pages use.
 *
 *   node scripts/build-logo.js [source-image]
 *
 * Trims the margin, drops the white to transparency while keeping the seal's
 * own colour, and scales it down. Chromium's canvas does the pixel work, so
 * this needs no image library — Puppeteer is already here for the PDF.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const config = require('../src/config');

const SRC = process.argv[2] || path.join(__dirname, 'logo-source.jpg');
const OUT = path.join(__dirname, '..', 'public', 'logo.png');
const WIDTH = 240; // the sidebar draws it around 36px wide; 240 covers any zoom

const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png' };

(async () => {
  const type = MIME[path.extname(SRC).toLowerCase()];
  if (!type) throw new Error(`unsupported image: ${SRC}`);
  const dataUrl =
    `data:${type};base64,` + fs.readFileSync(SRC).toString('base64');

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: config.executablePath,
  });
  try {
    const page = await browser.newPage();
    const result = await page.evaluate(
      async (src, width) => {
        const img = new Image();
        img.src = src;
        await img.decode();

        const full = document.createElement('canvas');
        full.width = img.width;
        full.height = img.height;
        const fullCtx = full.getContext('2d', { willReadFrequently: true });
        fullCtx.drawImage(img, 0, 0);
        const pixels = fullCtx.getImageData(0, 0, img.width, img.height);
        const d = pixels.data;

        const lumAt = (i) =>
          (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) / 255;

        // 1. the margin: anything paler than this is background
        const PAPER = 0.93;
        let minX = img.width;
        let minY = img.height;
        let maxX = -1;
        let maxY = -1;
        let darkest = 1;
        for (let y = 0; y < img.height; y += 1) {
          for (let x = 0; x < img.width; x += 1) {
            const lum = lumAt((y * img.width + x) * 4);
            if (lum >= PAPER) continue;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
            if (lum < darkest) darkest = lum;
          }
        }
        if (maxX < 0) throw new Error('image is blank');

        // 2. white to transparent, the seal's own colour untouched. Alpha
        //    ramps from the darkest ink (opaque) to paper (clear), so the
        //    antialiased edge survives instead of turning into a hard bite.
        const range = Math.max(PAPER - darkest, 0.01);
        for (let i = 0; i < d.length; i += 4) {
          const alpha = (PAPER - lumAt(i)) / range;
          const a = Math.round(Math.min(Math.max(alpha, 0), 1) * 255);
          // A JPEG source leaves compression noise all over the paper; below
          // this it is dirt, not edge, and it would show on a white chip.
          d[i + 3] = a < 12 ? 0 : a;
        }
        fullCtx.putImageData(pixels, 0, 0);

        // 3. crop and scale in one draw
        const cropW = maxX - minX + 1;
        const cropH = maxY - minY + 1;
        const out = document.createElement('canvas');
        out.width = width;
        out.height = Math.round((cropH / cropW) * width);
        const outCtx = out.getContext('2d');
        outCtx.imageSmoothingQuality = 'high';
        outCtx.drawImage(
          full,
          minX, minY, cropW, cropH,
          0, 0, out.width, out.height
        );

        return {
          dataUrl: out.toDataURL('image/png'),
          source: `${img.width}x${img.height}`,
          cropped: `${cropW}x${cropH}`,
          output: `${out.width}x${out.height}`,
        };
      },
      dataUrl,
      WIDTH
    );

    fs.writeFileSync(OUT, Buffer.from(result.dataUrl.split(',')[1], 'base64'));
    console.log(
      `ok — ${result.source} → trimmed ${result.cropped} → ${result.output}, ` +
        `${fs.statSync(OUT).size} bytes`
    );
  } finally {
    await browser.close();
  }
})();
