/**
 * ============================================================================
 * FIREBASE APP HOSTING / CLOUD RUN PRODUCTION RUNTIME SERVER
 * ============================================================================
 * Servidor HTTP nativo ultraligero sin dependencias externas (sin Express).
 * 
 * Cumple con las especificaciones de Cloud Run y Firebase App Hosting:
 * - Enlaza obligatoriamente al puerto definido por Cloud Run en `process.env.PORT`
 *   con fallback al puerto 8080 para ejecuciones locales.
 * - Enlaza al host 0.0.0.0 para recibir tráfico de contenedores.
 * - Sirve archivos estáticos desde ./dist
 * - Soporte SPA Fallback: cualquier ruta no encontrada resuelve a dist/index.html con HTTP 200.
 * - Bloqueo estricto de Path Traversal.
 * - Política de caché: index.html y service workers no se cachean de forma agresiva;
 *   assets con hash en /assets/ usan caché inmutable a largo plazo.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = Number(process.env.PORT || 8080);
const HOST = '0.0.0.0';
const DIST_DIR = path.resolve(__dirname, 'dist');
const INDEX_HTML_PATH = path.join(DIST_DIR, 'index.html');

// Mapeo exhaustivo de MIME types principales
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
};

/**
 * Determina los headers de Cache-Control según el tipo y ubicación del archivo.
 */
function getCacheControlHeader(relPath) {
  const normalized = relPath.toLowerCase();
  
  // Service Workers y archivo raíz HTML nunca deben quedar obsoletos en caché
  if (
    normalized === 'index.html' ||
    normalized === '/index.html' ||
    normalized.endsWith('sw.js') ||
    normalized.includes('firebase-messaging-sw.js')
  ) {
    return 'no-cache, no-store, must-revalidate';
  }

  // Assets estáticos de Vite con hash en su nombre son inmutables
  if (normalized.startsWith('/assets/') || normalized.startsWith('assets/')) {
    return 'public, max-age=31536000, immutable';
  }

  // Favicons, logos, manifests u otros estáticos
  return 'public, max-age=3600';
}

/**
 * Envía el archivo index.html para resolver rutas de Single Page Application (SPA).
 */
function serveSpaFallback(res, isHead) {
  if (!fs.existsSync(INDEX_HTML_PATH)) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Error interno: El directorio de distribución no contiene index.html. Ejecute npm run build.');
    return;
  }

  fs.stat(INDEX_HTML_PATH, (statErr, stats) => {
    if (statErr) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Error de lectura de index.html');
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': stats.size,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'X-Content-Type-Options': 'nosniff'
    });

    if (isHead) {
      res.end();
      return;
    }

    const stream = fs.createReadStream(INDEX_HTML_PATH);
    stream.pipe(res);
  });
}

const server = http.createServer((req, res) => {
  // Cloud Run / SPA solo responde a métodos GET y HEAD
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Método no permitido');
    return;
  }

  const isHead = req.method === 'HEAD';

  // Parsear URL preservando query strings
  let parsedUrl;
  try {
    parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  } catch (err) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('URL malformada');
    return;
  }

  let pathname = parsedUrl.pathname;

  // Decodificar caracteres URI
  try {
    pathname = decodeURIComponent(pathname);
  } catch (e) {
    // Si la URI está mal codificada, servir SPA fallback
    serveSpaFallback(res, isHead);
    return;
  }

  // Prevenir Path Traversal estrictamente:
  // Resolver la ruta solicitada estrictamente relativa a DIST_DIR
  const resolvedPath = path.resolve(DIST_DIR, '.' + pathname);

  // Si intenta escapar del directorio DIST_DIR, denegar acceso inmediatamente
  if (!resolvedPath.startsWith(DIST_DIR + path.sep) && resolvedPath !== DIST_DIR) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Acceso denegado');
    return;
  }

  // Si la ruta solicitada es la raíz o un directorio, servir SPA index.html directamente
  if (resolvedPath === DIST_DIR) {
    serveSpaFallback(res, isHead);
    return;
  }

  // Verificar si la ruta corresponde a un archivo real existente
  fs.stat(resolvedPath, (err, stats) => {
    if (!err && stats.isFile()) {
      // Es un archivo estático real (ej. /assets/index.js, /sw.js, /manifest.webmanifest, etc.)
      const ext = path.extname(resolvedPath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      const relativeToDist = path.relative(DIST_DIR, resolvedPath);
      const cacheControl = getCacheControlHeader(relativeToDist);

      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': stats.size,
        'Cache-Control': cacheControl,
        'X-Content-Type-Options': 'nosniff'
      });

      if (isHead) {
        res.end();
        return;
      }

      const fileStream = fs.createReadStream(resolvedPath);
      fileStream.on('error', () => {
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Error leyendo archivo');
        }
      });
      fileStream.pipe(res);
    } else {
      // No existe archivo específico en esa ruta -> Entregar SPA Fallback (index.html)
      // Permite que rutas de React Router (/login, /admin, /test-route, deep links, etc.)
      // sean resueltas por el cliente con HTTP 200.
      serveSpaFallback(res, isHead);
    }
  });
});

// Manejo de señales para parada limpia en Cloud Run
process.on('SIGTERM', () => {
  console.log('[EasyTraders24 Server] SIGTERM recibido. Cerrando servidor...');
  server.close(() => {
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('[EasyTraders24 Server] SIGINT recibido. Cerrando servidor...');
  server.close(() => {
    process.exit(0);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`[EasyTraders24 Server] Servidor de producción escuchando en http://${HOST}:${PORT}`);
  console.log(`[EasyTraders24 Server] Sirviendo archivos estáticos desde: ${DIST_DIR}`);
});
