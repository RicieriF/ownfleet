import { Stack } from 'expo-router';

export default function AppLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: '#09090b' },
        headerTintColor: '#fafafa',
        headerTitleStyle: { fontFamily: 'Manrope_600SemiBold', fontSize: 17 },
      }}
    />
  );
}
