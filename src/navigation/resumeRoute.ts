import AsyncStorage from '@react-native-async-storage/async-storage';

export const RESUME_ROUTE_KEY = '@gateauto/resumeRoute';

export type ResumeRouteName = 'Settings';

export function shouldResumeSettings(
  signedIn: boolean,
  resume: string | null | undefined,
): boolean {
  return Boolean(signedIn) && resume === 'Settings';
}

export async function rememberResumeRoute(
  name: ResumeRouteName,
): Promise<void> {
  await AsyncStorage.setItem(RESUME_ROUTE_KEY, name);
}

export async function clearResumeRoute(): Promise<void> {
  await AsyncStorage.removeItem(RESUME_ROUTE_KEY);
}

export async function consumeResumeRoute(): Promise<ResumeRouteName | null> {
  const raw = await AsyncStorage.getItem(RESUME_ROUTE_KEY);
  if (raw !== 'Settings') return null;
  await AsyncStorage.removeItem(RESUME_ROUTE_KEY);
  return 'Settings';
}
