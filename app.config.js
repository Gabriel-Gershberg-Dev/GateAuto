/**
 * Reads GOOGLE_MAPS_API_KEY from the environment when set; otherwise uses
 * android.config.googleMaps.apiKey from app.json. Do not log the key.
 */
module.exports = () => {
  const appJson = require('./app.json');
  const expo = appJson.expo;
  const fromEnv = process.env.GOOGLE_MAPS_API_KEY?.trim();
  const fromConfig = expo.android?.config?.googleMaps?.apiKey?.trim();
  const apiKey = fromEnv || fromConfig || '';

  return {
    ...expo,
    extra: {
      ...(expo.extra ?? {}),
      // Boolean only — never put the API key in extra.
      hasGoogleMaps: Boolean(apiKey),
    },
    android: {
      ...expo.android,
      config: {
        ...(expo.android?.config ?? {}),
        googleMaps: {
          apiKey,
        },
      },
    },
  };
};
