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
