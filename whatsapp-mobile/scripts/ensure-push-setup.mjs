#!/usr/bin/env node
/**
 * Validates Firebase / FCM setup before Android builds.
 *
 * Requirements for Expo push on Android:
 *  1. google-services.json exists with the correct android package.
 *  2. google-services.json project_id MUST match the Firebase project used for
 *     FCM v1 credentials uploaded to EAS (firebase.config.json → expectedFcmProjectId).
 *  3. The Android app must be registered in that Firebase project (not a hand-edited JSON).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const appJsonPath = path.join(projectRoot, 'app.json');
const firebaseConfigPath = path.join(projectRoot, 'firebase.config.json');
const googleServicesPath = path.join(projectRoot, 'google-services.json');

const checkOnly = process.argv.includes('--check');

function fail(message) {
  console.error(`\n[push-setup] ${message}\n`);
  process.exit(1);
}

function warn(message) {
  console.warn(`[push-setup] WARNING: ${message}`);
}

function readFirebaseConfig() {
  if (!fs.existsSync(firebaseConfigPath)) {
    return { expectedFcmProjectId: null, androidPackage: null, firebaseConsoleUrl: null };
  }
  try {
    return JSON.parse(fs.readFileSync(firebaseConfigPath, 'utf8'));
  } catch {
    fail('firebase.config.json is not valid JSON.');
  }
}

function readPackageName(firebaseConfig) {
  const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
  const pkg = appJson?.expo?.android?.package;
  if (!pkg) fail('android.package is missing from app.json');
  if (firebaseConfig.androidPackage && firebaseConfig.androidPackage !== pkg) {
    warn(`app.json package (${pkg}) differs from firebase.config.json (${firebaseConfig.androidPackage}).`);
  }
  return pkg;
}

function findFcmServiceAccountProjectId() {
  const files = fs.readdirSync(projectRoot).filter(
    (f) => f.endsWith('.json') && f.includes('firebase-adminsdk'),
  );
  for (const file of [...files, 'vacationsaga-429508-e3a2647cf1cb.json']) {
    const full = path.join(projectRoot, file);
    if (!fs.existsSync(full)) continue;
    try {
      const data = JSON.parse(fs.readFileSync(full, 'utf8'));
      if (data?.type === 'service_account' && data?.project_id) {
        return String(data.project_id);
      }
    } catch {
      // ignore
    }
  }
  return null;
}

function validateGoogleServices(packageName, firebaseConfig) {
  const consoleUrl =
    firebaseConfig.firebaseConsoleUrl ??
    (firebaseConfig.expectedFcmProjectId
      ? `https://console.firebase.google.com/project/${firebaseConfig.expectedFcmProjectId}/settings/general`
      : 'https://console.firebase.google.com/');

  if (!fs.existsSync(googleServicesPath)) {
    fail(
      'google-services.json is missing.\n' +
        `1. Open ${consoleUrl}\n` +
        '2. Add Android app (or select existing) with package: ' +
        packageName +
        '\n' +
        '3. Download google-services.json → whatsapp-mobile/google-services.json\n' +
        '4. Run: npx expo prebuild --platform android --clean && npm run android',
    );
  }

  let config;
  try {
    config = JSON.parse(fs.readFileSync(googleServicesPath, 'utf8'));
  } catch {
    fail('google-services.json is not valid JSON.');
  }

  const projectId = config?.project_info?.project_id;
  const expected = firebaseConfig.expectedFcmProjectId;
  const saProjectId = findFcmServiceAccountProjectId();

  if (expected && projectId && projectId !== expected) {
    fail(
      `Firebase project mismatch — notifications will NOT be delivered.\n` +
        `  google-services.json project_id: ${projectId}\n` +
        `  Expected (EAS FCM / firebase.config.json): ${expected}\n` +
        `Download google-services.json from the ${expected} Firebase project and rebuild.`,
    );
  }

  if (saProjectId && projectId && saProjectId !== projectId) {
    fail(
      `FCM service account project (${saProjectId}) does not match google-services.json (${projectId}).\n` +
        'Use credentials and google-services.json from the SAME Firebase project.',
    );
  }

  const clients = Array.isArray(config?.client) ? config.client : [];
  const match = clients.find(
    (c) => c?.client_info?.android_client_info?.package_name === packageName,
  );

  if (!match) {
    const found = clients
      .map((c) => c?.client_info?.android_client_info?.package_name)
      .filter(Boolean)
      .join(', ');
    fail(
      `google-services.json has no client for package "${packageName}".` +
        (found ? ` Found: ${found}.` : '') +
        `\nRegister this package in Firebase (${consoleUrl}) and re-download google-services.json.`,
    );
  }

  console.log(
    `[push-setup] OK — google-services.json: project=${projectId}, package=${packageName}`,
  );
  if (expected) {
    console.log(`[push-setup] FCM project alignment verified (${expected}).`);
  }
}

const firebaseConfig = readFirebaseConfig();
const packageName = readPackageName(firebaseConfig);
validateGoogleServices(packageName, firebaseConfig);

if (!checkOnly) {
  console.log(
    '[push-setup] Next: npx expo prebuild --platform android --clean && npm run android',
  );
  console.log(
    '[push-setup] EAS: upload FCM v1 key via `eas credentials` → Android → Google Service Account → FCM v1',
  );
}
