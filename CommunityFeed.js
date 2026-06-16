import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  View,
  Text,
  FlatList,
  TouchableOpacity,
  SafeAreaView,
  Modal,
  TextInput,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import axios from 'axios';

/**
 * UI.5 CommunitySocialFeed Screen
 * FlatList renderer utilizing rugged, tactile dark aesthetic.
 * Integrates live creation suite and lifecycle cross-referencing.
 */
const CommunityFeed = () => {
  const [feedItems, setFeedItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Modal Visibility State
  const [isPostModalVisible, setIsPostModalVisible] = useState(false);

  // Form Field States
  const [postType, setPostType] = useState('condition_report'); // 'condition_report' or 'trail_submission'
  
  // Condition Report Input Parameters
  const [obstacleType, setObstacleType] = useState('Fallen Tree');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [conditionDetails, setConditionDetails] = useState('');

  // Trail Submission Input Parameters
  const [routeName, setRouteName] = useState('');
  const [trailDetails, setTrailDetails] = useState('');

  // Fetch feed items from backend feed endpoint
  const fetchFeed = async () => {
    try {
      const response = await axios.get('http://127.0.0.1:8000/api/community/feed');
      if (response.data) {
        setFeedItems(response.data);
      }
    } catch (error) {
      console.error('[COMMUNITY-FEED] fetchFeed: Network Failure', error);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchFeed();
    setRefreshing(false);
  };

  useEffect(() => {
    setLoading(true);
    fetchFeed().finally(() => setLoading(false));
  }, []);

  const handleUpvote = async (id) => {
    try {
      const response = await axios.post(`http://127.0.0.1:8000/api/community/trails/${id}/vote`, {
        vote_type: 'up'
      });
      if (response.data && response.data.status === 'success') {
        // Sync item in the local state
        setFeedItems(prevItems =>
          prevItems.map(item =>
            item.id === id && item.type === 'trail_submission'
              ? { ...item, upvotes: response.data.upvotes, status: response.data.submission_status }
              : item
          )
        );
      }
    } catch (error) {
      console.error('[COMMUNITY-FEED] handleUpvote: Failed to cast vote', error);
    }
  };

  const resetForm = () => {
    setPostType('condition_report');
    setObstacleType('Fallen Tree');
    setLatitude('');
    setLongitude('');
    setConditionDetails('');
    setRouteName('');
    setTrailDetails('');
  };

  const handleSubmitPost = async () => {
    try {
      if (postType === 'condition_report') {
        if (!obstacleType || !latitude || !longitude) {
          alert('Error: Obstacle type, latitude, and longitude are required.');
          return;
        }

        const latFloat = parseFloat(latitude);
        const lonFloat = parseFloat(longitude);
        if (isNaN(latFloat) || isNaN(lonFloat)) {
          alert('Error: Coordinates must be valid floating point numbers.');
          return;
        }

        const payload = {
          reporter_id: 'User-1', // Seeded default user ID
          obstacle_type: obstacleType,
          latitude: latFloat,
          longitude: lonFloat,
          details: conditionDetails
        };

        const response = await axios.post('http://127.0.0.1:8000/api/community/conditions/report', payload);
        if (response.status === 201 || response.data?.status === 'success') {
          resetForm();
          setIsPostModalVisible(false);
          fetchFeed(); // Instantaneous background refresh
        }
      } else {
        if (!routeName || !trailDetails) {
          alert('Error: Route name and details are required.');
          return;
        }

        // Package details in a mock trace GeoJSON payload
        const geojsonPayload = {
          type: 'Feature',
          properties: {
            name: routeName,
            details: trailDetails
          },
          geometry: {
            type: 'LineString',
            coordinates: [
              [-105.123, 39.567],
              [-105.124, 39.568]
            ]
          }
        };

        const payload = {
          submitter_id: 'User-1', // Seeded default user ID
          geojson_trace_data: JSON.stringify(geojsonPayload)
        };

        const response = await axios.post('http://127.0.0.1:8000/api/community/trails/submit', payload);
        if (response.status === 201 || response.data?.status === 'success') {
          resetForm();
          setIsPostModalVisible(false);
          fetchFeed(); // Instantaneous background refresh
        }
      }
    } catch (error) {
      console.error('[COMMUNITY-FEED] handleSubmitPost: Request Failed', error);
      alert('Failed to submit post. Please verify server connectivity.');
    }
  };

  const renderItem = ({ item }) => {
    const isReport = item.type === 'condition_report';

    // Resolve route details for trail submissions
    let routeNameDisplay = 'Unnamed Route';
    let detailsDisplay = '';

    if (isReport) {
      routeNameDisplay = item.obstacle_type;
      detailsDisplay = item.details || '';
    } else {
      if (item.geojson_trace_data) {
        try {
          const parsed = JSON.parse(item.geojson_trace_data);
          if (parsed.properties) {
            if (parsed.properties.name) routeNameDisplay = parsed.properties.name;
            if (parsed.properties.details) detailsDisplay = parsed.properties.details;
          } else if (parsed.route_name) {
            routeNameDisplay = parsed.route_name;
            detailsDisplay = parsed.details || '';
          }
        } catch (e) {
          detailsDisplay = item.geojson_trace_data;
        }
      }
    }

    // Dynamic label header configuration
    let badgeText = 'TRAIL SUBMISSION';
    let badgeStyle = styles.badgeTrail;
    
    if (isReport) {
      if (item.hazard_state === 'ACTIVE') {
        badgeText = 'HAZARD ALERT';
        badgeStyle = styles.badgeActiveReport;
      } else {
        badgeText = 'HAZARD NEUTRALIZED';
        badgeStyle = styles.badgeNeutralizedReport;
      }
    }

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={[styles.badge, badgeStyle]}>
            {badgeText}
          </Text>
          <Text style={styles.timestamp}>{item.timestamp}</Text>
        </View>

        <Text style={styles.author}>Posted by @{isReport ? item.reporter : item.submitter}</Text>

        {isReport ? (
          <View>
            <Text style={styles.titleText}>{routeNameDisplay}</Text>
            <Text style={styles.coordinateText}>GPS: {item.latitude}, {item.longitude}</Text>
          </View>
        ) : (
          <View>
            <Text style={styles.titleText}>{routeNameDisplay}</Text>
            <Text style={styles.verifiedText}>STATUS: {item.status ? item.status.toUpperCase() : 'PENDING'}</Text>
          </View>
        )}

        {!!detailsDisplay && <Text style={styles.detailsText}>{detailsDisplay}</Text>}

        <View style={styles.cardFooter}>
          {isReport ? (
            <Text style={item.hazard_state === 'ACTIVE' ? styles.activeStatus : styles.neutralizedStatus}>
              Status: {item.hazard_state === 'ACTIVE' ? 'ACTIVE HAZARD' : 'NEUTRALIZED'}
            </Text>
          ) : (
            <TouchableOpacity 
              style={styles.upvoteButton}
              onPress={() => handleUpvote(item.id)}
            >
              <Text style={styles.upvoteText}>👍 UPVOTE ({item.upvotes || 0})</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#00FF66" />
        </View>
      ) : (
        <FlatList
          data={feedItems}
          renderItem={renderItem}
          keyExtractor={item => `${item.type}_${item.id}`}
          contentContainerStyle={styles.listContent}
          refreshing={refreshing}
          onRefresh={onRefresh}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>No feed items yet. Be the first to post!</Text>
            </View>
          }
        />
      )}

      {/* Floating Action Button (FAB) */}
      <TouchableOpacity 
        style={styles.fab} 
        onPress={() => setIsPostModalVisible(true)}
        activeOpacity={0.8}
      >
        <Text style={styles.fabIcon}>[ + ]</Text>
      </TouchableOpacity>

      {/* Slide-up Creation Modal */}
      <Modal
        visible={isPostModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => {
          setIsPostModalVisible(false);
          resetForm();
        }}
      >
        <KeyboardAvoidingView 
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>CREATE NEW POST</Text>
              <TouchableOpacity 
                onPress={() => {
                  setIsPostModalVisible(false);
                  resetForm();
                }}
              >
                <Text style={styles.closeButtonText}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.modalFormScroll}>
              {/* Segment Toggle Switch Selector */}
              <View style={styles.selectorContainer}>
                <TouchableOpacity
                  style={[
                    styles.selectorButton,
                    postType === 'condition_report' && styles.selectorActiveButton
                  ]}
                  onPress={() => setPostType('condition_report')}
                >
                  <Text style={[
                    styles.selectorText,
                    postType === 'condition_report' && styles.selectorActiveText
                  ]}>[ CONDITION REPORT ]</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.selectorButton,
                    postType === 'trail_submission' && styles.selectorActiveButton
                  ]}
                  onPress={() => setPostType('trail_submission')}
                >
                  <Text style={[
                    styles.selectorText,
                    postType === 'trail_submission' && styles.selectorActiveText
                  ]}>[ TRAIL SUBMISSION ]</Text>
                </TouchableOpacity>
              </View>

              {postType === 'condition_report' ? (
                /* Condition Report Fields */
                <View>
                  <Text style={styles.fieldLabel}>OBSTACLE TYPE</Text>
                  <View style={styles.obstaclePillsContainer}>
                    {['Fallen Tree', 'Deep Mud', 'Gate Locked', 'Washed Out', 'Flooded Crossing'].map((type) => (
                      <TouchableOpacity
                        key={type}
                        style={[
                          styles.obstaclePill,
                          obstacleType === type && styles.obstaclePillActive
                        ]}
                        onPress={() => setObstacleType(type)}
                      >
                        <Text style={[
                          styles.obstaclePillText,
                          obstacleType === type && styles.obstaclePillActiveText
                        ]}>{type.toUpperCase()}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <Text style={styles.fieldLabel}>COORDINATES (LATITUDE / LONGITUDE)</Text>
                  <View style={styles.coordInputsContainer}>
                    <TextInput
                      style={styles.coordInput}
                      placeholder="Latitude (e.g. 42.035)"
                      placeholderTextColor="#666666"
                      keyboardType="numeric"
                      value={latitude}
                      onChangeText={setLatitude}
                    />
                    <TextInput
                      style={styles.coordInput}
                      placeholder="Longitude (e.g. -91.602)"
                      placeholderTextColor="#666666"
                      keyboardType="numeric"
                      value={longitude}
                      onChangeText={setLongitude}
                    />
                  </View>

                  <Text style={styles.fieldLabel}>REPORT DETAILS</Text>
                  <TextInput
                    style={[styles.inputField, styles.textAreaField]}
                    placeholder="Enter hazard description, path status, winch instructions..."
                    placeholderTextColor="#666666"
                    multiline={true}
                    numberOfLines={4}
                    value={conditionDetails}
                    onChangeText={setConditionDetails}
                  />
                </View>
              ) : (
                /* Trail Submission Fields */
                <View>
                  <Text style={styles.fieldLabel}>ROUTE NAME</Text>
                  <TextInput
                    style={styles.inputField}
                    placeholder="Enter route name (e.g. Marion Level-C Connect)"
                    placeholderTextColor="#666666"
                    value={routeName}
                    onChangeText={setRouteName}
                  />

                  <Text style={styles.fieldLabel}>TRAIL DETAILS</Text>
                  <TextInput
                    style={[styles.inputField, styles.textAreaField]}
                    placeholder="Describe trail route terrain, difficulty, and surface quality..."
                    placeholderTextColor="#666666"
                    multiline={true}
                    numberOfLines={4}
                    value={trailDetails}
                    onChangeText={setTrailDetails}
                  />
                </View>
              )}

              {/* Submission Button */}
              <TouchableOpacity 
                style={styles.submitPostButton}
                onPress={handleSubmitPost}
              >
                <Text style={styles.submitPostText}>[ SUBMIT POST ]</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121212',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#121212',
  },
  listContent: {
    padding: 16,
    paddingBottom: 100,
  },
  emptyContainer: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  emptyText: {
    color: '#888888',
    fontSize: 14,
    textAlign: 'center',
  },
  card: {
    backgroundColor: '#1A1A1A',
    borderWidth: 2,
    borderColor: '#2C2C2C',
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  badge: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    overflow: 'hidden',
  },
  badgeActiveReport: {
    backgroundColor: '#FF3333', // Crimson background
    color: '#FFFFFF',
  },
  badgeNeutralizedReport: {
    backgroundColor: '#555555', // Muted gray background
    color: '#FFFFFF',
  },
  badgeTrail: {
    backgroundColor: '#00FF66',
    color: '#000000',
  },
  timestamp: {
    color: '#888888',
    fontSize: 11,
  },
  author: {
    color: '#888888',
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  titleText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '900',
    marginBottom: 4,
  },
  coordinateText: {
    color: '#00E5FF',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontSize: 12,
    marginBottom: 8,
  },
  verifiedText: {
    color: '#00FF66',
    fontWeight: 'bold',
    fontSize: 12,
    marginBottom: 8,
  },
  detailsText: {
    color: '#DDDDDD',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 12,
  },
  cardFooter: {
    borderTopWidth: 1,
    borderTopColor: '#2C2C2C',
    paddingTop: 12,
    flexDirection: 'row',
    justifyContent: 'flex-start',
  },
  activeStatus: {
    color: '#FF3333',
    fontWeight: 'bold',
    fontSize: 12,
  },
  neutralizedStatus: {
    color: '#888888',
    fontWeight: 'bold',
    fontSize: 12,
  },
  upvoteButton: {
    backgroundColor: '#222222',
    borderWidth: 1,
    borderColor: '#00FF66',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 4,
  },
  upvoteText: {
    color: '#00FF66',
    fontWeight: 'bold',
    fontSize: 11,
  },
  fab: {
    position: 'absolute',
    bottom: 24,
    right: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#00FF66',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    borderWidth: 1,
    borderColor: '#121212',
  },
  fabIcon: {
    color: '#000000',
    fontSize: 16,
    fontWeight: '900',
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
  },
  modalContainer: {
    backgroundColor: '#161616',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderWidth: 2,
    borderColor: '#2C2C2C',
    maxHeight: '85%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#2C2C2C',
  },
  modalTitle: {
    color: '#00FF66',
    fontWeight: '900',
    fontSize: 16,
    letterSpacing: 2,
  },
  closeButtonText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: 'bold',
  },
  modalFormScroll: {
    padding: 16,
  },
  selectorContainer: {
    flexDirection: 'row',
    marginBottom: 20,
    backgroundColor: '#1E1E1E',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#2C2C2C',
    padding: 4,
  },
  selectorButton: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 4,
  },
  selectorActiveButton: {
    backgroundColor: '#00FF66',
  },
  selectorText: {
    color: '#888888',
    fontWeight: 'bold',
    fontSize: 11,
    letterSpacing: 1,
  },
  selectorActiveText: {
    color: '#000000',
  },
  fieldLabel: {
    color: '#888888',
    fontWeight: 'bold',
    fontSize: 11,
    letterSpacing: 1,
    marginBottom: 8,
  },
  obstaclePillsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 16,
  },
  obstaclePill: {
    backgroundColor: '#222222',
    borderWidth: 1,
    borderColor: '#333333',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    marginRight: 8,
    marginBottom: 8,
  },
  obstaclePillActive: {
    backgroundColor: '#00FF66',
    borderColor: '#00FF66',
  },
  obstaclePillText: {
    color: '#888888',
    fontWeight: 'bold',
    fontSize: 10,
  },
  obstaclePillActiveText: {
    color: '#000000',
  },
  coordInputsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  coordInput: {
    flex: 0.48,
    height: 48,
    backgroundColor: '#222222',
    borderColor: '#2C2C2C',
    borderWidth: 1.5,
    borderRadius: 6,
    paddingHorizontal: 12,
    color: '#FFFFFF',
    fontSize: 14,
  },
  inputField: {
    height: 48,
    backgroundColor: '#222222',
    borderColor: '#2C2C2C',
    borderWidth: 1.5,
    borderRadius: 6,
    paddingHorizontal: 12,
    color: '#FFFFFF',
    fontSize: 14,
    marginBottom: 16,
  },
  textAreaField: {
    height: 100,
    paddingTop: 12,
    textAlignVertical: 'top',
  },
  submitPostButton: {
    backgroundColor: '#00FF66',
    paddingVertical: 14,
    borderRadius: 6,
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 24,
    shadowColor: '#00FF66',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  submitPostText: {
    color: '#000000',
    fontWeight: '900',
    fontSize: 13,
    letterSpacing: 2,
  },
});

export default CommunityFeed;
