import React, { useRef, useState, useCallback } from 'react';
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
  ScrollView,
  Animated,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
} from 'react-native-vision-camera';
import * as FileSystem from 'expo-file-system';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

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

function CameraScreen() {
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
      <LinearGradient colors={['#2E1065', '#000000']} style={styles.container}>
        <Text style={styles.message}>We need camera access to continue.</Text>
        <TouchableOpacity style={styles.permissionButton} onPress={requestPermission}>
          <Text style={styles.permissionButtonText}>Grant permission</Text>
        </TouchableOpacity>
        <StatusBar style="light" />
      </LinearGradient>
    );
  }

  const device = step === STEP_FRONT ? frontDevice : backDevice;

  if (!device) {
    return (
      <LinearGradient colors={['#2E1065', '#000000']} style={styles.container}>
        <Text style={styles.message}>No camera device found.</Text>
        <StatusBar style="light" />
      </LinearGradient>
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
    <LinearGradient colors={['#2E1065', '#000000']} style={styles.container}>
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
    </LinearGradient>
  );
}


function StudentProfileScreen() {
  const stats = {
    attendance: 48, // Low attendance for demonstration
    modules: 5,
    rank: 'Top 10%',
  };

  const [selectedDay, setSelectedDay] = useState(0);
  const weekDays = [
    { day: 'Mon', date: '07' },
    { day: 'Tue', date: '08' },
    { day: 'Wed', date: '09' },
    { day: 'Thu', date: '10' },
    { day: 'Fri', date: '11' },
    { day: 'Sat', date: '12' },
    { day: 'Sun', date: '13' },
  ];

  const upcomingLessons = [
    { id: '1', title: 'Cybersecurity', time: '9:00 AM', room: 'Hall B', instructor: 'Dr. Smith' },
    { id: '2', title: 'Mobile Dev', time: '10:30 AM', room: 'Room 305', instructor: 'Dr. Brown' },
    { id: '3', title: 'Data Structures', time: '1:00 PM', room: 'Lab 2A', instructor: 'Prof. Miller' },
  ];

  function getAttendanceBadge(attendance) {
    if (attendance < 50) {
      return {
        bg: 'rgba(239, 68, 68, 0.15)',
        color: '#EF4444',
        text: 'Critical',
        icon: 'warning'
      };
    }
    if (attendance < 75) {
      return {
        bg: 'rgba(245, 158, 11, 0.15)',
        color: '#F59E0B',
        text: 'Caution',
        icon: 'alert-circle'
      };
    }
    return {
      bg: 'rgba(52, 211, 153, 0.15)',
      color: '#34D399',
      text: '+2%',
      icon: 'trending-up'
    };
  }

  const badge = getAttendanceBadge(stats.attendance);

  return (
    <LinearGradient colors={['#2E1065', '#000000']} style={styles.profileContainer}>
      <ScrollView contentContainerStyle={styles.profileContent} showsVerticalScrollIndicator={false}>
        <View style={styles.profileHeader}>
          <View style={styles.avatarPlaceholder}>
            <Ionicons name="person" size={40} color="#DDD6FE" />
          </View>
          <Text style={styles.profileName}>Marcus Young</Text>
          <Text style={styles.profileHandle}>Student ID: 2024-STU-01</Text>
        </View>

        <View style={styles.analyticsTitleRow}>
          <Text style={styles.analyticsTitle}>Dashboard</Text>
        </View>

        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{stats.attendance}%</Text>
            <Text style={styles.statLabel}>Attendance</Text>
            <View style={[styles.miniTrend, { backgroundColor: badge.bg }]}>
              <Ionicons name={badge.icon} size={12} color={badge.color} />
              <Text style={[styles.trendText, { color: badge.color }]}>{badge.text}</Text>
            </View>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{stats.modules}</Text>
            <Text style={styles.statLabel}>Modules</Text>
            <View style={[styles.miniTrend, { backgroundColor: 'rgba(167, 139, 250, 0.1)' }]}>
              <Text style={[styles.trendText, { color: '#A78BFA' }]}>Active</Text>
            </View>
          </View>
        </View>

        <View style={styles.timetableSection}>
          <Text style={styles.sectionTitle}>Weekly Schedule</Text>
          
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.calendarStrip}>
            {weekDays.map((d, i) => (
              <TouchableOpacity 
                key={i} 
                onPress={() => setSelectedDay(i)}
                style={[styles.calendarDay, selectedDay === i && styles.selectedCalendarDay]}
              >
                <Text style={[styles.calendarDayLabel, selectedDay === i && styles.selectedCalendarText]}>{d.day}</Text>
                <Text style={[styles.calendarDateLabel, selectedDay === i && styles.selectedCalendarText]}>{d.date}</Text>
                {selectedDay === i && <View style={styles.calendarDot} />}
              </TouchableOpacity>
            ))}
          </ScrollView>

          <Text style={styles.upcomingHeader}>Classes for Feb {weekDays[selectedDay].date}</Text>

          {upcomingLessons.map(lesson => (
            <TouchableOpacity key={lesson.id} style={styles.timetableCard}>
              <View style={styles.lessonTimeBox}>
                <Text style={styles.lessonTimeText}>{lesson.time}</Text>
              </View>
              <View style={styles.lessonInfo}>
                <Text style={styles.lessonTitle}>{lesson.title}</Text>
                <Text style={styles.lessonMetaText}>{lesson.room} • {lesson.instructor}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#A78BFA" />
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </LinearGradient>
  );
}


function LecturerProfileScreen() {
  // Mock Data based on Lecture / Attendance Schema
  const stats = {
    avgEngagement: 82,
    attendanceRate: 94,
    totalLectures: 24,
    activeStudents: 156,
  };

  // Engagement Heatmap Data (10 weeks * 7 days = 70 squares)
  const weeks = 20;
  const days = 7;
  const heatmapData = Array.from({ length: weeks * days }, () => Math.floor(Math.random() * 100));

  function getHeatmapColor(score) {
    if (score > 80) return '#A78BFA'; // Light Purple
    if (score > 60) return '#8B5CF6'; // Medium Purple
    if (score > 40) return '#7C3AED'; // Deep Purple
    if (score > 20) return '#6D28D9'; // Darker Purple
    return 'rgba(255,255,255,0.05)'; // Empty slot
  }

  return (
    <LinearGradient colors={['#2E1065', '#000000']} style={styles.profileContainer}>
      <ScrollView contentContainerStyle={styles.profileContent} showsVerticalScrollIndicator={false}>
        <View style={styles.profileHeader}>
          <View style={styles.avatarPlaceholder}>
            <Ionicons name="school" size={40} color="#DDD6FE" />
          </View>
          <Text style={styles.profileName}>Dr. Eleanor Vance</Text>
          <Text style={styles.profileHandle}>Lecturer ID: 8821-V</Text>
        </View>

        <View style={styles.analyticsTitleRow}>
          <Text style={styles.analyticsTitle}>Insights</Text>
        </View>

        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{stats.avgEngagement}%</Text>
            <Text style={styles.statLabel}>Engagement</Text>
            <View style={[styles.miniTrend, { backgroundColor: 'rgba(167, 139, 250, 0.2)' }]}>
              <Ionicons name="trending-up" size={12} color="#A78BFA" />
              <Text style={[styles.trendText, { color: '#A78BFA' }]}>+4%</Text>
            </View>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{stats.attendanceRate}%</Text>
            <Text style={styles.statLabel}>Attendance</Text>
            <View style={[styles.miniTrend, { backgroundColor: 'rgba(250, 204, 21, 0.1)' }]}>
              <Ionicons name="remove" size={12} color="#FACC15" />
              <Text style={[styles.trendText, { color: '#FACC15' }]}>Stable</Text>
            </View>
          </View>
        </View>

        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{stats.totalLectures}</Text>
            <Text style={styles.statLabel}>Lectures</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{stats.activeStudents}</Text>
            <Text style={styles.statLabel}>Students</Text>
          </View>
        </View>

        <View style={styles.heatmapCard}>
          <Text style={styles.graphLabel}>Activity (Last 20 Weeks)</Text>
          
          <View style={styles.heatmapWrapper}>
            <View style={styles.dayLabels}>
              <Text style={styles.dayLabelText}>M</Text>
              <Text style={styles.dayLabelText}></Text>
              <Text style={styles.dayLabelText}>W</Text>
              <Text style={styles.dayLabelText}></Text>
              <Text style={styles.dayLabelText}>F</Text>
              <Text style={styles.dayLabelText}></Text>
              <Text style={styles.dayLabelText}>S</Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.heatmapGrid}>
                {Array.from({ length: weeks }).map((_, weekIndex) => (
                  <View key={weekIndex} style={styles.heatmapColumn}>
                    {Array.from({ length: days }).map((_, dayIndex) => {
                      const score = heatmapData[weekIndex * days + dayIndex];
                      return (
                        <View 
                          key={dayIndex} 
                          style={[
                            styles.heatmapSquare, 
                            { backgroundColor: getHeatmapColor(score) }
                          ]} 
                        />
                      );
                    })}
                  </View>
                ))}
              </View>
            </ScrollView>
          </View>

          <View style={styles.heatmapLegend}>
            <Text style={styles.legendText}>Less</Text>
            {[20, 40, 60, 80].map(s => (
              <View key={s} style={[styles.heatmapSquareSmall, { backgroundColor: getHeatmapColor(s + 1) }]} />
            ))}
            <Text style={styles.legendText}>More</Text>
          </View>
        </View>


        <View style={styles.sessionCard}>
          <Text style={styles.graphLabel}>Next Session</Text>
          <View style={styles.sessionRow}>
            <View style={styles.sessionInfo}>
              <Text style={styles.sessionName}>Advanced Quantum Theory</Text>
              <Text style={styles.sessionMeta}>Room 402 • 10:30 AM</Text>
            </View>
            <View style={styles.sessionScore}>
              <Text style={styles.scoreValue}>88</Text>
              <Text style={styles.scoreLabel}>Target</Text>
            </View>
          </View>
        </View>
      </ScrollView>
    </LinearGradient>
  );
}



const Tab = createBottomTabNavigator();

export default function App() {
  return (
    <NavigationContainer>
      <Tab.Navigator
        screenOptions={({ route }) => ({
          tabBarIcon: ({ focused, color, size }) => {
            let iconName;
            if (route.name === 'Camera') {
              iconName = focused ? 'camera' : 'camera-outline';
            } else if (route.name === 'Student') {
              iconName = focused ? 'person' : 'person-outline';
            } else if (route.name === 'Lecturer') {
              iconName = focused ? 'school' : 'school-outline';
            }
            return <Ionicons name={iconName} size={size} color={color} />;
          },
          tabBarStyle: {
            backgroundColor: '#000',
            borderTopWidth: 0,
            height: Platform.OS === 'ios' ? 90 : 60,
            paddingBottom: Platform.OS === 'ios' ? 30 : 10,
          },
          tabBarActiveTintColor: '#fff',
          tabBarInactiveTintColor: '#666',
          headerShown: false,
        })}
      >
        <Tab.Screen name="Camera" component={CameraScreen} />
        <Tab.Screen name="Student" component={StudentProfileScreen} />
        <Tab.Screen name="Lecturer" component={LecturerProfileScreen} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}


const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  // ── Profile Screen Styles ──
  profileContainer: {
    flex: 1,
  },
  profileContent: {
    padding: 24,
    paddingTop: 80,
  },
  profileHeader: {
    alignItems: 'center',
    marginBottom: 40,
  },
  avatarPlaceholder: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(167, 139, 250, 0.2)',
  },
  profileName: {
    color: '#fff',
    fontSize: 26,
    fontWeight: '800',
  },
  profileHandle: {
    color: '#A78BFA',
    fontSize: 16,
    marginTop: 4,
    fontWeight: '500',
  },
  analyticsTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  analyticsTitle: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '700',
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  statCard: {
    backgroundColor: 'rgba(139, 92, 246, 0.12)',
    borderRadius: 20,
    padding: 18,
    width: '48%',
    borderWidth: 1,
    borderColor: 'rgba(167, 139, 250, 0.15)',
  },
  statValue: {
    color: '#fff',
    fontSize: 26,
    fontWeight: '800',
  },
  statLabel: {
    color: '#A78BFA',
    fontSize: 13,
    marginTop: 4,
    fontWeight: '600',
  },
  miniTrend: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    marginTop: 10,
  },
  trendText: {
    fontSize: 13,
    fontWeight: '800',
    marginLeft: 6,
  },
  heatmapCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderRadius: 20,
    padding: 20,
    marginBottom: 20,
  },
  graphLabel: {
    color: '#DDD6FE',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 16,
  },
  heatmapWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
  },
  heatmapGrid: {
    flexDirection: 'row',
  },
  dayLabels: {
    marginRight: 10,
    justifyContent: 'space-between',
    height: 126,
    paddingVertical: 2,
  },
  dayLabelText: {
    color: '#A78BFA',
    fontSize: 10,
    fontWeight: '600',
    height: 14,
  },
  heatmapColumn: {
    flexDirection: 'column',
    marginRight: 4,
  },
  heatmapSquare: {
    width: 14,
    height: 14,
    borderRadius: 3,
    marginBottom: 4,
  },
  heatmapLegend: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    marginTop: 16,
  },
  legendText: {
    color: '#A78BFA',
    fontSize: 11,
    marginHorizontal: 6,
  },
  heatmapSquareSmall: {
    width: 12,
    height: 12,
    borderRadius: 2,
    marginHorizontal: 2,
  },
  // ── Student Profile Styles ──
  timetableSection: {
    marginTop: 10,
    marginBottom: 40,
  },
  sectionTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 16,
  },
  timetableCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderRadius: 18,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.1)',
  },
  lessonTimeBox: {
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
    borderRadius: 12,
    padding: 10,
    width: 80,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lessonTimeText: {
    color: '#DDD6FE',
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  lessonTimeHourText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 2,
  },
  lessonTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  lessonMetaText: {
    color: '#C4B5FD', // Lighter purple for better legibility
    fontSize: 13,
    marginTop: 4,
    fontWeight: '500',
  },
  lessonInfo: {
    flex: 1,
    marginLeft: 16,
  },
  calendarStrip: {
    flexDirection: 'row',
    marginBottom: 20,
  },
  calendarDay: {
    width: 60,
    height: 75,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
    borderWidth: 1,
    borderColor: 'rgba(167, 139, 250, 0.1)',
  },
  selectedCalendarDay: {
    backgroundColor: '#8B5CF6',
    borderColor: '#A78BFA',
  },
  calendarDayLabel: {
    color: '#A78BFA',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  calendarDateLabel: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '800',
    marginTop: 2,
  },
  selectedCalendarText: {
    color: '#fff',
  },
  calendarDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#fff',
    marginTop: 4,
  },
  upcomingHeader: {
    color: '#DDD6FE',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 12,
    opacity: 0.8,
  },
  sessionCard: {
    backgroundColor: 'rgba(139, 92, 246, 0.08)',
    borderRadius: 20,
    padding: 20,
    borderLeftWidth: 4,
    borderLeftColor: '#8B5CF6',
    marginBottom: 60,
  },
  sessionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
  },
  sessionInfo: {
    flex: 1,
  },
  sessionName: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
  sessionMeta: {
    color: '#C4B5FD', // Lighter purple for better legibility
    fontSize: 14,
    marginTop: 4,
  },
  sessionScore: {
    alignItems: 'center',
    backgroundColor: 'rgba(139, 92, 246, 0.2)',
    paddingVertical: 10,
    paddingHorizontal: 15,
    borderRadius: 14,
    minWidth: 70,
  },
  scoreValue: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '800',
  },
  scoreLabel: {
    color: '#A78BFA',
    fontSize: 10,
    textTransform: 'uppercase',
    fontWeight: '700',
  },
  // ── Camera Screen Styles ──
  stepIndicator: {
    position: 'absolute',
    top: 70,
    left: 0,
    right: 0,
    zIndex: 10,
    alignItems: 'center',
  },
  stepText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 25,
    overflow: 'hidden',
  },
  camera: {
    flex: 1,
  },
  hiddenCamera: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
  },
  capturingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 20,
  },
  capturingText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
    marginTop: 15,
  },
  bottomBar: {
    position: 'absolute',
    bottom: 40,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  captureButton: {
    width: 84,
    height: 84,
    borderRadius: 42,
    borderWidth: 6,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
  },
  captureInner: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: '#fff',
  },
  previewMain: {
    flex: 1,
    width: '100%',
    overflow: 'hidden',
  },
  previewPip: {
    position: 'absolute',
    top: 70,
    right: 20,
    width: SCREEN_WIDTH * 0.32,
    height: SCREEN_WIDTH * 0.32 * 1.33,
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: 3,
    borderColor: '#fff',
    backgroundColor: '#111',
    zIndex: 30,
  },
  previewPipImage: {
    flex: 1,
  },
  previewBottomBar: {
    position: 'absolute',
    bottom: 50,
    left: 24,
    right: 24,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  retakeButton: {
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 30,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  retakeButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  sendButton: {
    paddingVertical: 16,
    paddingHorizontal: 40,
    borderRadius: 30,
    backgroundColor: '#8B5CF6',
    minWidth: 140,
    alignItems: 'center',
  },
  sendButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
  },
  sendButtonDisabled: {
    opacity: 0.5,
  },
  message: {
    textAlign: 'center',
    color: '#fff',
    fontSize: 18,
    marginTop: '60%',
    paddingHorizontal: 30,
  },
  permissionButton: {
    alignSelf: 'center',
    paddingVertical: 16,
    paddingHorizontal: 32,
    backgroundColor: '#8B5CF6',
    borderRadius: 30,
    marginTop: 20,
  },
  permissionButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
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


