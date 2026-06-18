import { TRANSLATE_CONFIG } from '../constants';

type MyMemoryResponse = {
  responseData?: { translatedText?: string };
  responseStatus?: number | string;
  responseDetails?: string;
};

/**
 * Translates any text to English.
 *
 * Priority:
 *   1. EXPO_PUBLIC_TRANSLATE_URL  – your own LibreTranslate-compatible endpoint (if set in .env)
 *   2. Google Translate unofficial – free, no key, works on all devices
 *   3. MyMemory                   – free fallback
 */
export async function translateToEnglish(text: string): Promise<string> {
  const q = (text ?? '').trim();
  if (!q) return '';

  // 1. Custom LibreTranslate endpoint -----------------------------------------------
  if (TRANSLATE_CONFIG.URL && TRANSLATE_CONFIG.URL.trim()) {
    const url = TRANSLATE_CONFIG.URL.trim();
    // Guardrail: libretranslate.com requires an API key; if it's configured, skip it
    // to avoid showing the portal error forever.
    if (/^https?:\/\/(www\.)?libretranslate\.com\/?/i.test(url)) {
      console.warn('[translate] EXPO_PUBLIC_TRANSLATE_URL points to libretranslate.com; skipping and using Google fallback.');
    } else {
      console.warn('[translate] Using custom translate URL:', url);
      return libreTranslate(url, q);
    }
  }

  // 2. Google Translate unofficial ---------------------------------------------------
  try {
    console.warn('[translate] Using Google fallback');
    return await googleTranslate(q);
  } catch (googleErr) {
    // Log and fall through to MyMemory
    console.warn('[translate] Google failed, trying MyMemory:', googleErr);
  }

  // 3. MyMemory fallback -------------------------------------------------------------
  console.warn('[translate] Using MyMemory fallback');
  return myMemoryTranslate(q);
}

async function libreTranslate(url: string, q: string): Promise<string> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), TRANSLATE_CONFIG.TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q, source: 'auto', target: 'en', format: 'text' }),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({})) as { translatedText?: string; error?: string };
    if (!res.ok) throw new Error(data?.error || `LibreTranslate HTTP ${res.status}`);
    return (data?.translatedText ?? '').trim() || q;
  } finally {
    clearTimeout(id);
  }
}

async function googleTranslate(q: string): Promise<string> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), TRANSLATE_CONFIG.TIMEOUT_MS);
  try {
    // Google's free unofficial endpoint — no key needed, widely reachable.
    const url =
      `https://translate.googleapis.com/translate_a/single` +
      `?client=gtx&sl=auto&tl=en&dt=t&q=${encodeURIComponent(q)}`;
    const res = await fetch(url, { method: 'GET', signal: controller.signal });
    if (!res.ok) throw new Error(`Google Translate HTTP ${res.status}`);
    // Response: [[[translated, original, ...], ...], null, detected_lang, ...]
    const data = await res.json().catch(() => null);
    if (!Array.isArray(data) || !Array.isArray(data[0])) {
      throw new Error('Google Translate: unexpected response shape');
    }
    const translated = (data[0] as Array<Array<string | null>>)
      .map((chunk) => (typeof chunk[0] === 'string' ? chunk[0] : ''))
      .join('')
      .trim();
    if (!translated) throw new Error('Google Translate: empty result');
    return translated;
  } finally {
    clearTimeout(id);
  }
}

async function myMemoryTranslate(q: string): Promise<string> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), TRANSLATE_CONFIG.TIMEOUT_MS);
  try {
    // "autodetect" (not "auto") is the valid value for automatic source detection.
    const url =
      `${TRANSLATE_CONFIG.MYMEMORY_URL}` +
      `?q=${encodeURIComponent(q)}&langpair=autodetect|en`;
    const res = await fetch(url, { method: 'GET', signal: controller.signal });
    const data = await res.json().catch(() => ({})) as MyMemoryResponse
    const status = Number(data?.responseStatus ?? 0);
    if (!res.ok || status !== 200) {
      const details = typeof data?.responseDetails === 'string' ? data.responseDetails.trim() : '';
      throw new Error(details || `MyMemory HTTP ${res.status} / API ${data?.responseStatus ?? '?'}`);
    }
    return (data?.responseData?.translatedText ?? '').trim() || q;
  } finally {
    clearTimeout(id);
  }
}
