const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const SRC = path.join('Imagenes', 'Iconos', 'icono', 'icono.png');
const PNG_OUT = 'icon.png';
const ICO_OUT = 'icon.ico';
const SIZE = 256;

const APP_BUILDER = path.join(
  'node_modules', 'app-builder-bin', 'win', 'x64', 'app-builder.exe'
);

function ps(script) {
  execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
    stdio: 'inherit'
  });
}

function main() {
  if (!fs.existsSync(SRC)) {
    throw new Error(`No se encuentra el icono fuente: ${SRC}`);
  }
  if (!fs.existsSync(APP_BUILDER)) {
    throw new Error(
      `No se encuentra ${APP_BUILDER}. Ejecuta "npm install" antes de regenerar el icono.`
    );
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'centinela-icon-'));
  const src = path.resolve(SRC);
  const pngOut = path.resolve(PNG_OUT);

  const psScript = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$src = [System.Drawing.Bitmap]::FromFile('${src}')
$bmp = [System.Drawing.Bitmap]::new(${SIZE}, ${SIZE}, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$bmp.SetResolution(96, 96)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$g.Clear([System.Drawing.Color]::Black)
$g.DrawImage($src, 0, 0, ${SIZE}, ${SIZE})
$g.Dispose()
$bmp.Save('${pngOut}', [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
$src.Dispose()
`;

  try {
    ps(psScript);

    execFileSync(APP_BUILDER, [
      'icon',
      '--format', 'ico',
      '--input', pngOut,
      '--out', tmp
    ], { stdio: 'inherit' });

    const generated = path.join(tmp, 'icon.ico');
    if (!fs.existsSync(generated)) {
      throw new Error('app-builder no generó el archivo icon.ico');
    }
    fs.copyFileSync(generated, path.resolve(ICO_OUT));

    console.log(`${PNG_OUT}: ${fs.statSync(PNG_OUT).size} bytes (${SIZE}x${SIZE})`);
    console.log(`${ICO_OUT}: ${fs.statSync(ICO_OUT).size} bytes (${SIZE}x${SIZE})`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main();
