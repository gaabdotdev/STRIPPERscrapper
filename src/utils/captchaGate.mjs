/**
 * Portão de captcha manual: browser visível, espera até redirecionamento, guarda sessão e fecha.
 */
import path from 'path';
import { launchBrowser, resolveBrowserProfileDir } from './browser.mjs';
import {
  projectRoot,
  loadSession,
  applySession,
  saveSession,
  login,
  gotoUrl,
  envTrim,
} from './infnetShared.mjs';

const DEFAULT_CLASSES_URL =
  'https://infnet.online/grupos/fundamentos-do-processamento-de-dados-26e1-26e2-93422564/infnet-ci-zoom-mettings/';

const CAPTCHA_SELECTORS = [
  '.g-recaptcha',
  'iframe[src*="recaptcha"]',
  'iframe[src*="hcaptcha"]',
  '.h-captcha',
  '[class*="captcha" i]',
  '[id*="captcha" i]',
  'input[name*="captcha" i]',
  '.cf-turnstile',
  'iframe[src*="challenges.cloudflare.com"]',
];

/** @returns {boolean} */
export function captchaGateEnabledFromEnv() {
  const ci = (process.env.CI || '').trim().toLowerCase();
  if (ci === 'true' || ci === '1') return false;
  const raw = (process.env.CAPTCHA_GATE ?? '1').trim().toLowerCase();
  return !(raw === '0' || raw === 'false' || raw === 'no' || raw === 'off');
}

/** @returns {number} */
export function captchaWaitMsFromEnv() {
  const n = parseInt(process.env.CAPTCHA_WAIT_MS || '120000', 10);
  return Number.isFinite(n) && n > 0 ? n : 60_000;
}

/** @returns {string} */
export function resolveGateTargetUrl() {
  return envTrim('CLASSES_URL') || DEFAULT_CLASSES_URL;
}

/** @param {string} url */
export function isLoginUrl(url) {
  try {
    const u = new URL(url);
    return u.pathname.includes('wp-login.php') || /\/login\/?$/i.test(u.pathname);
  } catch {
    return String(url).includes('wp-login.php');
  }
}

/**
 * @param {import('puppeteer').Page} page
 * @returns {Promise<boolean>}
 */
export async function pageHasCaptchaWidget(page) {
  return page.evaluate((selectors) => {
    for (const sel of selectors) {
      try {
        if (document.querySelector(sel)) return true;
      } catch {
        /* selector inválido */
      }
    }
    return false;
  }, CAPTCHA_SELECTORS);
}

/** @param {import('puppeteer').Page} page */
export async function pageIsCloudflareWait(page) {
  const title = await page.title();
  return /um momento|just a moment|attention required|checking your browser/i.test(title);
}

/** @param {import('puppeteer').Page} page */
export async function pageHasLoginFields(page) {
  return Boolean(
    await page.$(
      'input#user_login, input[name="log"], input[type="email"], input#user_pass, input[name="pwd"], input[type="password"]'
    )
  );
}

/**
 * @param {import('puppeteer').Page} page
 * @returns {Promise<boolean>}
 */
export async function isAuthChallengePage(page) {
  if (await pageIsCloudflareWait(page)) return true;
  if (await pageHasCaptchaWidget(page)) return true;
  if (isLoginUrl(page.url())) {
    return !(await pageHasLoginFields(page));
  }
  return false;
}

/** @param {unknown} err */
function isTransientPageError(err) {
  const msg = err instanceof Error ? err.message : String(err);
  return /Execution context was destroyed|Cannot find context|navigating|Target closed/i.test(
    msg
  );
}

/**
 * @param {import('puppeteer').Page} page
 * @returns {Promise<boolean | null>} null = navegação em curso, reavaliar
 */
async function safeIsAuthChallengePage(page) {
  try {
    return await isAuthChallengePage(page);
  } catch (e) {
    if (isTransientPageError(e)) return null;
    throw e;
  }
}

async function resolveChallengeState(page) {
  let state = await safeIsAuthChallengePage(page);
  let spins = 0;
  while (state === null && spins < 40) {
    await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15_000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 500));
    state = await safeIsAuthChallengePage(page);
    spins++;
  }
  return state;
}

/**
 * @param {import('puppeteer').Page} page
 * @param {{ timeoutMs?: number; pollMs?: number }} [opts]
 * @returns {Promise<boolean>} true se o desafio desapareceu a tempo
 */
export async function waitForAuthResolution(page, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const pollMs = opts.pollMs ?? 500;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const state = await safeIsAuthChallengePage(page);
    if (state === null) {
      await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {});
      await new Promise((r) => setTimeout(r, pollMs));
      continue;
    }
    if (!state) {
      await new Promise((r) => setTimeout(r, pollMs));
      const again = await safeIsAuthChallengePage(page);
      if (again === null || again === false) return true;
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return false;
}

/**
 * Abre browser visível, navega à URL alvo, espera resolução manual de login/captcha,
 * persiste `session.json` e fecha o browser.
 *
 * @param {{ targetUrl?: string; sessionPath?: string; user?: string; pass?: string; waitMs?: number }} [opts]
 */
export async function runCaptchaGate(opts = {}) {
  const targetUrl = opts.targetUrl || resolveGateTargetUrl();
  const sessionPath = opts.sessionPath || path.join(projectRoot, 'session.json');
  const user = opts.user ?? envTrim('FACULDADE_USER');
  const pass = opts.pass ?? envTrim('FACULDADE_PASS');
  const waitMs = opts.waitMs ?? captchaWaitMsFromEnv();
  const profileDir = resolveBrowserProfileDir();

  console.log(
    `[CAPTCHA] Browser visível — resolva login/captcha se necessário (máx. ${Math.round(waitMs / 1000)}s)…`
  );
  console.log('[CAPTCHA] URL alvo:', targetUrl);
  console.log('[CAPTCHA] Perfil Chrome (cookies Cloudflare):', profileDir);

  const browser = await launchBrowser({ forceHeaded: true, userDataDir: profileDir });
  const page = await browser.newPage();

  try {
    const session = await loadSession(sessionPath);
    if (session) await applySession(page, session);

    await gotoUrl(page, targetUrl, 800);

    let challenge = await resolveChallengeState(page);
    if (challenge === true) {
      if (await pageIsCloudflareWait(page).catch(() => false)) {
        console.log('[CAPTCHA] Cloudflare Turnstile — complete o desafio no browser…');
      } else if (isLoginUrl(page.url())) {
        console.log('[CAPTCHA] Página de login — aguardando Cloudflare/captcha ou preenchimento manual…');
      } else {
        console.log('[CAPTCHA] Captcha detectado — aguardando resolução no browser…');
      }
      const ok = await waitForAuthResolution(page, { timeoutMs: waitMs });
      if (!ok) {
        throw new Error(
          `[CAPTCHA] Timeout (${Math.round(waitMs / 1000)}s): Cloudflare/login/captcha não resolvido`
        );
      }
      await gotoUrl(page, targetUrl, 800).catch(() => {});
      challenge = await resolveChallengeState(page);
    }

    if (
      challenge === false &&
      isLoginUrl(page.url()) &&
      user &&
      pass &&
      (await pageHasLoginFields(page).catch(() => false))
    ) {
      console.log('[CAPTCHA] A submeter credenciais do .env…');
      try {
        await login(page, user, pass);
        await gotoUrl(page, targetUrl, 800);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.log('[CAPTCHA] Login automático falhou — complete no browser:', msg);
        const ok = await waitForAuthResolution(page, { timeoutMs: waitMs });
        if (!ok) {
          throw new Error(`[CAPTCHA] Timeout após falha de login automático (${Math.round(waitMs / 1000)}s)`);
        }
        await gotoUrl(page, targetUrl, 800).catch(() => {});
      }
      challenge = await resolveChallengeState(page);
    } else if (challenge === true) {
      console.log('[CAPTCHA] Aguardando conclusão manual no browser…');
      const ok = await waitForAuthResolution(page, { timeoutMs: waitMs });
      if (!ok) {
        throw new Error(
          `[CAPTCHA] Timeout (${Math.round(waitMs / 1000)}s): autenticação não concluída`
        );
      }
      await gotoUrl(page, targetUrl, 800).catch(() => {});
      challenge = await resolveChallengeState(page);
    } else if (challenge === false && !isLoginUrl(page.url())) {
      console.log('[CAPTCHA] Sessão válida — sem desafio de login/captcha.');
    }

    if (challenge === true || isLoginUrl(page.url())) {
      throw new Error('[CAPTCHA] Falha: ainda bloqueado em login/Cloudflare após a espera');
    }

    console.log('[CAPTCHA] Autenticação OK — a guardar sessão…');
    await saveSession(page, sessionPath);
    console.log('[CAPTCHA] Sessão guardada em', sessionPath);
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('[CAPTCHA]')) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`[CAPTCHA] ${msg}`);
  } finally {
    console.log('[CAPTCHA] A fechar browser — o scraper continua em headless.');
    await browser.close().catch(() => {});
  }
}
