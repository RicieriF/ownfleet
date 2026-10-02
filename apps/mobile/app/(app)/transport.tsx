import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import {
  CameraView,
  useCameraPermissions,
  type BarcodeScanningResult,
} from "expo-camera";
import { SafeAreaView } from "react-native-safe-area-context";
import { TabBar } from "@/components/tab-bar";
import { apiGet, apiPost } from "@/api/client";
import type { DriverTransportTrip } from "@/types";
import {
  getCurrentLocation,
  requestLocationPermissions,
  startBackgroundLocationTask,
} from "@/services/location";
import {
  enqueuePassengerCheckEvent,
  flushTransportOutbox,
  getTransportOutboxStatus,
  type ConnectivityState,
} from "@/services/transport-outbox";
import { useAuthStore } from "@/store/auth";

type Passenger = DriverTransportTrip["passengers"][number];

export default function TransportScreen() {
  const accessToken = useAuthStore((state) => state.accessToken);
  const [trips, setTrips] = useState<DriverTransportTrip[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [connectivity, setConnectivity] = useState<ConnectivityState>("ONLINE");
  const [scanTarget, setScanTarget] = useState<{
    trip: DriverTransportTrip;
    passenger: Passenger;
  } | null>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const scanLockedRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      setTrips(
        await apiGet<DriverTransportTrip[]>("/api/v1/transport/driver/trips"),
      );
      setConnectivity((await getTransportOutboxStatus(true)).connectivity);
    } catch (error) {
      Alert.alert(
        "Transporte",
        error instanceof Error
          ? error.message
          : "Não foi possível carregar as viagens.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (accessToken) {
      void flushTransportOutbox(accessToken)
        .then((status) => setConnectivity(status.connectivity))
        .finally(() => refresh());
    } else {
      void refresh();
    }
  }, [accessToken, refresh]);

  async function startTrip(trip: DriverTransportTrip) {
    setBusyId(trip.id);
    try {
      if (!(await requestLocationPermissions())) {
        throw new Error("Autorize a localização para iniciar a viagem.");
      }
      await apiPost(`/api/v1/transport/trips/${trip.id}/start`);
      await startBackgroundLocationTask();
      await refresh();
    } catch (error) {
      Alert.alert(
        "Não foi possível iniciar",
        error instanceof Error ? error.message : "Tente novamente.",
      );
    } finally {
      setBusyId(null);
    }
  }

  async function requestBoard(trip: DriverTransportTrip, passenger: Passenger) {
    if (passenger.passenger.pickup_qr_required) {
      if (!permission?.granted) {
        const result = await requestPermission();
        if (!result.granted) {
          Alert.alert(
            "QR necessário",
            "A câmera é necessária para validar este embarque.",
          );
          return;
        }
      }
      scanLockedRef.current = false;
      setScanTarget({ trip, passenger });
      return;
    }
    await submitEvent(trip, passenger, "board");
  }

  async function submitEvent(
    trip: DriverTransportTrip,
    passenger: Passenger,
    type: "board" | "depart" | "dropoff",
    qrToken?: string,
  ) {
    setBusyId(passenger.id);
    setScanTarget(null);
    let queued = false;
    try {
      const location = await getCurrentLocation();
      await enqueuePassengerCheckEvent({
        trip_id: trip.id,
        trip_passenger_id: passenger.id,
        type,
        qr_token: qrToken,
        lat: location.coords.latitude,
        lng: location.coords.longitude,
        accuracy: location.coords.accuracy ?? undefined,
      });
      queued = true;
      if (accessToken) {
        const status = await flushTransportOutbox(accessToken);
        setConnectivity(status.connectivity);
        if (status.failed > 0) {
          Alert.alert(
            "Evento não validado",
            "Revise QR, localização ou autorização antes de tentar novamente.",
          );
        }
      }
      await refresh();
    } catch (error) {
      setConnectivity("OFFLINE");
      Alert.alert(
        queued ? "Salvo no dispositivo" : "Evento não registrado",
        queued
          ? "O evento será sincronizado na ordem correta quando a conexão voltar."
          : error instanceof Error
            ? error.message
            : "Não foi possível obter a localização.",
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>OPERAÇÃO ESCOLAR</Text>
          <Text style={styles.title}>Transporte</Text>
        </View>
        <View
          style={[
            styles.connection,
            connectivity !== "ONLINE" && styles.connectionOffline,
          ]}
        >
          <Text style={styles.connectionText}>{connectivity}</Text>
        </View>
      </View>
      {loading ? (
        <ActivityIndicator color="#f2b84b" style={{ marginTop: 80 }} />
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          {trips.length === 0 && (
            <Text style={styles.empty}>Nenhuma viagem atribuída.</Text>
          )}
          {trips.map((trip) => (
            <View key={trip.id} style={styles.tripCard}>
              <Text style={styles.route}>
                {trip.route?.name ?? "Rota sem nome"}
              </Text>
              <Text style={styles.vehicle}>
                {trip.vehicle
                  ? `${trip.vehicle.plate ?? trip.vehicle.name} · ${trip.vehicle.model ?? "veículo"}`
                  : "Veículo não atribuído"}
              </Text>
              {trip.status === "planned" && (
                <TouchableOpacity
                  style={styles.primary}
                  onPress={() => startTrip(trip)}
                  disabled={busyId === trip.id}
                >
                  <Text style={styles.primaryText}>INICIAR VIAGEM</Text>
                </TouchableOpacity>
              )}
              {trip.status === "active" &&
                trip.passengers.map((passenger) => (
                  <View key={passenger.id} style={styles.passengerCard}>
                    <View style={styles.passengerTop}>
                      <View>
                        <Text style={styles.passengerName}>
                          {passenger.passenger.name}
                        </Text>
                        <Text style={styles.stop}>
                          {passenger.status === "waiting"
                            ? passenger.pickup_stop?.name
                            : passenger.dropoff_stop?.name}
                        </Text>
                      </View>
                      <Text style={styles.state}>
                        {passenger.status.replace("_", " ").toUpperCase()}
                      </Text>
                    </View>
                    {passenger.status === "waiting" && (
                      <Action
                        label={
                          passenger.passenger.pickup_qr_required
                            ? "LER QR E EMBARCAR"
                            : "CONFIRMAR EMBARQUE"
                        }
                        busy={busyId === passenger.id}
                        onPress={() => requestBoard(trip, passenger)}
                      />
                    )}
                    {passenger.status === "boarded" && (
                      <Action
                        label="INICIAR DESLOCAMENTO"
                        busy={busyId === passenger.id}
                        onPress={() => submitEvent(trip, passenger, "depart")}
                      />
                    )}
                    {passenger.status === "in_transit" && (
                      <Action
                        label="CONFIRMAR CHEGADA"
                        busy={busyId === passenger.id}
                        onPress={() => submitEvent(trip, passenger, "dropoff")}
                      />
                    )}
                  </View>
                ))}
            </View>
          ))}
        </ScrollView>
      )}
      <TabBar />
      <Modal
        visible={!!scanTarget}
        animationType="slide"
        onRequestClose={() => setScanTarget(null)}
      >
        <View style={styles.scanner}>
          <CameraView
            style={StyleSheet.absoluteFill}
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={({ data }: BarcodeScanningResult) => {
              if (scanLockedRef.current) return;
              const target = scanTarget;
              if (target) {
                scanLockedRef.current = true;
                void submitEvent(target.trip, target.passenger, "board", data);
              }
            }}
          />
          <Text style={styles.scanLabel}>Aponte para o QR do passageiro</Text>
          <TouchableOpacity
            style={styles.cancel}
            onPress={() => setScanTarget(null)}
          >
            <Text style={styles.cancelText}>Cancelar</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function Action({
  label,
  busy,
  onPress,
}: {
  label: string;
  busy: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={styles.primary} onPress={onPress} disabled={busy}>
      {busy ? (
        <ActivityIndicator color="#111" />
      ) : (
        <Text style={styles.primaryText}>{label}</Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#11100e" },
  header: {
    padding: 20,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: "#2b2924",
  },
  eyebrow: {
    color: "#f2b84b",
    fontSize: 10,
    letterSpacing: 2,
    fontFamily: "JetBrainsMono_500Medium",
  },
  title: { color: "#faf9f6", fontSize: 30, fontFamily: "Manrope_700Bold" },
  connection: {
    backgroundColor: "#254d38",
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 20,
  },
  connectionOffline: { backgroundColor: "#713b2e" },
  connectionText: {
    color: "#fff",
    fontSize: 10,
    fontFamily: "JetBrainsMono_500Medium",
  },
  content: { padding: 16, gap: 16, paddingBottom: 100 },
  empty: { color: "#8d8a82", textAlign: "center", marginTop: 80 },
  tripCard: {
    backgroundColor: "#1b1916",
    borderRadius: 22,
    padding: 18,
    borderWidth: 1,
    borderColor: "#302d27",
    gap: 12,
  },
  route: { color: "#faf9f6", fontSize: 22, fontFamily: "Manrope_700Bold" },
  vehicle: { color: "#9d998f", fontSize: 13 },
  passengerCard: {
    backgroundColor: "#24211d",
    borderRadius: 18,
    padding: 16,
    gap: 14,
  },
  passengerTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
  },
  passengerName: {
    color: "#faf9f6",
    fontSize: 18,
    fontFamily: "Manrope_600SemiBold",
  },
  stop: { color: "#8d8a82", marginTop: 3 },
  state: {
    color: "#f2b84b",
    fontSize: 10,
    fontFamily: "JetBrainsMono_500Medium",
  },
  primary: {
    minHeight: 58,
    borderRadius: 15,
    backgroundColor: "#f2b84b",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  primaryText: {
    color: "#17130b",
    fontSize: 14,
    fontFamily: "Manrope_700Bold",
    letterSpacing: 0.5,
  },
  scanner: {
    flex: 1,
    backgroundColor: "#000",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 70,
  },
  scanLabel: {
    color: "#fff",
    backgroundColor: "rgba(0,0,0,.72)",
    padding: 14,
    borderRadius: 12,
    fontSize: 16,
  },
  cancel: {
    backgroundColor: "#fff",
    paddingHorizontal: 30,
    paddingVertical: 15,
    borderRadius: 14,
  },
  cancelText: { color: "#111", fontFamily: "Manrope_700Bold" },
});
