import { PlaywrightCrawler, log } from 'crawlee';
import fs from 'fs';
import csv from 'csv-parser';

// ==== CONFIGURACIÓN ====

// Lista de User-Agents simulando distintos navegadores
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36',
];

// Archivos
const INPUT_FILE = './src/productos_total.csv';
const OUTPUT_FILE = './src/productos_con_imagenes.csv';
const MISSING_FILE = './src/productos_sin_imagenes.csv';

// ==== FUNCIONES ====

// Leer CSV como array de objetos
async function readRowsFromCsv(filePath) {
    return new Promise((resolve, reject) => {
        const rows = [];
        fs.createReadStream(filePath)
            .pipe(csv({ separator: '|' }))
            .on('data', (row) => rows.push(row))
            .on('end', () => resolve(rows))
            .on('error', reject);
    });
}

// Escribir fila en CSV (crea encabezado si es la primera vez)
function appendRowToCsv(filePath, row, headersWrittenSet) {
    const keys = Object.keys(row);
    const values = Object.values(row).map(v => `"${String(v || '').replace(/"/g, '""')}"`);

    if (!headersWrittenSet.has(filePath)) {
        fs.appendFileSync(filePath, keys.join('|') + '\n');
        headersWrittenSet.add(filePath);
    }

    fs.appendFileSync(filePath, values.join('|') + '\n');
}

// ==== MAIN ====

const rows = await readRowsFromCsv(INPUT_FILE);
console.log(`Se cargaron ${rows.length} filas desde el CSV`);

// Track de encabezados ya escritos
const headersWritten = new Set();

const crawler = new PlaywrightCrawler({
    maxConcurrency: 2,
    maxRequestsPerCrawl: rows.length,

    launchContext: {
        launchOptions: {
            args: [
                `--user-agent=${USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]}`,
            ],
        },
    },

    preNavigationHooks: [
        async ({ page }) => {
            await page.setExtraHTTPHeaders({
                'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
            });
            const delay = 2000 + Math.floor(Math.random() * 3000);
            await page.waitForTimeout(delay);
        }
    ],

    requestHandler: async ({ page, request, log }) => {
        const { rowIndex } = request.userData;
        const row = rows[rowIndex];

        log.info(`Procesando: ${row["productos_descripcion"]}`);

        await page.waitForTimeout(2000 + Math.floor(Math.random() * 2000));

        const imageUrls = await page.$$eval('img', imgs =>
            imgs.map(img => img.src).filter(Boolean).slice(0, 3)
        );

        row.imagen1 = imageUrls[0] || '';
        row.imagen2 = imageUrls[1] || '';
        row.imagen3 = imageUrls[2] || '';

        // Guardar en archivo correspondiente
        if (imageUrls.length < 3) {
            appendRowToCsv(MISSING_FILE, row, headersWritten);
        }
        appendRowToCsv(OUTPUT_FILE, row, headersWritten);

        await page.waitForTimeout(1500 + Math.floor(Math.random() * 3000));
    },
});

// Generar URLs con índice de fila
const startRequests = rows.map((row, index) => ({
    url: `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(row["productos_descripcion"].trim())}`,
    userData: { rowIndex: index }
}));

// Ejecutar
await crawler.run(startRequests);

console.log(`✅ Proceso terminado. 
- Resultados en: ${OUTPUT_FILE}
- Incompletos en: ${MISSING_FILE}`);
