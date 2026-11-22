/**
 * Descompacta recursivamente ficheiros `.zip` em downloads/documents (ou DOCUMENTS_OUTPUT_DIR).
 */
import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import extract from 'extract-zip';
import { projectRoot, fileExists } from './infnetShared.mjs';

/** @returns {boolean} */
export function extractZipsEnabledFromEnv() {
  const raw = (process.env.EXTRACT_ZIPS ?? '1').trim().toLowerCase();
  return !(raw === '0' || raw === 'false' || raw === 'no' || raw === 'off');
}

/** @returns {string} */
export function resolveDocumentsOutputDir() {
  const fromEnv = process.env.DOCUMENTS_OUTPUT_DIR?.trim();
  if (fromEnv) return path.resolve(fromEnv);
  return path.join(projectRoot, 'downloads', 'documents');
}

/**
 * @param {string} dir
 * @param {string[]} [out]
 * @returns {Promise<string[]>}
 */
async function collectZipFiles(dir, out = []) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectZipFiles(full, out);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.zip')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * @param {string} destDir
 * @returns {Promise<boolean>}
 */
async function destDirHasContent(destDir) {
  try {
    const entries = await fs.readdir(destDir);
    return entries.length > 0;
  } catch {
    return false;
  }
}

/**
 * @param {{ rootDir?: string; skipExisting?: boolean; deleteAfter?: boolean; force?: boolean }} [opts]
 */
export async function extractDocumentsZips(opts = {}) {
  const rootDir = opts.rootDir || resolveDocumentsOutputDir();
  const skipExisting = opts.skipExisting ?? !opts.force;
  const deleteAfter = Boolean(opts.deleteAfter);

  if (!(await fileExists(rootDir))) {
    console.log('[ZIP] Pasta inexistente — nada a extrair:', rootDir);
    return { rootDir, total: 0, extracted: 0, skipped: 0, errors: 0 };
  }

  const zips = (await collectZipFiles(rootDir)).sort();
  let extracted = 0;
  let skipped = 0;
  let errors = 0;

  console.log('[ZIP] Raiz:', rootDir);
  console.log('[ZIP] Encontrados:', zips.length, 'ficheiro(s) .zip');

  for (const zipPath of zips) {
    const base = path.basename(zipPath, path.extname(zipPath));
    const destDir = path.join(path.dirname(zipPath), base);

    if (skipExisting && (await destDirHasContent(destDir))) {
      console.log('[ZIP] Skip (pasta já preenchida):', destDir);
      skipped++;
      continue;
    }

    await fs.mkdir(destDir, { recursive: true });
    try {
      await extract(zipPath, { dir: destDir });
      console.log('[ZIP] OK:', zipPath, '→', destDir);
      extracted++;
      if (deleteAfter) {
        await fs.unlink(zipPath);
        console.log('[ZIP] Removido:', zipPath);
      }
    } catch (e) {
      errors++;
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[ZIP] Erro em', zipPath, '—', msg);
    }
  }

  console.log(
    `[ZIP] Resumo: ${extracted} extraído(s), ${skipped} ignorado(s), ${errors} erro(s) (de ${zips.length})`
  );
  return { rootDir, total: zips.length, extracted, skipped, errors };
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const deleteAfter = args.includes('--delete-zip');
  const result = await extractDocumentsZips({ force, deleteAfter });
  if (result.errors > 0) process.exitCode = 1;
}

const isDirectRun =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  main().catch((e) => {
    console.error('[ZIP] Fatal:', e);
    process.exit(1);
  });
}
