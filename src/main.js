import { PlaywrightCrawler, log } from 'crawlee';
import fs from 'fs';
import csv from 'csv-parser';

// ==== CONFIGURACIÓN ====

const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36',
];

const INPUT_FILE = './src/productos_total.csv';
const OUTPUT_FILE = './src/productos_con_imagenes.csv';
const MISSING_FILE = './src/productos_sin_imagenes.csv';
const PROGRESS_FILE = './src/progress.json';

// ==== FUNCIONES ====

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

// Escribe fila en CSV, evita duplicar encabezado
function appendRowToCsv(filePath, row, headersWrittenSet) {
    const keys = Object.keys(row);
    const values = Object.values(row).map(v => `"${String(v || '').replace(/"/g, '""')}"`);

    if (!headersWrittenSet.has(filePath)) {
        if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) {
            fs.appendFileSync(filePath, keys.join('|') + '\n');
        }
        headersWrittenSet.add(filePath);
    }

    fs.appendFileSync(filePath, values.join('|') + '\n');
}

// Guardar y cargar progreso
function saveProgress(filePath, rowIndex) {
    fs.writeFileSync(filePath, JSON.stringify({ lastIndex: rowIndex }));
}

function loadProgress(filePath) {
    if (fs.existsSync(filePath)) {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        return data.lastIndex || 0;
    }
    return 0;
}

// Leer productos ya procesados para evitar duplicados
async function getProcessedProducts(filePath) {
    if (!fs.existsSync(filePath)) return new Set();
    const rows = await readRowsFromCsv(filePath);
    const processed = new Set();
    for (const row of rows) {
        // Usamos la descripción del producto como identificador
        processed.add(row["productos_descripcion"]);
    }
    return processed;
}

// ==== MAIN ====

const rows = await readRowsFromCsv(INPUT_FILE);
console.log(`Se cargaron ${rows.length} filas desde el CSV`);

const headersWritten = new Set();
const lastProcessedIndex = loadProgress(PROGRESS_FILE);
console.log(`Reanudando desde la fila ${lastProcessedIndex + 1}`);

// Cargar productos ya procesados
const processedProducts = await getProcessedProducts(OUTPUT_FILE);

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

        await page.waitForTimeout(1000 + Math.floor(Math.random() * 1000));

        const imageUrls = await page.$$eval('img', imgs =>
            imgs.map(img => img.src).filter(Boolean).slice(0, 3)
        );

        row.imagen1 = imageUrls[0] || '';
        row.imagen2 = imageUrls[1] || '';
        row.imagen3 = imageUrls[2] || '';

        if (imageUrls.length < 3) {
            appendRowToCsv(MISSING_FILE, row, headersWritten);
        }
        appendRowToCsv(OUTPUT_FILE, row, headersWritten);

        saveProgress(PROGRESS_FILE, rowIndex);

        await page.waitForTimeout(1000 + Math.floor(Math.random() * 1500));
    },
});

// Generar URLs filtrando solo filas pendientes y no procesadas
const startRequests = rows
    .map((row, index) => ({
        url: `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(row["productos_descripcion"].trim())}`,
        userData: { rowIndex: index }
    }))
    .filter(req => req.userData.rowIndex > lastProcessedIndex &&
        !processedProducts.has(rows[req.userData.rowIndex]["productos_descripcion"])
    );

console.log(`Se van a procesar ${startRequests.length} productos pendientes.`);

await crawler.run(startRequests);

console.log(`✅ Proceso terminado. 
- Resultados en: ${OUTPUT_FILE}
- Incompletos en: ${MISSING_FILE}`);



