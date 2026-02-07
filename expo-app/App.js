import { useRef, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  Image,
  Alert,
  TextInput,
  ScrollView,
  Platform,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { CameraView, useCameraPermissions } from 'expo-camera';
import {
  PresageEmotionView,
  inferEmotionFromVitals,
} from 'expo-presage-emotion';

const TAB_CAMERA = 'camera';
const TAB_EMOTION = 'emotion';

export default function App() {
  const [activeTab, setActiveTab] = useState(TAB_CAMERA);
  const [facing, setFacing] = useState('back');
  const [lastPhoto, setLastPhoto] = useState(null);
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef(null);

  // Presage emotion state
  const [presageApiKey, setPresageApiKey] = useState('');
  const [vitals, setVitals] = useState(null);
  const [emotion, setEmotion] = useState(null);

  function handleVitals(event) {
    const v = event.nativeEvent;
    setVitals(v);
    setEmotion(inferEmotionFromVitals(v));
  }

  if (!permission && activeTab === TAB_CAMERA) {
    return (
      <View style={styles.container}>
        <Text style={styles.message}>Loading camera…</Text>
        <StatusBar style="light" />
      </View>
    );
  }

  if (!permission?.granted && activeTab === TAB_CAMERA) {
    return (
      <View style={styles.container}>
        <Text style={styles.message}>We need camera access to take photos.</Text>
        <TouchableOpacity style={styles.permissionButton} onPress={requestPermission}>
          <Text style={styles.permissionButtonText}>Grant permission</Text>
        </TouchableOpacity>
        <StatusBar style="light" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tab, activeTab === TAB_CAMERA && styles.tabActive]}
          onPress={() => setActiveTab(TAB_CAMERA)}
        >
          <Text style={styles.tabText}>Camera</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === TAB_EMOTION && styles.tabActive]}
          onPress={() => setActiveTab(TAB_EMOTION)}
        >
          <Text style={styles.tabText}>Emotion</Text>
        </TouchableOpacity>
      </View>

      {activeTab === TAB_CAMERA && (
        <>
          <CameraView ref={cameraRef} style={styles.camera} facing={facing} />
          <View style={styles.controls}>
            <TouchableOpacity
              style={styles.flipButton}
              onPress={() => setFacing((c) => (c === 'back' ? 'front' : 'back'))}
            >
              <Text style={styles.flipButtonText}>Flip camera</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.captureButton}
              onPress={async () => {
                if (!cameraRef.current) return;
                try {
                  const photo = await cameraRef.current.takePicture();
                  setLastPhoto(photo);
                } catch (e) {
                  Alert.alert('Error', e?.message ?? 'Could not take photo');
                }
              }}
            />
          </View>
          {lastPhoto && (
            <View style={styles.previewContainer}>
              <Image source={{ uri: lastPhoto.uri }} style={styles.previewImage} />
              <Text style={styles.previewLabel}>Last photo</Text>
            </View>
          )}
        </>
      )}

      {activeTab === TAB_EMOTION && (
        <ScrollView style={styles.emotionScreen} contentContainerStyle={styles.emotionContent}>
          <Text style={styles.emotionTitle}>Presage emotion recognition</Text>
          <Text style={styles.emotionHint}>
            Uses Presage SmartSpectra vitals (pulse, breathing) to infer stress / calm / neutral.
            Get an API key at physiology.presagetech.com. Android development build required.
          </Text>
          <TextInput
            style={styles.input}
            placeholder="Presage API key"
            placeholderTextColor="#888"
            value={presageApiKey}
            onChangeText={setPresageApiKey}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <View style={styles.presageViewContainer}>
            <PresageEmotionView
              apiKey={presageApiKey}
              onVitals={handleVitals}
              style={styles.presageView}
            />
          </View>
          {(vitals || emotion) && (
            <View style={styles.vitalsCard}>
              {vitals && (
                <Text style={styles.vitalsText}>
                  Pulse: {vitals.pulseRate?.toFixed(1) ?? '—'} bpm · Breathing:{' '}
                  {vitals.breathingRate?.toFixed(1) ?? '—'} /min
                </Text>
              )}
              {emotion && (
                <Text style={[styles.emotionLabel, styles[`emotion_${emotion}`]]}>
                  {emotion}
                </Text>
              )}
            </View>
          )}
        </ScrollView>
      )}

      <StatusBar style="light" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  tabBar: {
    flexDirection: 'row',
    paddingTop: Platform.OS === 'ios' ? 52 : 24,
    paddingHorizontal: 16,
    paddingBottom: 8,
    backgroundColor: '#111',
    gap: 8,
  },
  tab: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  tabActive: {
    backgroundColor: '#0a84ff',
  },
  tabText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  message: {
    color: '#fff',
    textAlign: 'center',
    paddingHorizontal: 24,
    fontSize: 16,
  },
  permissionButton: {
    marginTop: 16,
    alignSelf: 'center',
    paddingVertical: 12,
    paddingHorizontal: 24,
    backgroundColor: '#0a84ff',
    borderRadius: 8,
  },
  permissionButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  camera: {
    flex: 1,
    width: '100%',
  },
  controls: {
    position: 'absolute',
    bottom: 48,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 32,
  },
  flipButton: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    backgroundColor: 'rgba(255,255,255,0.3)',
    borderRadius: 8,
  },
  flipButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  captureButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#fff',
    borderWidth: 4,
    borderColor: 'rgba(255,255,255,0.5)',
  },
  previewContainer: {
    position: 'absolute',
    top: 56,
    right: 16,
    alignItems: 'center',
  },
  previewImage: {
    width: 80,
    height: 80,
    borderRadius: 8,
    backgroundColor: '#333',
  },
  previewLabel: {
    color: '#fff',
    fontSize: 12,
    marginTop: 4,
  },
  emotionScreen: {
    flex: 1,
    backgroundColor: '#000',
  },
  emotionContent: {
    padding: 16,
    paddingBottom: 40,
  },
  emotionTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
  },
  emotionHint: {
    color: '#999',
    fontSize: 13,
    marginBottom: 16,
    lineHeight: 20,
  },
  input: {
    backgroundColor: '#222',
    color: '#fff',
    padding: 14,
    borderRadius: 8,
    fontSize: 16,
    marginBottom: 16,
  },
  presageViewContainer: {
    height: 320,
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 16,
  },
  presageView: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  vitalsCard: {
    backgroundColor: '#1a1a1a',
    padding: 16,
    borderRadius: 12,
  },
  vitalsText: {
    color: '#ccc',
    fontSize: 15,
    marginBottom: 8,
  },
  emotionLabel: {
    fontSize: 18,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  emotion_stressed: { color: '#ff6b6b' },
  emotion_calm: { color: '#69db7c' },
  emotion_neutral: { color: '#74c0fc' },
});
