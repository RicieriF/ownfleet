import { Stack } from 'expo-router';
import { View, StyleSheet } from 'react-native';
import { ManagerTabBar } from '@/components/manager-tab-bar';

export default function ManagerLayout() {
  return (
    <View style={styles.root}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="orders" />
        <Stack.Screen name="map" />
        <Stack.Screen name="shifts" />
        <Stack.Screen name="analytics" />
        <Stack.Screen name="couriers" />
        <Stack.Screen name="history" />
        <Stack.Screen name="settings" />
        <Stack.Screen name="telegram" />
      </Stack>
      <ManagerTabBar />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0c0b09',
  },
});
