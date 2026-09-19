/**
 * Injects Maps + Firebase web API keys from the environment.
 * Copy .env.example to .env. Do not log the keys.
 */
const fs = require('fs');
const path = require('path');

function loadDotEnv() {
  const envPath = path.join(__dirname, '.env');
  let text = '';
  try {
    text = fs.readFileSync(envPath, 'utf8');
  } catch {
    return;
  }
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

loadDotEnv();

module.exports = () => {
  const appJson = require('./app.json');
  const expo = appJson.expo;
  const mapsKey = process.env.GOOGLE_MAPS_API_KEY?.trim() || '';
  const firebaseWebApiKey = process.env.FIREBASE_WEB_API_KEY?.trim() || '';

  return {
    ...expo,
    extra: {
      ...(expo.extra ?? {}),
      hasGoogleMaps: Boolean(mapsKey),
      firebaseWebApiKey,
    },
    android: {
      ...expo.android,
      config: {
        ...(expo.android?.config ?? {}),
        googleMaps: {
          apiKey: mapsKey,
        },
      },
    },
  };
};
