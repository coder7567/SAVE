import React, { useEffect, useState, useRef } from 'react';
import {
  StyleSheet,
  View,
  Text,
  FlatList,
  TouchableOpacity,
} from 'react-native';

/**
 * UI.10 ConvoyOverlay Component
 * Renders real-time telemetry updates for group tracking over WebSockets.
 */
const ConvoyOverlay = ({ activeMembers, setActiveMembers }) => {
  const [connected, setConnected] = useState(false);
  const socketRef = useRef(null);

  const convoyId = 'C-1';
  const clientId = 'User-1';
  const WS_URL = `ws://127.0.0.1:8000/api/convoy/${convoyId}/${clientId}`;

  useEffect(() => {
    console.log('[TELEMETRY-WS] useEffect: Initiating Socket Life-Cycle.');
    console.log('[TELEMETRY-WS] Evaluating target WS_URL string:', WS_URL);

    // Initialize connection
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
          }

          // Handle system disconnect events
          if (payload.event === 'disconnect' && payload.message) {
            const departedId = payload.message.match(/Client (\S+) has left/)?.[1];
            if (departedId) {
              setActiveMembers(prev => prev.filter(m => m.id !== departedId));
            }
          }
        } catch (err) {
          console.error('[TELEMETRY-WS] Error parsing WS message payload:', err);
        }
      };

      socketRef.current.onerror = (e) => {
        console.error('==================== [Convoy WS ERROR DETECTED] ====================');
        console.error('e.message:', e.message);
        
        // Expanding error handling: stringify the entire raw event object 'e'
        try {
          console.error('Raw WebSocket Error Event object stringified:', JSON.stringify(e));
        } catch (stringifyError) {
          console.error('Could not stringify WebSocket error event object:', stringifyError.message);
        }
        
        // Output internal metadata keys and properties
        try {
          console.error('WebSocket Error Event Keys:', Object.keys(e));
          for (const key of Object.keys(e)) {
            console.error(`e.${key}:`, e[key]);
          }
        } catch (keysError) {
          console.error('Could not iterate properties on WebSocket error event object:', keysError.message);
        }
        console.error('=====================================================================');
      };

      socketRef.current.onclose = (closeEvent) => {
        setConnected(false);
        console.log('==================== [Convoy WS CLOSED] ====================');
        console.log('closeEvent.code:', closeEvent?.code);
        console.log('closeEvent.reason:', closeEvent?.reason);
        console.log('closeEvent.wasClean:', closeEvent?.wasClean);
        try {
          console.log('Full CloseEvent:', JSON.stringify(closeEvent));
        } catch (closeStringifyErr) {
          console.log('Could not stringify CloseEvent:', closeStringifyErr.message);
        }
        console.log('===========================================================');
      };
    }

    return () => {
      console.log('[TELEMETRY-WS] useEffect Cleanup: Closing Convoy WS connection.');
      if (socketRef.current) {
        socketRef.current.close();
      }
    };
  }, []);

  const renderMember = ({ item }) => (
    <View style={styles.memberRow}>
      <View style={styles.statusDot} />
      <Text style={styles.memberId}>@{item.id}</Text>
      <Text style={styles.memberCoords}>{item.lat}, {item.lon}</Text>
      <Text style={styles.memberStatus}>{item.status}</Text>
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>CONVOY ACTIVE RADAR ({convoyId})</Text>
        <Text style={[styles.statusText, connected ? styles.online : styles.offline]}>
          {connected ? 'CONNECTED' : 'DISCONNECTED'}
        </Text>
      </View>

      {activeMembers.length === 0 ? (
        <Text style={styles.emptyText}>Waiting for convoy telemetry signal...</Text>
      ) : (
        <FlatList
          data={activeMembers}
          renderItem={renderMember}
          keyExtractor={item => item.id}
          style={styles.list}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 130, // Positioned below the top panel slider
    left: 16,
    right: 16,
    backgroundColor: 'rgba(20, 20, 20, 0.85)',
    borderWidth: 1,
    borderColor: '#333333',
    borderRadius: 8,
    padding: 12,
    maxHeight: 180,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#2C2C2C',
    paddingBottom: 6,
    marginBottom: 6,
  },
  title: {
    color: '#00FF66',
    fontWeight: 'bold',
    fontSize: 10,
    letterSpacing: 1,
  },
  statusText: {
    fontSize: 9,
    fontWeight: '900',
  },
  online: {
    color: '#00FF66',
  },
  offline: {
    color: '#FF3333',
  },
  list: {
    width: '100%',
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#00FF66',
    marginRight: 6,
  },
  memberId: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 11,
    width: 60,
  },
  memberCoords: {
    color: '#888888',
    fontFamily: 'monospace',
    fontSize: 10,
    flex: 1,
    textAlign: 'center',
  },
  memberStatus: {
    color: '#00E5FF',
    fontSize: 10,
    fontWeight: 'bold',
    width: 60,
    textAlign: 'right',
  },
  emptyText: {
    color: '#666666',
    fontSize: 10,
    fontStyle: 'italic',
    textAlign: 'center',
    marginVertical: 12,
  },
});

export default ConvoyOverlay;
