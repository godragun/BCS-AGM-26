/*
 * BCS AGM 26 Digital Oil Lamp Controller
 * This code runs on an ESP32.
 * 1. Connects to WiFi.
 * 2. Connects to Firebase Realtime Database.
 * 3. Listens for data changes on the '/lights' path to control 8 bulbs.
 * 
 * Required Libraries:
 * - WiFi (included with ESP32 core)
 * - Firebase ESP32 Client by Mobizt (Install from Arduino Library Manager)
 */

#include <WiFi.h>
#include <Firebase_ESP_Client.h>

// Provide the token generation process info.
#include "addons/TokenHelper.h"

// --- CONFIGURATION ---
// Add your credentials before uploading
#define WIFI_SSID "YOUR_WIFI_SSID"
#define WIFI_PASSWORD "YOUR_WIFI_PASSWORD"

#define FB_API_KEY "YOUR_FIREBASE_API_KEY"
#define FB_PROJECT_ID "YOUR_FIREBASE_PROJECT_ID"
#define FB_USER_EMAIL "YOUR_FIREBASE_USER_EMAIL"
#define FB_USER_PASSWORD "YOUR_FIREBASE_USER_PASSWORD"


// Define Firebase objects
FirebaseData fbdo;
FirebaseData streamData;
FirebaseAuth auth;
FirebaseConfig config;

// An array to hold the GPIO pin numbers for each of the 8 bulbs.
// The order here corresponds to the `data-bulb` attribute in the HTML (0-7).
// Example: bulbPins[0] is for 'B', bulbPins[1] is for 'C', etc.
// CHOOSE ANY AVAILABLE GPIO PINS.
// WARNING: GPIO 12 is a strapping pin. If upload fails, disconnect it from the relay.
// WARNING: GPIO 2 must be floating or LOW during boot to enter flash mode.
const int bulbPins[8] = {
  18, 19, 21, 22, 23, 13, 14, 27 // Bulbs 0-7
};

// Database paths
String lightsPath = "/lights";
String statusPath = "/status";

// Callback function that runs when a value in the '/lights' path changes
void streamCallback(FirebaseStream data) {
  Serial.printf("Stream data received. Path: %s, Type: %s, Event: %s\n", data.dataPath().c_str(), data.dataType().c_str(), data.eventType().c_str());

  // We only care about 'put' events (data changed)
  if (data.eventType() == "put") {
    String path = data.dataPath();
    
    // When the stream connects, Firebase sends a "put" event with the path "/"
    // and the initial data for the entire node. We use this for our initial sync.
    if (path == "/") {
      Serial.println("Initial state received. Syncing all bulbs.");
      
      if (data.dataTypeEnum() == fb_esp_rtdb_data_type_json) {
        FirebaseJson *json = data.to<FirebaseJson *>();
        FirebaseJsonData result;
        for (int i = 0; i < 8; i++) {
          json->get(result, String(i));
          if (result.success && result.to<String>() == "on") {
            digitalWrite(bulbPins[i], HIGH);
          } else {
            digitalWrite(bulbPins[i], LOW);
          }
        }
      } else if (data.dataTypeEnum() == fb_esp_rtdb_data_type_array) {
        FirebaseJsonArray *arr = data.to<FirebaseJsonArray *>();
        FirebaseJsonData result;
        for (int i = 0; i < 8; i++) {
          arr->get(result, i);
          if (result.success && result.to<String>() == "on") {
            digitalWrite(bulbPins[i], HIGH);
          } else {
            digitalWrite(bulbPins[i], LOW);
          }
        }
      }
    } else {
      // This handles updates to individual bulbs, e.g., "/0", "/1", etc.
      path.remove(0, 1); // Remove leading '/' to get the bulb index
      int bulbIndex = path.toInt();

      if (bulbIndex >= 0 && bulbIndex < 8) {
        if (data.dataTypeEnum() == fb_esp_rtdb_data_type_string) {
          String state = data.to<String>();
          digitalWrite(bulbPins[bulbIndex], state == "on" ? HIGH : LOW);
          Serial.printf("Bulb %d set to %s\n", bulbIndex, state.c_str());
        }
      }
    }
  }
}

void streamTimeoutCallback(bool timeout) {
  if (timeout) {
    Serial.println("Stream timeout, connection lost. Will reconnect automatically.");
  }
}

void setup() {
  Serial.begin(115200);
  delay(100);

  // Initialize all bulb pins as outputs and set them to LOW (off)
  for (int i = 0; i < 8; i++) {
    pinMode(bulbPins[i], OUTPUT);
    digitalWrite(bulbPins[i], LOW);
  }

  // Connect to WiFi
  Serial.print("Connecting to ");
  Serial.println(WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  
  int retryCount = 0;
  while (WiFi.status() != WL_CONNECTED && retryCount < 20) {
    delay(500);
    Serial.print(".");
    retryCount++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nWiFi connected!");
    Serial.print("IP address: ");
    Serial.println(WiFi.localIP());
    
    // --- Firebase Setup ---
    // Assign the API key
    config.api_key = FB_API_KEY;

    // Assign the user sign-in credentials
    auth.user.email = FB_USER_EMAIL;
    auth.user.password = FB_USER_PASSWORD;

    // Assign the RTDB URL
    config.database_url = "https://" + String(FB_PROJECT_ID) + "-default-rtdb.firebaseio.com";

    // Assign the callback function for the long running token generation task
    config.token_status_callback = tokenStatusCallback; //see addons/TokenHelper.h

    // --- FIX: Optimize SSL and Timeouts ---
    // Increase timeouts to prevent "connection lost" errors
    config.timeout.wifiReconnect = 10 * 1000;
    config.timeout.socketConnection = 30 * 1000;
    config.timeout.serverResponse = 10 * 1000;
    config.timeout.rtdbKeepAlive = 45 * 1000;
    config.timeout.rtdbStreamReconnect = 1 * 1000;
    config.timeout.rtdbStreamError = 3 * 1000;
    
    // Reduce SSL buffer size to save memory (Fixes "Failed to initialize SSL layer")
    fbdo.setBSSLBufferSize(4096 /* Rx */, 1024 /* Tx */);
    streamData.setBSSLBufferSize(4096 /* Rx */, 1024 /* Tx */);
    // --------------------------------------

    Firebase.begin(&config, &auth);
    Firebase.reconnectWiFi(true);

    // Start listening for changes on the '/lights' path
    if (!Firebase.RTDB.beginStream(&streamData, lightsPath.c_str())) {
      Serial.printf("Firebase stream begin error: %s\n", streamData.errorReason().c_str());
    }
    Firebase.RTDB.setStreamCallback(&streamData, streamCallback, streamTimeoutCallback);

  } else {
    Serial.println("\nWiFi connection failed. Entering failsafe mode.");
    for (int i = 0; i < 8; i++) {
      digitalWrite(bulbPins[i], HIGH);
    }
  }
}

unsigned long previousMillis = 0;
const long interval = 10000; // Check for WiFi connection every 10 seconds
unsigned long lastHeartbeat = 0;
bool wasConnected = true;
bool needsSync = false;

void loop() {
  // 1. Heartbeat: Update timestamp every 5 seconds to tell Web we are online
  if (WiFi.status() == WL_CONNECTED && Firebase.ready() && (millis() - lastHeartbeat > 5000)) {
    lastHeartbeat = millis();
    // Use blocking setInt to ensure the heartbeat is actually sent.
    if (Firebase.RTDB.setInt(&fbdo, statusPath + "/timestamp", (int)millis())) {
      Serial.println("Heartbeat sent to Firebase");
    } else {
      Serial.printf("Failed to send heartbeat: %s\n", fbdo.errorReason().c_str());
      if (fbdo.errorReason() == "Permission denied") {
        Serial.println("-> ACTION REQUIRED: Go to Firebase Console > Realtime Database > Rules and enable '.write' permission.");
      }
    }
  }

  // Connection Logic
  if (WiFi.status() != WL_CONNECTED) {
    // If we were previously connected, this is a fresh disconnect.
    if (wasConnected) {
      wasConnected = false;
      Serial.println("WiFi connection lost! Activating failsafe (all lights ON).");
      // Turn all lights on immediately so the exhibit isn't dark
      for (int i = 0; i < 8; i++) {
        digitalWrite(bulbPins[i], HIGH);
      }
      needsSync = true;
    }

    // Periodically try to reconnect
    if (millis() - previousMillis >= interval) {
      previousMillis = millis();
      Serial.println("Attempting to reconnect to WiFi...");
      WiFi.reconnect();
    }
  } else {
    // We are connected
    if (!wasConnected) {
      Serial.println("WiFi Reconnected!");
      wasConnected = true;
    }

    // Sync state from Firebase if we just reconnected (and Firebase is ready)
    if (needsSync && Firebase.ready()) {
      Serial.println("Syncing lights from Firebase...");
      if (Firebase.RTDB.getJSON(&fbdo, lightsPath)) {
        if (fbdo.dataTypeEnum() == fb_esp_rtdb_data_type_json) {
          FirebaseJson *json = fbdo.to<FirebaseJson *>();
          FirebaseJsonData result;
          for (int i = 0; i < 8; i++) {
            json->get(result, String(i));
            if (result.success && result.to<String>() == "on") {
              digitalWrite(bulbPins[i], HIGH);
            } else {
              digitalWrite(bulbPins[i], LOW);
            }
          }
        } else if (fbdo.dataTypeEnum() == fb_esp_rtdb_data_type_array) {
          FirebaseJsonArray *arr = fbdo.to<FirebaseJsonArray *>();
          FirebaseJsonData result;
          for (int i = 0; i < 8; i++) {
            arr->get(result, i);
            if (result.success && result.to<String>() == "on") {
              digitalWrite(bulbPins[i], HIGH);
            } else {
              digitalWrite(bulbPins[i], LOW);
            }
          }
        }
        Serial.println("Sync complete.");
        needsSync = false;
      }
    }
  }
}