/**
 * Arranque partilhado do Puppeteer (Chrome, headless, viewport).
 */
import puppeteer from 'puppeteer';
import path from 'path';
import { fileExists, detectSystemChrome, printChromeHelp, projectRoot } from './infnetShared.mjs';

/** @returns {string} */
export function resolveBrowserProfileDir() {
  const fromEnv = process.env.BROWSER_PROFILE_DIR?.trim();
  if (fromEnv) return path.resolve(fromEnv);
  return path.join(projectRoot, '.browser-profile');
}

/**
 * @param {{ headed?: boolean }} opts
 * @returns {Promise<string | undefined>}
 */
export async function resolveExecutablePath() {
  let executablePath = process.env.PUPPETEER_EXECUTABLE_PATH?.trim();
  if (executablePath && !(await fileExists(executablePath))) {
    console.error('[ERRO] PUPPETEER_EXECUTABLE_PATH não existe:', executablePath);
    printChromeHelp();
    throw new Error('PUPPETEER_EXECUTABLE_PATH inválido');
  }
  if (!executablePath) {
    executablePath = await detectSystemChrome();
  }
  return executablePath;
}

/**
 * @param {{ headed?: boolean; preferHeadlessUnlessHeaded?: boolean; forceHeaded?: boolean; forceHeadless?: boolean; userDataDir?: string }} opts
 * @description Com `preferHeadlessUnlessHeaded`, ignora `HEADLESS=0` no .env (útil para workers em cluster).
 */
export function buildLaunchOptions(opts = {}) {
  const headed = opts.headed ?? false;
  const preferHeadless = Boolean(opts.preferHeadlessUnlessHeaded);
  const showBrowser = opts.forceHeaded
    ? true
    : opts.forceHeadless
      ? false
      : preferHeadless
        ? headed
        : headed || process.env.HEADLESS === '0';
  if (showBrowser) {
    console.log('[UI] Browser visível (use --headed ou HEADLESS=0 no .env)');
  }
  return {
    showBrowser,
    launchOpts: {
      headless: !showBrowser,
      defaultViewport: showBrowser ? null : { width: 1280, height: 900 },
    },
  };
}

/**
 * @param {{ headed?: boolean; preferHeadlessUnlessHeaded?: boolean; forceHeaded?: boolean; forceHeadless?: boolean; userDataDir?: string }} opts
 * @returns {Promise<import('puppeteer').Browser>}
 */
export async function launchBrowser(opts = {}) {
  const executablePath = await resolveExecutablePath();
  const { showBrowser, launchOpts } = buildLaunchOptions(opts);
  try {
    return await puppeteer.launch({
      ...launchOpts,
      ...(opts.userDataDir ? { userDataDir: opts.userDataDir } : {}),
      ...(executablePath ? { executablePath } : {}),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('Could not find Chrome')) {
      printChromeHelp();
      throw new Error('Chrome não encontrado para o Puppeteer');
    }
    throw e;
  }
}
