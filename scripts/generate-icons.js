import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const svgPath = path.resolve('public/easytraders-logo.svg');
const svgBuffer = fs.readFileSync(svgPath);

async function generate() {
  console.log('Generating PWA icons...');

  // 192x192 standard icon
  await sharp(svgBuffer)
    .resize(192, 192)
    .png()
    .toFile('public/pwa-192x192.png');
  console.log('Generated public/pwa-192x192.png');

  // 512x512 standard icon
  await sharp(svgBuffer)
    .resize(512, 512)
    .png()
    .toFile('public/pwa-512x512.png');
  console.log('Generated public/pwa-512x512.png');

  // 180x180 Apple Touch Icon
  await sharp(svgBuffer)
    .resize(180, 180)
    .png()
    .toFile('public/apple-touch-icon.png');
  console.log('Generated public/apple-touch-icon.png');

  // 512x512 maskable icon with safe-zone margin (15% padding)
  const innerIcon = await sharp(svgBuffer)
    .resize(380, 380)
    .toBuffer();

  await sharp({
    create: {
      width: 512,
      height: 512,
      channels: 4,
      background: { r: 12, g: 18, b: 30, alpha: 1 }, // #0c121e dark theme background
    },
  })
    .composite([
      {
        input: innerIcon,
        gravity: 'center',
      },
    ])
    .png()
    .toFile('public/pwa-maskable-512x512.png');
  console.log('Generated public/pwa-maskable-512x512.png');

  // Favicon (64x64)
  await sharp(svgBuffer)
    .resize(64, 64)
    .png()
    .toFile('public/favicon.png');
  console.log('Generated public/favicon.png');

  console.log('All PWA icons generated successfully!');
}

generate().catch((err) => {
  console.error('Error generating icons:', err);
  process.exit(1);
});
