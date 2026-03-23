/**
 * Proof of delivery screen.
 *
 * 1. Captures current GPS location (mandatory).
 * 2. Optionally takes a photo with the camera.
 * 3. If photo taken → uploads to presigned S3 URL, sends photo_key.
 * 4. Submits proof to backend → delivery completes.
 *
 * Important: geo_match failure does NOT block the flow (backend still completes
 * the delivery and sets geo_match=false). The courier is NOT informed of the mismatch.
 */
import { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Image,
  Alert,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { getCurrentLocation } from '@/services/location';
import { stopBackgroundLocationTask } from '@/services/location';
import { apiGet, apiPost } from '@/api/client';
import { ActiveDelivery } from '@/types';

interface UploadUrlResponse {
  upload_url: string;
  photo_key: string;
}

export default function ProofScreen() {
  const { deliveryId } = useLocalSearchParams<{ deliveryId: string }>();
  const router = useRouter();

  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [locationLoading, setLocationLoading] = useState(false);
  const [locationAcquired, setLocationAcquired] = useState(false);
  const [locCoords, setLocCoords] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);

  // Acquire location as soon as screen mounts (speed up UX)
  useEffect(() => {
    acquireLocation();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function acquireLocation() {
    setLocationLoading(true);
    try {
      const loc = await getCurrentLocation();
      setLocCoords({
        lat: loc.coords.latitude,
        lng: loc.coords.longitude,
        accuracy: loc.coords.accuracy ?? 50,
      });
      setLocationAcquired(true);
    } catch {
      Alert.alert('Геолокація', 'Не вдалося отримати координати. Спробуйте ще раз.');
    } finally {
      setLocationLoading(false);
    }
  }

  async function handleTakePhoto() {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Камера', 'Для фото потрібен доступ до камери.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
      allowsEditing: false,
    });
    if (!result.canceled && result.assets[0]) {
      setPhotoUri(result.assets[0].uri);
    }
  }

  async function handleSubmit() {
    if (!locCoords) {
      await acquireLocation();
      if (!locCoords) return;
    }

    setSubmitting(true);
    try {
      let photo_key: string | undefined;

      // Upload photo if taken
      if (photoUri) {
        try {
          const { upload_url, photo_key: key } = await apiGet<UploadUrlResponse>(
            `/api/v1/deliveries/${deliveryId}/upload-url`,
          );
          // S3 presigned PUT: upload raw file body (NOT FormData)
          const fileRes = await fetch(photoUri);
          const blob = await fileRes.blob();
          await fetch(upload_url, {
            method: 'PUT',
            headers: { 'Content-Type': 'image/jpeg' },
            body: blob,
          });
          photo_key = key;
        } catch {
          // Photo upload failure is non-blocking — submit proof without photo
        }
      }

      // Submit proof (geo mandatory, photo optional)
      await apiPost(`/api/v1/deliveries/${deliveryId}/proof`, {
        lat: locCoords.lat,
        lng: locCoords.lng,
        accuracy: locCoords.accuracy,
        captured_at: new Date().toISOString(),
        ...(photo_key ? { photo_key } : {}),
      });

      // Stop GPS after delivery
      await stopBackgroundLocationTask();

      Alert.alert('✅ Доставлено!', 'Замовлення успішно здано.', [
        { text: 'OK', onPress: () => router.replace('/(app)') },
      ]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Невідома помилка';
      Alert.alert('Помилка', `Не вдалося здати замовлення: ${msg}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Здача замовлення</Text>
        <Text style={styles.subtitle}>
          Підтвердьте доставку за допомогою геолокації. Фото — за бажанням.
        </Text>

        {/* Location status */}
        <View style={styles.locationBox}>
          {locationLoading ? (
            <View style={styles.locationRow}>
              <ActivityIndicator size="small" color="#6aaa84" />
              <Text style={styles.locationText}>Отримуємо координати...</Text>
            </View>
          ) : locationAcquired ? (
            <View style={styles.locationRow}>
              <Ionicons name="location" size={18} color="#6aaa84" />
              <Text style={styles.locationOk}>Геолокація отримана</Text>
            </View>
          ) : (
            <TouchableOpacity onPress={acquireLocation} style={styles.locationRetry}>
              <View style={styles.locationRow}>
                <Ionicons name="warning-outline" size={18} color="#f59e0b" />
                <Text style={styles.locationRetryText}>Натисніть для отримання координат</Text>
              </View>
            </TouchableOpacity>
          )}
        </View>

        {/* Photo section */}
        <View style={styles.photoSection}>
          {photoUri ? (
            <>
              <Image source={{ uri: photoUri }} style={styles.photoPreview} resizeMode="cover" />
              <TouchableOpacity onPress={() => setPhotoUri(null)} style={styles.removePhoto}>
                <Text style={styles.removePhotoText}>Видалити фото</Text>
              </TouchableOpacity>
            </>
          ) : (
            <TouchableOpacity style={styles.photoBtn} onPress={handleTakePhoto} activeOpacity={0.8}>
              <Ionicons name="camera-outline" size={36} color="#a1a1aa" style={{ marginBottom: 8 }} />
              <Text style={styles.photoBtnText}>Додати фото (необовʼязково)</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Submit */}
        <TouchableOpacity
          style={[
            styles.submitBtn,
            (!locationAcquired || submitting) && styles.submitBtnDisabled,
          ]}
          onPress={handleSubmit}
          disabled={!locationAcquired || submitting}
          activeOpacity={0.8}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.submitBtnText}>Підтвердити здачу</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#09090b' },
  content: { padding: 24, paddingBottom: 40 },
  title: { fontSize: 24, fontFamily: 'Manrope_700Bold', color: '#fafafa', marginBottom: 8 },
  subtitle: { fontSize: 15, color: '#71717a', lineHeight: 22, marginBottom: 28 },
  locationBox: {
    backgroundColor: '#18181b',
    borderRadius: 8,
    padding: 16,
    marginBottom: 20,
  },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  locationText: { color: '#a1a1aa', fontSize: 14 },
  locationOk: { color: '#22c55e', fontSize: 14, fontFamily: 'Manrope_500Medium' },
  locationRetry: { alignItems: 'center' },
  locationRetryText: { color: '#f59e0b', fontSize: 14 },
  photoSection: { marginBottom: 24 },
  photoBtn: {
    backgroundColor: '#18181b',
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#27272a',
    borderStyle: 'dashed',
    padding: 32,
    alignItems: 'center',
  },
  photoBtnText: { color: '#a1a1aa', fontSize: 15 },
  photoPreview: {
    width: '100%',
    height: 220,
    borderRadius: 8,
    marginBottom: 12,
  },
  removePhoto: { alignItems: 'center' },
  removePhotoText: { color: '#ef4444', fontSize: 14 },
  submitBtn: {
    backgroundColor: '#6aaa84',
    borderRadius: 6,
    paddingVertical: 20,
    alignItems: 'center',
  },
  submitBtnDisabled: { opacity: 0.5 },
  submitBtnText: { color: '#fff', fontSize: 18, fontFamily: 'Manrope_700Bold' },
});
