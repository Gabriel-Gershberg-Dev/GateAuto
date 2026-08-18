import type { ThemeColors } from './theme';

type MapStyleElement = {
  elementType?: string;
  featureType?: string;
  stylers: Array<Record<string, string | number>>;
};

/**
 * Cabin-teal street map — roads and names stay readable; POI clutter stays off.
 * Contrast is high enough that this still looks like a real Google Map.
 */
export function gateMapStyle(
  scheme: 'light' | 'dark',
  colors: ThemeColors,
): MapStyleElement[] {
  if (scheme === 'dark') {
    return [
      { elementType: 'geometry', stylers: [{ color: '#0C1213' }] },
      { elementType: 'labels.text.fill', stylers: [{ color: '#E8F4F1' }] },
      { elementType: 'labels.text.stroke', stylers: [{ color: '#030607' }] },
      {
        featureType: 'administrative',
        elementType: 'geometry',
        stylers: [{ visibility: 'off' }],
      },
      {
        featureType: 'administrative.locality',
        elementType: 'labels.text.fill',
        stylers: [{ color: '#C5D6D2' }],
      },
      {
        featureType: 'poi',
        stylers: [{ visibility: 'off' }],
      },
      {
        featureType: 'transit',
        stylers: [{ visibility: 'off' }],
      },
      {
        featureType: 'road',
        elementType: 'geometry',
        stylers: [{ color: '#4A6864' }],
      },
      {
        featureType: 'road.local',
        elementType: 'geometry',
        stylers: [{ color: '#2A3C3C' }],
      },
      {
        featureType: 'road.arterial',
        elementType: 'geometry',
        stylers: [{ color: '#5A7A74' }],
      },
      {
        featureType: 'road.highway',
        elementType: 'geometry',
        stylers: [{ color: '#6A9188' }],
      },
      {
        featureType: 'road',
        elementType: 'labels',
        stylers: [{ visibility: 'on' }],
      },
      {
        featureType: 'road',
        elementType: 'labels.text.fill',
        stylers: [{ color: '#F4FBF9' }],
      },
      {
        featureType: 'road',
        elementType: 'labels.icon',
        stylers: [{ visibility: 'off' }],
      },
      {
        featureType: 'water',
        elementType: 'geometry',
        stylers: [{ color: '#0A1C1C' }],
      },
      {
        featureType: 'landscape.man_made',
        elementType: 'geometry',
        stylers: [{ color: '#121A1C' }],
      },
    ];
  }

  return [
    { elementType: 'geometry', stylers: [{ color: '#E8EEEC' }] },
    { elementType: 'labels.text.fill', stylers: [{ color: '#5A6B68' }] },
    { elementType: 'labels.text.stroke', stylers: [{ color: '#F3F6F5' }] },
    {
      featureType: 'administrative',
      elementType: 'geometry',
      stylers: [{ visibility: 'off' }],
    },
    {
      featureType: 'poi',
      stylers: [{ visibility: 'off' }],
    },
    {
      featureType: 'transit',
      stylers: [{ visibility: 'off' }],
    },
    {
      featureType: 'road',
      elementType: 'geometry',
      stylers: [{ color: '#FFFFFF' }],
    },
    {
      featureType: 'road.arterial',
      elementType: 'geometry',
      stylers: [{ color: '#D4E4E2' }],
    },
    {
      featureType: 'road.highway',
      elementType: 'geometry',
      stylers: [{ color: '#C5D4D1' }],
    },
    {
      featureType: 'road',
      elementType: 'labels',
      stylers: [{ visibility: 'on' }],
    },
    {
      featureType: 'road',
      elementType: 'labels.text.fill',
      stylers: [{ color: colors.primary }],
    },
    {
      featureType: 'road',
      elementType: 'labels.icon',
      stylers: [{ visibility: 'off' }],
    },
    {
      featureType: 'water',
      elementType: 'geometry',
      stylers: [{ color: '#C5D9D6' }],
    },
    {
      featureType: 'landscape.man_made',
      elementType: 'geometry',
      stylers: [{ color: '#DEE6E4' }],
    },
  ];
}
