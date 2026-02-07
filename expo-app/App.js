import { useRef, useState, useCallback, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  Image,
  Alert,
  Platform,
  Dimensions,
  ActivityIndicator,
  Animated,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
} from 'react-native-vision-camera';
import * as FileSystem from 'expo-file-system';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL ?? 'http://localhost:3000/api/analyse';
const VISION_BACKEND_URL = process.env.EXPO_PUBLIC_VISION_BACKEND_URL ?? 'http://localhost:3000/api/identify';
const SAVE_URL = process.env.EXPO_PUBLIC_SAVE_URL ?? 'http://localhost:3000/api/save';

const EMOTION_EMOJIS = {
  happy: '😊',
  surprise: '😲',
  fear: '😨',
  angry: '😠',
  sad: '😢',
  neutral: '😐',
  disgust: '🤢',
};

const EMOTION_COLORS = {
  happy: '#22C55E',
  surprise: '#F59E0B',
  fear: '#8B5CF6',
  angry: '#EF4444',
  sad: '#3B82F6',
  neutral: '#6B7280',
  disgust: '#10B981',
};

// Flow: 'back' → 'front' → 'preview'
const STEP_BACK = 'back';
const STEP_FRONT = 'front';
const STEP_PREVIEW = 'preview';

export default function App() {
  const { hasPermission, requestPermission } = useCameraPermission();
  const backDevice = useCameraDevice('back');
  const frontDevice = useCameraDevice('front');
  const cameraRef = useRef(null);

  const [step, setStep] = useState(STEP_BACK);
  const [backPhotoPath, setBackPhotoPath] = useState(null);
  const [frontPhotoPath, setFrontPhotoPath] = useState(null);
  const [backBase64, setBackBase64] = useState(null);
  const [frontBase64, setFrontBase64] = useState(null);
  const [sending, setSending] = useState(false);
  const [emotionData, setEmotionData] = useState(null);
  const [professorData, setProfessorData] = useState(null);
  const [saving, setSaving] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const successScale = useRef(new Animated.Value(0)).current;
  const successOpacity = useRef(new Animated.Value(0)).current;
  const pendingFront = useRef(false);

  // Auto-snap selfie once the front camera initialises
  const onInitialized = useCallback(async () => {
    if (!pendingFront.current || !cameraRef.current) return;
    pendingFront.current = false;
    try {
      await new Promise((r) => setTimeout(r, 400));
      const photo = await cameraRef.current.takePhoto();
      setFrontPhotoPath(photo.path);
      setStep(STEP_PREVIEW);
    } catch {
      // If auto-snap fails, let user retry
      setStep(STEP_BACK);
      setBackPhotoPath(null);
    }
  }, []);

  // Permission screen
  if (!hasPermission) {
    return (
      <View style={styles.container}>
        <Text style={styles.message}>We need camera access to continue.</Text>
        <TouchableOpacity style={styles.permissionButton} onPress={requestPermission}>
          <Text style={styles.permissionButtonText}>Grant permission</Text>
        </TouchableOpacity>
        <StatusBar style="light" />
      </View>
    );
  }

  const device = step === STEP_FRONT ? frontDevice : backDevice;

  if (!device) {
    return (
      <View style={styles.container}>
        <Text style={styles.message}>No camera device found.</Text>
        <StatusBar style="light" />
      </View>
    );
  }

  async function readAsBase64(path) {
    try {
      const uri = path.startsWith('file://') ? path : `file://${path}`;
      return await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
    } catch {
      // Fallback: try reading via fetch + blob
      const resp = await fetch(path.startsWith('file://') ? path : `file://${path}`);
      const blob = await resp.blob();
      return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const result = reader.result;
          // strip "data:...;base64," prefix
          resolve(result.split(',')[1] || result);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    }
  }

  async function handleCapture() {
    try {
      if (!cameraRef.current) return;
      const photo = await cameraRef.current.takePhoto();
      const photoPath = photo.path;

      if (step === STEP_BACK) {
        setBackPhotoPath(photoPath);
        // Switch to front camera — onInitialized will auto-snap
        pendingFront.current = true;
        setStep(STEP_FRONT);
      }
    } catch (e) {
      Alert.alert('Error', e?.message ?? 'Could not take photo');
    }
  }

  function handleRetake() {
    setBackPhotoPath(null);
    setFrontPhotoPath(null);
    setBackBase64(null);
    setFrontBase64(null);
    setEmotionData(null);
    setProfessorData(null);
    setStep(STEP_BACK);
  }

  async function handleSend() {
    if (!backPhotoPath || !frontPhotoPath) return;
    setSending(true);
    setEmotionData(null);
    setProfessorData(null);
    try {
      // Convert both to base64
      const [back64, front64] = await Promise.all([
        readAsBase64(backPhotoPath),
        readAsBase64(frontPhotoPath),
      ]);

      setBackBase64(back64);
      setFrontBase64(front64);

      const timestamp = new Date().toISOString();

      // Send both requests in parallel
      const [emotions, professor] = await Promise.all([
        // Front (selfie) → emotion analysis
        (async () => {
          try {
            const response = await fetch(BACKEND_URL, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ image: front64, timestamp }),
            });
            if (!response.ok) throw new Error(`Server responded with ${response.status}`);
            return await response.json();
          } catch (err) {
            console.warn('Emotion backend unavailable, using dummy data:', err.message);
            return [
              { label: 'surprise', score: 0.9360453486442566 },
              { label: 'fear', score: 0.023657215759158134 },
              { label: 'happy', score: 0.018095578998327255 },
              { label: 'angry', score: 0.009856591001152992 },
              { label: 'neutral', score: 0.004771077074110508 },
            ];
          }
        })(),
        // Back (scene) → professor identification
        (async () => {
          try {
            const response = await fetch(VISION_BACKEND_URL, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ image: back64, timestamp }),
            });
            if (!response.ok) throw new Error(`Server responded with ${response.status}`);
            return await response.json();
          } catch (err) {
            console.warn('Vision backend unavailable, using dummy data:', err.message);
            return {
              name: 'Dr. Smith',
              confidence: 0.92,
              department: 'Computer Science',
            };
          }
        })(),
      ]);

      setEmotionData(emotions);
      setProfessorData(professor);
    } catch (e) {
      Alert.alert('Send failed', e?.message ?? 'Unknown error');
    } finally {
      setSending(false);
    }
  }

  function resetToCamera() {
    setBackPhotoPath(null);
    setFrontPhotoPath(null);
    setBackBase64(null);
    setFrontBase64(null);
    setEmotionData(null);
    setProfessorData(null);
    setSaving(false);
    setShowSuccess(false);
    successScale.setValue(0);
    successOpacity.setValue(0);
    setStep(STEP_BACK);
  }

  async function handleSave() {
    if (!emotionData || !professorData) return;
    setSaving(true);
    try {
      // Collect top 2 emotions
      const topEmotions = emotionData.slice(0, 2).map((e) => ({
        label: e.label,
        score: e.score,
      }));

      const record = {
        emotions: topEmotions,
        professor: {
          name: professorData.name,
          confidence: professorData.confidence,
          department: professorData.department,
        },
        images: {
          front: frontBase64,
          back: backBase64,
        },
        timestamp: new Date().toISOString(),
      };

      try {
        const response = await fetch(SAVE_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(record),
        });
        if (!response.ok) throw new Error(`Server responded with ${response.status}`);
      } catch (err) {
        // Dummy fallback — just log while backend is not available
        console.warn('Save backend unavailable, data logged locally:', err.message);
        console.log('Record to save:', JSON.stringify({
          emotions: record.emotions,
          professor: record.professor,
          timestamp: record.timestamp,
          frontImageLength: record.images.front?.length,
          backImageLength: record.images.back?.length,
        }));
      }

      // Show checkmark animation
      setShowSuccess(true);
      Animated.parallel([
        Animated.spring(successScale, {
          toValue: 1,
          friction: 4,
          tension: 60,
          useNativeDriver: true,
        }),
        Animated.timing(successOpacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start(() => {
        // Hold for a moment, then fade out and reset
        setTimeout(() => {
          Animated.timing(successOpacity, {
            toValue: 0,
            duration: 400,
            useNativeDriver: true,
          }).start(() => {
            resetToCamera();
          });
        }, 1200);
      });
    } catch (e) {
      Alert.alert('Save failed', e?.message ?? 'Unknown error');
      setSaving(false);
    }
  }

  // ──── Preview screen ────
  if (step === STEP_PREVIEW && backPhotoPath && frontPhotoPath) {
    const topEmotion = emotionData?.[0];

    return (
      <View style={styles.container}>
        <StatusBar style="light" />

        {/* Back photo full screen */}
        <Image source={{ uri: `file://${backPhotoPath}` }} style={styles.previewMain} />

        {/* Front photo PIP */}
        <View style={styles.previewPip}>
          <Image source={{ uri: `file://${frontPhotoPath}` }} style={styles.previewPipImage} />
        </View>

        {/* Professor detection badge */}
        {professorData && (
          <View style={styles.professorBadge}>
            <Text style={styles.professorIcon}>🎓</Text>
            <View style={styles.professorInfo}>
              <Text style={styles.professorName}>{professorData.name}</Text>
              <Text style={styles.professorDept}>{professorData.department}</Text>
              <Text style={styles.professorConfidence}>
                {(professorData.confidence * 100).toFixed(0)}% match
              </Text>
            </View>
          </View>
        )}

        {/* Emotion results overlay */}
        {emotionData && (
          <View style={styles.emotionOverlay}>
            {/* Top emotion badge */}
            <View style={styles.topEmotionBadge}>
              <Text style={styles.topEmotionEmoji}>
                {EMOTION_EMOJIS[topEmotion.label] ?? '🤔'}
              </Text>
              <Text style={styles.topEmotionLabel}>
                {topEmotion.label.charAt(0).toUpperCase() + topEmotion.label.slice(1)}
              </Text>
              <Text style={styles.topEmotionScore}>
                {(topEmotion.score * 100).toFixed(1)}%
              </Text>
            </View>

            {/* All emotions breakdown */}
            <View style={styles.emotionList}>
              {emotionData.map((item) => (
                <View key={item.label} style={styles.emotionRow}>
                  <Text style={styles.emotionRowEmoji}>
                    {EMOTION_EMOJIS[item.label] ?? '🤔'}
                  </Text>
                  <Text style={styles.emotionRowLabel}>
                    {item.label.charAt(0).toUpperCase() + item.label.slice(1)}
                  </Text>
                  <View style={styles.emotionBarTrack}>
                    <View
                      style={[
                        styles.emotionBarFill,
                        {
                          width: `${Math.max(item.score * 100, 2)}%`,
                          backgroundColor:
                            EMOTION_COLORS[item.label] ?? '#5B21B6',
                        },
                      ]}
                    />
                  </View>
                  <Text style={styles.emotionRowScore}>
                    {(item.score * 100).toFixed(1)}%
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Bottom actions */}
        <View style={styles.previewBottomBar}>
          <TouchableOpacity style={styles.retakeButton} onPress={handleRetake}>
            <Text style={styles.retakeButtonText}>Retake</Text>
          </TouchableOpacity>

          {emotionData && professorData ? (
            <TouchableOpacity
              style={[styles.saveButton, saving && styles.saveButtonDisabled]}
              onPress={handleSave}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.saveButtonText}>Save</Text>
              )}
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.sendButton, sending && styles.sendButtonDisabled]}
              onPress={handleSend}
              disabled={sending}
            >
              {sending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.sendButtonText}>Send</Text>
              )}
            </TouchableOpacity>
          )}
        </View>

        {/* Success checkmark overlay */}
        {showSuccess && (
          <Animated.View
            style={[
              styles.successOverlay,
              { opacity: successOpacity },
            ]}
          >
            <Animated.View
              style={[
                styles.successCircle,
                { transform: [{ scale: successScale }] },
              ]}
            >
              <Text style={styles.successCheckmark}>✓</Text>
            </Animated.View>
            <Animated.Text style={[styles.successText, { opacity: successOpacity }]}>
              Saved!
            </Animated.Text>
          </Animated.View>
        )}
      </View>
    );
  }

  // ──── Camera screen (back or front) ────
  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      {step === STEP_FRONT && backPhotoPath ? (
        <>
          {/* Show frozen back photo while selfie is being captured */}
          <Image source={{ uri: `file://${backPhotoPath}` }} style={styles.camera} />
          <View style={styles.capturingOverlay}>
            <ActivityIndicator size="large" color="#fff" />
            <Text style={styles.capturingText}>Loading...</Text>
          </View>
          {/* Hidden camera for auto-snap */}
          <Camera
            ref={cameraRef}
            style={styles.hiddenCamera}
            device={device}
            isActive={true}
            photo={true}
            onInitialized={onInitialized}
          />
        </>
      ) : (
        <>
          {/* Step indicator */}
          <View style={styles.stepIndicator}>
            <Text style={styles.stepText}>Take a photo</Text>
          </View>

          <Camera
            ref={cameraRef}
            style={styles.camera}
            device={device}
            isActive={step === STEP_BACK}
            photo={true}
          />

          {/* Shutter */}
          <View style={styles.bottomBar}>
            <TouchableOpacity style={styles.captureButton} onPress={handleCapture}>
              <View style={styles.captureInner} />
            </TouchableOpacity>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  message: {
    flex: 1,
    color: '#fff',
    textAlign: 'center',
    textAlignVertical: 'center',
    paddingHorizontal: 24,
    fontSize: 16,
    marginTop: '50%',
  },
  permissionButton: {
    alignSelf: 'center',
    paddingVertical: 14,
    paddingHorizontal: 28,
    backgroundColor: '#fff',
    borderRadius: 24,
    marginBottom: '50%',
  },
  permissionButtonText: {
    color: '#000',
    fontSize: 16,
    fontWeight: '700',
  },

  // ── Camera screen ──
  stepIndicator: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 60 : 36,
    left: 0,
    right: 0,
    zIndex: 10,
    alignItems: 'center',
  },
  stepText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 20,
    overflow: 'hidden',
  },
  camera: {
    flex: 1,
    width: '100%',
    borderRadius: 20,
    overflow: 'hidden',
  },
  hiddenCamera: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
  },
  miniPip: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 110 : 86,
    right: 16,
    width: SCREEN_WIDTH * 0.25,
    height: SCREEN_WIDTH * 0.25 * 1.33,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: '#fff',
  },
  miniPipImage: {
    flex: 1,
    width: '100%',
  },
  capturingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 20,
  },
  capturingText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginTop: 12,
  },
  bottomBar: {
    position: 'absolute',
    bottom: Platform.OS === 'ios' ? 50 : 32,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  captureButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 5,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  captureInner: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#fff',
  },

  // ── Preview screen ──
  previewMain: {
    flex: 1,
    width: '100%',
    borderRadius: 20,
    overflow: 'hidden',
  },
  previewPip: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 60 : 36,
    right: 16,
    width: SCREEN_WIDTH * 0.3,
    height: SCREEN_WIDTH * 0.3 * 1.33,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 3,
    borderColor: '#000',
    backgroundColor: '#111',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
    elevation: 10,
  },
  previewPipImage: {
    flex: 1,
    width: '100%',
  },
  previewBottomBar: {
    position: 'absolute',
    bottom: Platform.OS === 'ios' ? 50 : 32,
    left: 24,
    right: 24,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  retakeButton: {
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 24,
    backgroundColor: '#fff',
  },
  retakeButtonText: {
    color: '#000',
    fontSize: 16,
    fontWeight: '700',
  },
  sendButton: {
    paddingVertical: 14,
    paddingHorizontal: 36,
    borderRadius: 24,
    backgroundColor: '#5B21B6',
    minWidth: 100,
    alignItems: 'center',
  },
  sendButtonDisabled: {
    opacity: 0.6,
  },
  sendButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  saveButton: {
    paddingVertical: 14,
    paddingHorizontal: 36,
    borderRadius: 24,
    backgroundColor: '#22C55E',
    minWidth: 100,
    alignItems: 'center',
  },
  saveButtonDisabled: {
    opacity: 0.6,
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },

  // ── Success overlay ──
  successOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
  },
  successCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#22C55E',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#22C55E',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 20,
  },
  successCheckmark: {
    color: '#fff',
    fontSize: 56,
    fontWeight: '800',
    marginTop: -2,
  },
  successText: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '700',
    marginTop: 20,
  },

  // ── Professor detection badge ──
  professorBadge: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 60 : 36,
    left: 16,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 14,
    maxWidth: SCREEN_WIDTH * 0.55,
  },
  professorIcon: {
    fontSize: 28,
    marginRight: 10,
  },
  professorInfo: {
    flexShrink: 1,
  },
  professorName: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
  },
  professorDept: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 12,
    fontWeight: '500',
    marginTop: 1,
  },
  professorConfidence: {
    color: '#22C55E',
    fontSize: 11,
    fontWeight: '700',
    marginTop: 2,
  },

  // ── Emotion results overlay ──
  emotionOverlay: {
    position: 'absolute',
    bottom: Platform.OS === 'ios' ? 110 : 90,
    left: 16,
    right: 16,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    borderRadius: 20,
    padding: 16,
    backdropFilter: 'blur(10px)',
  },
  topEmotionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255, 255, 255, 0.2)',
  },
  topEmotionEmoji: {
    fontSize: 32,
    marginRight: 10,
  },
  topEmotionLabel: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '800',
    marginRight: 8,
  },
  topEmotionScore: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 18,
    fontWeight: '600',
  },
  emotionList: {
    gap: 8,
  },
  emotionRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  emotionRowEmoji: {
    fontSize: 16,
    width: 24,
    textAlign: 'center',
  },
  emotionRowLabel: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
    width: 68,
    marginLeft: 6,
  },
  emotionBarTrack: {
    flex: 1,
    height: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: 4,
    marginHorizontal: 8,
    overflow: 'hidden',
  },
  emotionBarFill: {
    height: '100%',
    borderRadius: 4,
  },
  emotionRowScore: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 12,
    fontWeight: '600',
    width: 44,
    textAlign: 'right',
  },
});
