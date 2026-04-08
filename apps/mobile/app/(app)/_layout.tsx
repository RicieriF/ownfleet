import { Stack } from 'expo-router';

export default function AppLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: '#0c0b09' },
        headerTintColor: '#faf9f6',
        headerTitleStyle: { fontFamily: 'Manrope_600SemiBold', fontSize: 17 },
      }}
    />
  );
}
