import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  SafeAreaView,
  ActivityIndicator,
  Alert,
  Animated,
  Platform,
  Pressable,
  FlatList,
  TextInput,
} from 'react-native';
import MapView, { Polyline, Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import Slider from '@react-native-community/slider';
import * as Location from 'expo-location';
import Svg, { Polygon, Path } from 'react-native-svg';
import { getRoute, triggerBailout, triggerEmergencyBeacon, getActiveHazards, resolveHazardCondition } from '../services/api';
import HazardReportModal from '../components/HazardReportModal';
import ConvoyOverlay from '../components/ConvoyOverlay';

/**
 * RadarPulse Component for custom concentric sonar sweep animations.
 */
const RadarPulse = ({ color, size }) => {
  const pulse1 = useRef(new Animated.Value(0)).current;
  const pulse2 = useRef(new Animated.Value(0)).current;
  const pulse3 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const createPulseAnimation = (value) => {
      return Animated.loop(
        Animated.timing(value, {
          toValue: 1,
          duration: 2500,
          useNativeDriver: true,
        })
      );
    };

    const anim = Animated.parallel([
      createPulseAnimation(pulse1),
      Animated.sequence([
        Animated.delay(800),
        createPulseAnimation(pulse2),
      ]),
      Animated.sequence([
        Animated.delay(1600),
        createPulseAnimation(pulse3),
      ]),
    ]);

    anim.start();

    return () => anim.stop();
  }, [pulse1, pulse2, pulse3]);

  const renderRing = (animValue) => {
    const scale = animValue.interpolate({
      inputRange: [0, 1],
      outputRange: [26 / size, 1.0],
    });
    const opacity = animValue.interpolate({
      inputRange: [0, 0.8, 1],
      outputRange: [0.6, 0.3, 0],
    });

    return (
      <Animated.View
        style={[
          styles.pulseRing,
          {
            borderColor: color,
            width: size,
            height: size,
            borderRadius: size / 2,
            transform: [{ scale }],
            opacity,
          },
        ]}
      />
    );
  };

  return (
    <View style={styles.pulseContainer}>
      {renderRing(pulse1)}
      {renderRing(pulse2)}
      {renderRing(pulse3)}
    </View>
  );
};

/**
 * Custom Hazard Marker utilizing react-native-svg shapes and RadarPulse sweeps.
 */
const HazardMarker = ({ hazard, onPress }) => {
  const isCritical = hazard.severity === 'CRITICAL';
  const color = isCritical ? '#FF3333' : '#FFCC00';

  return (
    <Marker
      coordinate={hazard.coordinate}
      onPress={() => onPress(hazard)}
      anchor={{ x: 0.5, y: 0.5 }}
      style={{ width: 96, height: 96 }}
    >
      <View style={styles.hazardMarkerWrapper}>
        <RadarPulse color={color} size={90} />
        <View style={[isCritical ? styles.criticalGlow : styles.minimalGlow, styles.hazardIcon]}>
          {isCritical ? (
            <Svg height={26} width={26} viewBox="0 0 26 26">
              {/* Solid Crimson Red Cross */}
              <Path
                d="M 9,2 H 17 V 9 H 24 V 17 H 17 V 24 H 9 V 17 H 2 V 9 H 9 Z"
                fill="#FF3333"
              />
            </Svg>
          ) : (
            <Svg height={24} width={24} viewBox="0 0 24 24">
              {/* Hollow Yellow Triangle */}
              <Polygon
                points="12,2 2,22 22,22"
                fill="rgba(255, 204, 0, 0.1)"
                stroke="#FFCC00"
                strokeWidth="3"
              />
            </Svg>
          )}
        </View>
      </View>
    </Marker>
  );
};

/**
 * UI.3, UI.8 & UI.12 MapScreen Component
 * Marion, Iowa coordinate focus. Uses high-contrast, tactile rugged UI guidelines.
 * Integrated with HazardReportModal, ConvoyOverlay, and satellite SOS triggers.
 */
const MapScreen = () => {
  const [loading, setLoading] = useState(false);
  const [unorthodoxyScore, setUnorthodoxyScore] = useState(0.5);
  const [routeCoords, setRouteCoords] = useState([]);
  const [bailoutCoords, setBailoutCoords] = useState([]);
  const [hazardModalVisible, setHazardModalVisible] = useState(false);
  const [userLocation, setUserLocation] = useState(null);
  const [isTransitActive, setIsTransitActive] = useState(false);
  
  // Tactical Threat Matrix states
  const [activeHazards, setActiveHazards] = useState([]);
  const [selectedHazard, setSelectedHazard] = useState(null);
  const [renderedHazard, setRenderedHazard] = useState(null);
  const [activeMembers, setActiveMembers] = useState([]);
  const drawerAnim = useRef(new Animated.Value(350)).current;

  // Tactical Comms & Mission Messaging Interface States
  const [commsLog, setCommsLog] = useState([]);
  const [connected, setConnected] = useState(false);
  const [textInput, setTextInput] = useState('');
  const socketRef = useRef(null);

  // Tactical Sliding Mission Control Hub States
  const [activeTab, setActiveTab] = useState("RADAR"); // Options: "RADAR" or "COMMS"
  const [isHubExpanded, setIsHubExpanded] = useState(false);
  const hubAnim = useRef(new Animated.Value(-500)).current;

  const convoyId = 'C-1';
  const clientId = 'User-1';
  const WS_URL = `ws://127.0.0.1:8000/api/convoy/${convoyId}/${clientId}`;

  const routeRequested = useRef(false);
  
  // Marion, Iowa center coordinate setup for testing
  const initialRegion = {
    latitude: 42.033,
    longitude: -91.598,
    latitudeDelta: 0.052,
    longitudeDelta: 0.052,
  };

  const [startCoord, setStartCoord] = useState([-91.666, 41.978]);
  const [endCoord, setEndCoord] = useState([-92.3587, 42.4995]);
  const [mapCenter, setMapCenter] = useState(initialRegion);

  useEffect(() => {
    const requestLocationPermission = async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert(
            'Location Permission Denied',
            'Foreground location access is required to track your device in real-time. Please enable it in system settings.'
          );
          return;
        }

        const location = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        });
        setUserLocation(location.coords);
      } catch (err) {
        Alert.alert(
          'Location Tracking Error',
          'Failed to retrieve dynamic GPS position. Ensure location services are active.'
        );
      }
    };

    requestLocationPermission();
  }, []);

  const loadActiveHazards = async () => {
    try {
      const dbHazards = await getActiveHazards();
      setActiveHazards((prev) => {
        const merged = [...dbHazards];
        prev.forEach((h) => {
          if (!merged.some((dbH) => dbH.id === h.id)) {
            // Keep recently reported/synced hazards (within 30 seconds) to prevent premature deletion by out-of-sync polling
            if (h.createdAt && Date.now() - h.createdAt < 30000) {
              merged.push(h);
            }
          }
        });
        return merged;
      });
    } catch (err) {
      console.error('[TELEMETRY-ERROR] loadActiveHazards failed:', err);
    }
  };

  const handleResolve = async () => {
    if (!renderedHazard) return;
    try {
      setLoading(true);
      const res = await resolveHazardCondition(renderedHazard.id);
      if (res.status === 'success') {
        setActiveHazards((prev) => prev.filter((h) => h.id !== renderedHazard.id));
        setSelectedHazard(null);
        Alert.alert('Hazard Resolved', `Hazard ${renderedHazard.id} was cleared successfully.`);
      }
    } catch (err) {
      Alert.alert('Resolution Failed', 'API server unreachable. Unable to resolve hazard.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadActiveHazards();
    const intervalId = setInterval(() => {
      loadActiveHazards();
    }, 12000);
    return () => clearInterval(intervalId);
  }, []);

  // WebSockets pipeline connection for Convoy Mode telemetry and Comms Log
  useEffect(() => {
    console.log('[TELEMETRY-WS] MapScreen useEffect: Initiating Socket Life-Cycle.');
    console.log('[TELEMETRY-WS] Evaluating target WS_URL string:', WS_URL);

    try {
      socketRef.current = new WebSocket(WS_URL);
      console.log('[TELEMETRY-WS] WebSocket instance successfully created.');
    } catch (wsInitError) {
      console.error('[TELEMETRY-WS] CRITICAL: Failed to construct WebSocket instance:', wsInitError.message, wsInitError);
    }

    if (socketRef.current) {
      socketRef.current.onopen = () => {
        setConnected(true);
        console.log('[TELEMETRY-WS] socketRef.current.onopen triggered. Convoy WS connected.');
      };

      socketRef.current.onmessage = (event) => {
        console.log('[TELEMETRY-WS] socketRef.current.onmessage: Data packet received. Data length:', event.data ? event.data.length : 0);
        try {
          const payload = JSON.parse(event.data);
          console.log('[TELEMETRY-WS] parsed payload:', JSON.stringify(payload));
          
          // Handle coordinate/status packets from other members
          if (payload.sender_id) {
            setActiveMembers(prev => {
              const index = prev.findIndex(m => m.id === payload.sender_id);
              const memberData = {
                id: payload.sender_id,
                lat: payload.latitude?.toFixed(5) || '0.0000',
                lon: payload.longitude?.toFixed(5) || '0.0000',
                heading: payload.heading !== undefined ? parseFloat(payload.heading) : 0,
                status: payload.chat_message || 'Active',
                timestamp: new Date().toLocaleTimeString(),
              };

              if (index !== -1) {
                const updated = [...prev];
                updated[index] = memberData;
                return updated;
              } else {
                return [...prev, memberData];
              }
            });

            // Handle incoming chat messages
            if (payload.chat_message) {
              setCommsLog(prev => {
                const newMsg = {
                  id: Date.now().toString(),
                  sender: payload.sender_id,
                  text: payload.chat_message,
                  time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                };
                const updated = [...prev, newMsg];
                return updated.slice(-20);
              });
            }
          }

          // Handle system disconnect events
          if (payload.event === 'disconnect' && payload.message) {
            const departedId = payload.message.match(/Client (\S+) has left/)?.[1];
            if (departedId) {
              setActiveMembers(prev => prev.filter(m => m.id !== departedId));
            }
          }

          // Handle incoming real-time hazard sync events
          if (payload.event === 'new_hazard') {
            const rawHazard = payload.hazard_data;
            if (rawHazard) {
              const hazard = {
                id: rawHazard.id || `HAZ_${Math.floor(100 + Math.random() * 900)}`,
                type: rawHazard.type,
                severity: rawHazard.severity,
                coordinate: {
                  latitude: parseFloat(rawHazard.latitude),
                  longitude: parseFloat(rawHazard.longitude),
                },
                reportedBy: rawHazard.reportedBy || 'User-1',
                timeAgo: rawHazard.timeAgo || 'JUST NOW',
                createdAt: Date.now(), // timestamp for merging
              };

              // UI Notification Action
              Alert.alert(
                '⚠️ EMERGENCY TRAIL UPDATE',
                `Type: ${hazard.type}\nSeverity: ${hazard.severity}\nReported By: @${hazard.reportedBy}`
              );

              // State Sync - check duplicate to prevent clashing keys
              setActiveHazards((prev) => {
                if (prev.some((h) => h.id === hazard.id)) {
                  return prev;
                }
                return [...prev, hazard];
              });
            }
          }
        } catch (err) {
          console.error('[TELEMETRY-WS] Error parsing WS message payload:', err);
        }
      };

      socketRef.current.onerror = (e) => {
        console.error('==================== [Convoy WS ERROR DETECTED] ====================');
        console.error('e.message:', e.message);
        try {
          console.error('Raw WebSocket Error Event object stringified:', JSON.stringify(e));
        } catch (stringifyError) {
          console.error('Could not stringify WebSocket error event object:', stringifyError.message);
        }
        console.error('=====================================================================');
      };

      socketRef.current.onclose = (closeEvent) => {
        setConnected(false);
        console.log('==================== [Convoy WS CLOSED] ====================');
        console.log('closeEvent.code:', closeEvent?.code);
        console.log('closeEvent.reason:', closeEvent?.reason);
        console.log('closeEvent.wasClean:', closeEvent?.wasClean);
        console.log('===========================================================');
      };
    }

    return () => {
      console.log('[TELEMETRY-WS] MapScreen useEffect Cleanup: Closing Convoy WS connection.');
      if (socketRef.current) {
        socketRef.current.close();
      }
    };
  }, []);

  const sendMessage = (textToSend) => {
    if (!textToSend || !textToSend.trim()) return;

    const lat = userLocation?.latitude || 42.033;
    const lon = userLocation?.longitude || -91.598;

    const payload = {
      latitude: lat,
      longitude: lon,
      chat_message: textToSend,
    };

    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify(payload));
      
      // Update local ledger for the sender (since server broadcasts to others only)
      setCommsLog(prev => {
        const updated = [
          ...prev,
          {
            id: Date.now().toString() + '-self',
            sender: 'User-1', // client_id
            text: textToSend,
            time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
          }
        ];
        return updated.slice(-20);
      });

      setTextInput('');
    } else {
      Alert.alert('Transmission Failed', 'No active WebSocket connection. Check signal.');
    }
  };

  // Slide animation trigger for the mission control hub drawer
  useEffect(() => {
    Animated.spring(hubAnim, {
      toValue: isHubExpanded ? 0 : -500,
      useNativeDriver: true,
      tension: 30,
      friction: 7,
    }).start();
  }, [isHubExpanded, hubAnim]);

  useEffect(() => {
    if (selectedHazard) {
      setRenderedHazard(selectedHazard);
      Animated.spring(drawerAnim, {
        toValue: 0,
        useNativeDriver: true,
        tension: 40,
        friction: 8,
      }).start();
    } else {
      Animated.timing(drawerAnim, {
        toValue: 350,
        duration: 250,
        useNativeDriver: true,
      }).start(() => {
        setRenderedHazard(null);
      });
    }
  }, [selectedHazard, drawerAnim]);

  const fetchRUTRoute = async (avoidCoords = null) => {
    routeRequested.current = true;
    setLoading(true);
    setBailoutCoords([]);
    try {
      const avoidList = (avoidCoords && avoidCoords.length === 2 && typeof avoidCoords[0] === 'number')
        ? [avoidCoords]
        : avoidCoords;
      
      // Explicitly match api.js signature order: (start, end, avoid, score)
      const data = await getRoute(startCoord, endCoord, avoidList, unorthodoxyScore);
      
      if (data.status === 'success' && data.coordinates) {
        const mapped = data.coordinates.map(c => ({
          longitude: c[0],
          latitude: c[1],
        }));
        setRouteCoords(mapped);
        setIsTransitActive(true);
      }
    } catch (err) {
      Alert.alert('Routing Error', 'Could not generate RUT path. Check terminal logs.');
    } finally {
      setLoading(false);
    }
  };

  const cancelRoute = () => {
    setRouteCoords([]);
    setBailoutCoords([]);
    setIsTransitActive(false);
  };

  const runBailout = async () => {
    if (!userLocation) {
      Alert.alert(
        'Satellite Lock Pending',
        'Please wait for a clear satellite GPS lock before triggering a bailout route.'
      );
      return;
    }
    setLoading(true);
    setRouteCoords([]); // Clear current routing overlay
    const currentLoc = [userLocation.longitude, userLocation.latitude];
    try {
      const data = await triggerBailout(currentLoc);
      if (data.status === 'success' && data.coordinates) {
        if (data.coordinates.length <= 1) {
          Alert.alert('Bail Out Success', 'You are already on a paved road.');
          return;
        }
        const mapped = data.coordinates.map(c => ({
          longitude: c[0],
          latitude: c[1],
        }));
        setBailoutCoords(mapped);
        Alert.alert('Bail Out Active', 'Escape route to nearest paved highway plotted in red.');
      }
    } catch (err) {
      Alert.alert('Bail Out Error', 'Unable to calculate escape path.');
    } finally {
      setLoading(false);
    }
  };

  const sendEmergencySOS = () => {
    Alert.alert(
      'TRANSMIT SOS BEACON',
      'Are you sure? This will compile and transmit an offline distress packet over simulated satellite link.',
      [
        { text: 'CANCEL', style: 'cancel' },
        { 
          text: 'CONFIRM SOS', 
          style: 'destructive',
          onPress: async () => {
            setLoading(true);
            try {
              // Set userId as the string token matching active convoy session
              const result = await triggerEmergencyBeacon('User-1', initialRegion.latitude, initialRegion.longitude, 'CRITICAL SOS');
              if (result.status === 'SOS_BROADCAST_SENT') {
                Alert.alert('SOS Transmitted', `Distress packet successfully compiled: ${result.raw_packet}`);
              }
            } catch (err) {
              Alert.alert('SOS Delivery Failure', 'Satellite connection simulation failed. Verify backend.');
            } finally {
              setLoading(false);
            }
          }
        }
      ]
    );
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (routeRequested.current) {
      fetchRUTRoute();
    }
  }, [unorthodoxyScore]);

  return (
    <View style={styles.container}>
      <MapView
        provider={PROVIDER_GOOGLE}
        style={styles.map}
        initialRegion={initialRegion}
        customMapStyle={darkMapStyle}
        onRegionChangeComplete={(region) => {
          setMapCenter(region);
        }}
        onPress={() => setIsHubExpanded(false)}
      >
        {/* User Current Location Marker */}
        {userLocation && (
          <Marker
            coordinate={{
              latitude: userLocation.latitude,
              longitude: userLocation.longitude,
            }}
            title="Current Location"
          >
            <View style={styles.userLocationMarker} />
          </Marker>
        )}
        {/* Render primary route path (Green) */}
        {routeCoords.length > 0 && (
          <Polyline
            coordinates={routeCoords}
            strokeColor="#00FF66"
            strokeWidth={5}
          />
        )}

        {/* Render bailout emergency path (Red) */}
        {bailoutCoords.length > 0 && (
          <Polyline
            coordinates={bailoutCoords}
            strokeColor="#FF3333"
            strokeWidth={6}
            lineDashPattern={[5, 5]}
          />
        )}

        {/* Start Point Marker */}
        <Marker 
          draggable={!isTransitActive}
          coordinate={{ latitude: startCoord[1], longitude: startCoord[0] }} 
          title="Start" 
          pinColor="#00FF66"
          onDragEnd={(e) => {
            const { latitude, longitude } = e.nativeEvent.coordinate;
            setStartCoord([longitude, latitude]);
          }}
        />

        {/* End Point Marker */}
        <Marker 
          draggable={!isTransitActive}
          coordinate={{ latitude: endCoord[1], longitude: endCoord[0] }} 
          title="Destination" 
          pinColor="#00E5FF"
          onDragEnd={(e) => {
            const { latitude, longitude } = e.nativeEvent.coordinate;
            setEndCoord([longitude, latitude]);
          }}
        />

        {/* Render Active Hazards (Threat Matrix) */}
        {activeHazards.map(hazard => (
          <HazardMarker
            key={hazard.id}
            hazard={hazard}
            onPress={(h) => setSelectedHazard(h)}
          />
        ))}

        {/* Render Tactical Convoy Ghost Markers */}
        {activeMembers.map(member => {
          const lat = parseFloat(member.lat);
          const lon = parseFloat(member.lon);
          // Skip mapping if latitude or longitude parses to NaN or returns '0.0000'
          if (isNaN(lat) || isNaN(lon) || lat === 0 || lon === 0 || member.lat === '0.0000' || member.lon === '0.0000') {
            return null;
          }
          return (
            <Marker
              key={member.id}
              coordinate={{ latitude: lat, longitude: lon }}
              anchor={{ x: 0.5, y: 0.5 }}
              rotation={parseFloat(member.heading) || 0}
            >
              <View style={styles.ghostMarkerWrapper}>
                <Text style={styles.ghostMarkerLabel}>@{member.id}</Text>
                <View style={styles.ghostMarkerGlowContainer}>
                  <View style={styles.ghostMarkerGlow} />
                  <Svg width={24} height={24} viewBox="0 0 24 24">
                    <Polygon
                      points="12,2 2,22 12,17 22,22"
                      fill="#00E5FF"
                    />
                  </Svg>
                </View>
              </View>
            </Marker>
          );
        })}
      </MapView>

      {/* Center-Screen Target Reticle */}
      <View style={styles.reticleContainer} pointerEvents="none">
        <View style={styles.reticleCrosshairHorizontal} />
        <View style={styles.reticleCrosshairVertical} />
        <View style={styles.reticleDot} />
      </View>

      {/* Toggle Notification Strip */}
      <TouchableOpacity
        style={styles.statusBar}
        onPress={() => setIsHubExpanded(!isHubExpanded)}
        activeOpacity={0.9}
      >
        <Text style={styles.statusBarText} numberOfLines={1}>
          🛰️ SQUADRON STATUS: [ {activeMembers.length} ACTIVE ] // LAST MSG: {commsLog.length > 0 ? commsLog[commsLog.length - 1].text : "NO TRANSMISSIONS"}
        </Text>
      </TouchableOpacity>

      {/* Unified tabbed dashboard drawer container */}
      <Animated.View style={[styles.hubDrawer, { transform: [{ translateY: hubAnim }] }]}>
        <View style={styles.tabHeader}>
          <TouchableOpacity
            style={[styles.tabButton, activeTab === 'RADAR' ? styles.tabActive : styles.tabInactive]}
            onPress={() => setActiveTab('RADAR')}
            activeOpacity={0.8}
          >
            <Text style={[styles.tabButtonText, activeTab === 'RADAR' ? styles.tabTextActive : styles.tabTextInactive]}>
              [ 🛰️ CONVOY RADAR ]
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tabButton, activeTab === 'COMMS' ? styles.tabActive : styles.tabInactive]}
            onPress={() => setActiveTab('COMMS')}
            activeOpacity={0.8}
          >
            <Text style={[styles.tabButtonText, activeTab === 'COMMS' ? styles.tabTextActive : styles.tabTextInactive]}>
              [ 💬 COMMS MATRIX ]
            </Text>
          </TouchableOpacity>
        </View>

        {activeTab === 'RADAR' && (
          <ConvoyOverlay activeMembers={activeMembers} connected={connected} />
        )}

        {activeTab === 'COMMS' && (
          <View>
            <FlatList
              data={commsLog.slice(-4)}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <Text style={styles.commsText} numberOfLines={1}>
                  {` [${item.time}] @${item.sender}: ${item.text}`}
                </Text>
              )}
              style={styles.commsFeed}
            />
            
            <View style={styles.inputRow}>
              <TextInput
                style={styles.textInput}
                value={textInput}
                onChangeText={setTextInput}
                placeholder="ENTER TACTICAL MESSAGE..."
                placeholderTextColor="#555555"
                underlineColorAndroid="transparent"
              />
              <TouchableOpacity
                style={styles.transmitButton}
                onPress={() => sendMessage(textInput)}
                activeOpacity={0.8}
              >
                <Text style={styles.transmitButtonText}>[ TRANSMIT ]</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.macroRow}>
              <TouchableOpacity style={styles.macroButton} onPress={() => sendMessage('🛑 HOLD')}>
                <Text style={styles.macroButtonText}>[ 🛑 HOLD ]</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.macroButton} onPress={() => sendMessage('🚜 STUCK')}>
                <Text style={styles.macroButtonText}>[ 🚜 STUCK ]</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.macroButton} onPress={() => sendMessage('⛽ LOW FUEL')}>
                <Text style={styles.macroButtonText}>[ ⛽ LOW FUEL ]</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.macroButton} onPress={() => sendMessage('🟢 CLEAR')}>
                <Text style={styles.macroButtonText}>[ 🟢 CLEAR ]</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        <TouchableOpacity
          style={styles.closePanelButton}
          onPress={() => setIsHubExpanded(false)}
          activeOpacity={0.8}
        >
          <Text style={styles.closePanelButtonText}>[ ❌ CLOSE PANEL ]</Text>
        </TouchableOpacity>
      </Animated.View>

      <SafeAreaView style={styles.overlayContainer}>
        {/* Top Panel: Shortcut Slider */}
        <View style={styles.topPanel}>
          <Text style={styles.panelTitle}>RUT UNORTHODOXY SLIDER</Text>
          <View style={styles.sliderRow}>
            <Text style={styles.sliderLabel}>PAVED</Text>
            <Slider
              style={styles.slider}
              minimumValue={0.0}
              maximumValue={1.0}
              value={unorthodoxyScore}
              minimumTrackTintColor="#00FF66"
              maximumTrackTintColor="#555555"
              thumbTintColor="#00FF66"
              onSlidingComplete={(val) => setUnorthodoxyScore(parseFloat(val.toFixed(2)))}
            />
            <Text style={styles.sliderLabel}>RUT</Text>
          </View>
          <Text style={styles.valueIndicator}>Score: {unorthodoxyScore.toFixed(2)}</Text>
        </View>

        {loading && (
          <View style={styles.loader}>
            <ActivityIndicator size="large" color="#00FF66" />
          </View>
        )}

        {/* Bottom Panel: Tactical Triggers */}
        <View style={styles.bottomPanel}>
          {!isTransitActive ? (
            <>
              {/* Row 1: LOCK START / DESTINATION */}
              <View style={styles.planningRow}>
                <TouchableOpacity 
                  style={styles.planningLockButton}
                  activeOpacity={0.8}
                  onPress={() => {
                    if (mapCenter) {
                      setStartCoord([mapCenter.longitude, mapCenter.latitude]);
                    }
                  }}
                >
                  <Text style={styles.planningLockText}>LOCK START</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  style={styles.planningLockButton}
                  activeOpacity={0.8}
                  onPress={() => {
                    if (mapCenter) {
                      setEndCoord([mapCenter.longitude, mapCenter.latitude]);
                    }
                  }}
                >
                  <Text style={styles.planningLockText}>LOCK DESTINATION</Text>
                </TouchableOpacity>
              </View>

              {/* Row 2: ENGAGE DRIVE (Ignition Switch) */}
              <TouchableOpacity 
                style={[
                  styles.engageButton,
                  loading ? styles.engageButtonDisabled : styles.engageButtonEnabled
                ]} 
                activeOpacity={0.8}
                disabled={loading}
                onPress={() => fetchRUTRoute(null)}
              >
                <Text style={[styles.engageButtonText, loading && styles.engageButtonTextDisabled]}>ENGAGE DRIVE</Text>
                <Text style={[styles.engageButtonSubText, loading && styles.engageButtonSubTextDisabled]}>// COGNITIVE ROUTING OVERRIDE</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              {/* Row 1: REPORT HAZARD, BAIL OUT, SOS BEACON */}
              <View style={styles.transitRow}>
                <TouchableOpacity 
                  style={styles.transitButtonHazard} 
                  activeOpacity={0.8}
                  onPress={() => setHazardModalVisible(true)}
                >
                  <Text style={[styles.transitButtonText, { color: '#000000' }]}>REPORT HAZARD</Text>
                </TouchableOpacity>

                <TouchableOpacity 
                  style={styles.transitButtonBailout} 
                  activeOpacity={0.8}
                  onPress={runBailout}
                >
                  <Text style={[styles.transitButtonText, { color: '#FFFFFF' }]}>BAIL OUT</Text>
                </TouchableOpacity>

                <TouchableOpacity 
                  style={styles.transitButtonSos} 
                  activeOpacity={0.8}
                  onPress={sendEmergencySOS}
                >
                  <Text style={[styles.transitButtonText, { color: '#FF3333' }]}>SOS BEACON</Text>
                </TouchableOpacity>
              </View>

              {/* Row 2: CANCEL MISSION // RESET PLAN */}
              <TouchableOpacity 
                style={styles.cancelMissionButton} 
                activeOpacity={0.8}
                onPress={cancelRoute}
              >
                <Text style={styles.cancelMissionButtonText}>CANCEL MISSION // RESET PLAN</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </SafeAreaView>

      {/* Monospaced HUD Inspection Drawer */}
      <Animated.View style={[styles.hudDrawer, { transform: [{ translateY: drawerAnim }] }]}>
        {renderedHazard && (
          <View style={styles.hudContent}>
            <View style={styles.hudHeader}>
              <Text style={styles.hudTitle}>THREAT DETECTION MATRIX</Text>
              <TouchableOpacity 
                style={styles.closeButton} 
                onPress={() => setSelectedHazard(null)}
                activeOpacity={0.7}
              >
                <Text style={styles.closeButtonText}>[ X ]</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.monoText}>--------------------------------------------------</Text>
            <Text style={styles.monoText}>[!] TARGET ID: {renderedHazard.id}</Text>
            <Text style={styles.monoText}>[!] THREAT TYPE: {renderedHazard.type} // {renderedHazard.severity}</Text>
            <Text style={styles.monoText}>[!] METRICS: LOCALIZED TRAIL DISRUPTION</Text>
            <Text style={styles.monoText}>[!] SOURCE: {renderedHazard.reportedBy} // {renderedHazard.timeAgo}</Text>
            <Text style={styles.monoText}>--------------------------------------------------</Text>
            
            <TouchableOpacity 
              style={styles.rechartButton}
              activeOpacity={0.8}
              onPress={() => {
                setSelectedHazard(null);
                fetchRUTRoute([renderedHazard.coordinate.longitude, renderedHazard.coordinate.latitude]);
              }}
            >
              <Text style={styles.rechartButtonText}>[ 🔄 RE-CHART TREK // AVOID THREAT ]</Text>
            </TouchableOpacity>

            <Pressable
              onPress={handleResolve}
              style={({ pressed }) => [
                styles.resolveButton,
                {
                  borderColor: pressed ? '#FF3333' : '#556655',
                  backgroundColor: pressed ? 'rgba(255, 51, 51, 0.1)' : 'rgba(85, 102, 85, 0.05)',
                }
              ]}
            >
              {({ pressed }) => (
                <Text
                  style={[
                    styles.resolveButtonText,
                    {
                      color: pressed ? '#FF3333' : '#00FF66',
                    }
                  ]}
                >
                  [ ✅ HAZARD CLEARED // RESOLVE THREAT ]
                </Text>
              )}
            </Pressable>
          </View>
        )}
      </Animated.View>

      {/* Active Hazard Modal Ingestion */}
      <HazardReportModal
        visible={hazardModalVisible}
        onClose={() => setHazardModalVisible(false)}
        latitude={userLocation ? userLocation.latitude : initialRegion.latitude}
        longitude={userLocation ? userLocation.longitude : initialRegion.longitude}
        onReportSubmitted={(newHazard) => {
          if (newHazard) {
            setActiveHazards((prev) => {
              if (prev.some((h) => h.id === newHazard.id)) {
                return prev;
              }
              return [...prev, newHazard];
            });
          }
          loadActiveHazards();
        }}
        socketRef={socketRef}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
  },
  map: {
    ...StyleSheet.absoluteFillObject,
  },
  userLocationMarker: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#006622',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.8,
    shadowRadius: 3,
    elevation: 5,
  },
  hazardMarkerWrapper: {
    justifyContent: 'center',
    alignItems: 'center',
    width: 96,
    height: 96,
  },
  pulseContainer: {
    position: 'absolute',
    width: 90,
    height: 90,
    justifyContent: 'center',
    alignItems: 'center',
  },
  hazardIcon: {
    width: 26,
    height: 26,
    zIndex: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pulseRing: {
    position: 'absolute',
    borderWidth: 1.5,
    backgroundColor: 'transparent',
  },
  criticalGlow: {
    shadowColor: '#FF3333',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 5,
    elevation: 6,
  },
  minimalGlow: {
    shadowColor: '#FFCC00',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 4,
    elevation: 4,
  },
  hudDrawer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(15, 15, 15, 0.98)',
    borderWidth: 2,
    borderColor: '#00FF66',
    padding: 16,
    paddingBottom: 32,
    zIndex: 9999,
    elevation: 20,
  },
  hudContent: {
    width: '100%',
  },
  hudHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  hudTitle: {
    color: '#00FF66',
    fontSize: 14,
    fontWeight: 'bold',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    letterSpacing: 1,
  },
  closeButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  closeButtonText: {
    color: '#FF3333',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontSize: 14,
    fontWeight: 'bold',
  },
  monoText: {
    color: '#00FF66',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontSize: 12,
    lineHeight: 18,
  },
  rechartButton: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#00FF66',
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: 'rgba(0, 255, 102, 0.05)',
  },
  rechartButtonText: {
    color: '#00FF66',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontSize: 12,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  overlayContainer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'space-between',
    pointerEvents: 'box-none',
  },
  topPanel: {
    backgroundColor: 'rgba(20, 20, 20, 0.95)',
    borderWidth: 2,
    borderColor: '#333333',
    margin: 16,
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  panelTitle: {
    color: '#00FF66',
    fontWeight: 'bold',
    fontSize: 14,
    letterSpacing: 1.5,
    marginBottom: 12,
  },
  sliderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
  },
  sliderLabel: {
    color: '#888888',
    fontSize: 10,
    fontWeight: 'bold',
    width: 45,
    textAlign: 'center',
  },
  slider: {
    flex: 1,
    height: 40,
  },
  valueIndicator: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: 'bold',
    marginTop: 4,
  },
  loader: {
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.8)',
    padding: 16,
    borderRadius: 8,
  },
  bottomPanel: {
    margin: 16,
    pointerEvents: 'auto',
  },
  reticleContainer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  reticleCrosshairHorizontal: {
    position: 'absolute',
    width: 30,
    height: 2,
    backgroundColor: '#00FF66',
    opacity: 0.8,
  },
  reticleCrosshairVertical: {
    position: 'absolute',
    width: 2,
    height: 30,
    backgroundColor: '#00FF66',
    opacity: 0.8,
  },
  reticleDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#00FF66',
  },
  planningRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
    width: '100%',
  },
  planningLockButton: {
    width: '48%',
    backgroundColor: 'rgba(20, 20, 20, 0.95)',
    borderWidth: 2,
    borderColor: '#00FF66',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5,
    shadowRadius: 3,
    elevation: 5,
  },
  planningLockText: {
    color: '#00FF66',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
  engageButton: {
    width: '100%',
    borderWidth: 3,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 12,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 5,
    elevation: 8,
  },
  engageButtonEnabled: {
    backgroundColor: '#00FF66',
    borderColor: '#FFFFFF',
  },
  engageButtonDisabled: {
    backgroundColor: '#444444',
    borderColor: '#444444',
    opacity: 0.6,
    shadowOpacity: 0,
    elevation: 0,
  },
  engageButtonText: {
    color: '#000000',
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 2,
  },
  engageButtonTextDisabled: {
    color: '#888888',
  },
  engageButtonSubText: {
    color: '#000000',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.5,
    marginTop: 1,
  },
  engageButtonSubTextDisabled: {
    color: '#888888',
  },
  transitRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
    width: '100%',
  },
  transitButtonHazard: {
    width: '31%',
    backgroundColor: '#FFCC00',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5,
    shadowRadius: 3,
    elevation: 5,
  },
  transitButtonBailout: {
    width: '31%',
    backgroundColor: '#FF3333',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5,
    shadowRadius: 3,
    elevation: 5,
  },
  transitButtonSos: {
    width: '31%',
    backgroundColor: '#000000',
    borderWidth: 2,
    borderColor: '#FF3333',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5,
    shadowRadius: 3,
    elevation: 5,
  },
  transitButtonText: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.5,
    textAlign: 'center',
  },
  cancelMissionButton: {
    width: '100%',
    backgroundColor: 'rgba(20, 20, 20, 0.95)',
    borderWidth: 2,
    borderColor: '#5a3b3b',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5,
    shadowRadius: 3,
    elevation: 5,
  },
  cancelMissionButtonText: {
    color: '#cc6666',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 2,
  },
  resolveButton: {
    marginTop: 10,
    borderWidth: 1,
    paddingVertical: 10,
    alignItems: 'center',
  },
  resolveButtonText: {
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontSize: 12,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  ghostMarkerWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghostMarkerGlowContainer: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghostMarkerGlow: {
    position: 'absolute',
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(0, 229, 255, 0.4)',
    shadowColor: '#00E5FF',
    shadowOpacity: 1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },
  ghostMarkerLabel: {
    color: '#00FF66',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontSize: 9,
    fontWeight: 'bold',
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 2,
    borderWidth: 1,
    borderColor: '#333333',
    overflow: 'hidden',
    marginBottom: 4,
    textAlign: 'center',
  },
  statusBar: {
    position: 'absolute',
    top: 130,
    left: 16,
    right: 16,
    backgroundColor: 'rgba(10, 10, 10, 0.9)',
    borderWidth: 1,
    borderColor: '#333333',
    paddingVertical: 8,
    paddingHorizontal: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    zIndex: 1000,
  },
  statusBarText: {
    color: '#00FF66',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontSize: 10,
    fontWeight: 'bold',
  },
  hubDrawer: {
    position: 'absolute',
    top: 170,
    left: 16,
    right: 16,
    backgroundColor: 'rgba(10, 10, 10, 0.95)',
    borderWidth: 1,
    borderColor: '#333333',
    padding: 12,
    zIndex: 999,
  },
  tabHeader: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#333333',
    marginBottom: 8,
  },
  tabButton: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabActive: {
    borderBottomWidth: 2,
    borderBottomColor: '#00FF66',
  },
  tabInactive: {
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabButtonText: {
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontSize: 11,
    fontWeight: 'bold',
  },
  tabTextActive: {
    color: '#00FF66',
  },
  tabTextInactive: {
    color: '#555555',
  },
  closePanelButton: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#FF3333',
    paddingVertical: 8,
    alignItems: 'center',
    backgroundColor: 'rgba(255, 51, 51, 0.05)',
  },
  closePanelButtonText: {
    color: '#FF3333',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontSize: 11,
    fontWeight: 'bold',
  },
  commsFeed: {
    maxHeight: 70,
    marginBottom: 4,
  },
  commsText: {
    color: '#00FF66',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontSize: 11,
    lineHeight: 16,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    borderTopWidth: 1,
    borderTopColor: '#2C2C2C',
    paddingTop: 8,
  },
  textInput: {
    flex: 1,
    height: 36,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    borderWidth: 1,
    borderColor: '#333333',
    color: '#00FF66',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontSize: 12,
    paddingHorizontal: 8,
  },
  transmitButton: {
    marginLeft: 8,
    backgroundColor: 'rgba(0, 255, 102, 0.1)',
    borderWidth: 1,
    borderColor: '#00FF66',
    height: 36,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  transmitButtonText: {
    color: '#00FF66',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontSize: 11,
    fontWeight: 'bold',
  },
  macroRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  macroButton: {
    flex: 1,
    backgroundColor: 'rgba(30, 30, 30, 0.8)',
    borderWidth: 1,
    borderColor: '#333333',
    paddingVertical: 6,
    marginHorizontal: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  macroButtonText: {
    color: '#00FF66',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontSize: 9,
    fontWeight: 'bold',
  },
});

// Custom dark high-contrast map tiles styling vector json
const darkMapStyle = [
  { "elementType": "geometry", "stylers": [{ "color": "#1a1a1a" }] },
  { "elementType": "labels.text.fill", "stylers": [{ "color": "#747474" }] },
  { "elementType": "labels.text.stroke", "stylers": [{ "color": "#1a1a1a" }] },
  { "featureType": "administrative", "elementType": "geometry", "stylers": [{ "visibility": "off" }] },
  { "featureType": "landscape", "elementType": "geometry.fill", "stylers": [{ "color": "#121212" }] },
  { "featureType": "road", "elementType": "geometry.fill", "stylers": [{ "color": "#2c2c2c" }] },
  { "featureType": "road.highway", "elementType": "geometry.fill", "stylers": [{ "color": "#3c3c3c" }] },
  { "featureType": "water", "elementType": "geometry", "stylers": [{ "color": "#0d1b2a" }] }
];

export default MapScreen;
