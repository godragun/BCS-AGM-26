document.addEventListener("DOMContentLoaded", () => {
    // --- 1. CONFIGURATION ---
    // Firebase configuration from your project settings
    const firebaseConfig = {
        apiKey: "AIzaSyBqYu3g59Q65Wwno8QZX0aK2kZpIn6x5ME",
        authDomain: "bcs-agm-26.firebaseapp.com",
        databaseURL: "https://bcs-agm-26-default-rtdb.firebaseio.com",
        projectId: "bcs-agm-26",
        storageBucket: "bcs-agm-26.firebasestorage.app",
        messagingSenderId: "413608420783",
        appId: "1:413608420783:web:05bd633203850541a6fb5a",
        measurementId: "G-68KMW8LDQB"
    };

    // Initialize Firebase
    firebase.initializeApp(firebaseConfig);
    const database = firebase.database();
    const auth = firebase.auth();
    
    // --- 1.5. ANONYMOUS AUTHENTICATION (More Secure) ---
    auth.signInAnonymously()
        .then((userCredential) => {
            console.log("Web app authenticated successfully (anonymously).");
            // Now that we are authenticated, initialize the rest of the app
            initializeAppLogic();
        })
        .catch((error) => {
            console.error("Web app authentication failed:", error);
            alert(`Authentication Failed: ${error.message}\nThe lamp cannot be controlled.`);
            const statusIcon = document.getElementById("status-icon");
            statusIcon.classList.remove("checking", "online");
            statusIcon.classList.add("offline");
            statusIcon.title = "Authentication Failed";
        });

    // --- 2. LAMP INTERACTION & ENHANCEMENTS ---
    // This function contains all the logic that should run AFTER authentication succeeds.
    function initializeAppLogic() {
        const fullscreenBtn = document.getElementById("fullscreen-btn");
        const statusIcon = document.getElementById("status-icon");
        const letters = document.querySelectorAll(".letter");

        // Load saved state from local storage on startup
        setupRealtimeListeners();

        letters.forEach(letter => {
            // Optimize for touch devices (remove 300ms delay)
            letter.addEventListener("touchstart", (e) => {
                e.preventDefault(); // Prevent ghost clicks
                letter.click();
            });

            letter.addEventListener("click", () => {
                // Add a "pop" animation on click for better feedback
                letter.style.transform = "scale(0.9)";
                setTimeout(() => {
                    letter.style.transform = "scale(1)";
                }, 150);

                // Toggle the visual "active" state
                letter.classList.toggle("active");

                // Save the new state to local storage
                saveLampState();

                // Get the bulb number from the data attribute
                const bulbIndex = letter.dataset.bulb;

                // Determine if the light should be 'on' or 'off'
                const state = letter.classList.contains("active") ? "on" : "off";

                // Send the command to the ESP32
                sendCommandToBulb(bulbIndex, state);
            });
        });

        // Start listening for ESP32 status on page load
        checkEspStatus();

        // --- 4. FULLSCREEN MODE ---
        fullscreenBtn.addEventListener("click", toggleFullScreen);

        // Update icon when user presses ESC to exit fullscreen
        const updateFullscreenIcon = () => {
            const isFullscreen = !!document.fullscreenElement || !!document.webkitFullscreenElement;
            fullscreenBtn.classList.toggle('fa-compress', isFullscreen);
            fullscreenBtn.classList.toggle('fa-expand', !isFullscreen);
            fullscreenBtn.title = isFullscreen ? "Exit Fullscreen" : "Toggle Fullscreen";
        };
        document.addEventListener('fullscreenchange', updateFullscreenIcon);
        document.addEventListener('webkitfullscreenchange', updateFullscreenIcon);

        // --- 5. GHOST BACKGROUND PARALLAX ---
        const ghost = document.querySelector(".bg-ghost");
        if (ghost) {
            document.addEventListener("mousemove", (e) => {
                const mouseX = e.clientX / window.innerWidth;
                const mouseY = e.clientY / window.innerHeight;
                // Move ghost opposite to mouse for a depth effect
                const moveX = (0.5 - mouseX) * 50; // Match intensity from main site
                const moveY = (0.5 - mouseY) * 50;
                ghost.style.transform = `translate(calc(-50% + ${moveX}px), calc(-50% + ${moveY}px))`;
            });

            // Mobile Gyroscope Support for Parallax
            window.addEventListener("deviceorientation", (e) => {
                if (e.gamma && e.beta) {
                    // Limit the movement range
                    const moveX = Math.min(Math.max(e.gamma, -45), 45); 
                    const moveY = Math.min(Math.max(e.beta, -45), 45);
                    ghost.style.transform = `translate(calc(-50% + ${moveX}px), calc(-50% + ${moveY}px))`;
                }
            });
        }
    }

    function sendCommandToBulb(bulbIndex, state) {
        console.log(`Sending command to Firebase: /lights/${bulbIndex} -> ${state}`);
        database.ref('lights/' + bulbIndex).set(state)
            .then(() => {
                console.log(`Successfully set bulb ${bulbIndex} to ${state}`);
                // Visual feedback for success
                const letter = document.querySelector(`.letter[data-bulb='${bulbIndex}']`);
                if (letter) {
                    letter.style.transition = 'all 0.3s ease';
                    letter.style.boxShadow = '0 0 25px #39ff14';
                    setTimeout(() => letter.style.boxShadow = 'none', 500);
                }
            })
            .catch(error => {
                console.error("Error sending command to Firebase:", error);
                alert("Failed to send command to the lamp. Check your internet connection and Firebase setup.");

                // Revert visual state on failure
                const letter = document.querySelector(`.letter[data-bulb='${bulbIndex}']`);
                if (letter) {
                    if (state === "on") letter.classList.remove("active");
                    else letter.classList.add("active");
                    saveLampState();
                }
            });
    }

    // --- 3. ESP32 STATUS CHECK ---
    function checkEspStatus() {
        const statusIcon = document.getElementById("status-icon");
        statusIcon.classList.add("checking"); // Show checking state immediately
        const statusRef = database.ref('status/timestamp');
        let lastHeartbeatTime = Date.now();
        let isOnline = false;
        
        // Listen for heartbeat updates from ESP32
        statusRef.on('value', (snapshot) => {
            // This callback fires on load and whenever the data changes.
            // If snapshot.val() is not null, it means the ESP has written a timestamp.
            if (snapshot.val() !== null) {
                // We received a heartbeat. Update the time we last saw it.
                lastHeartbeatTime = Date.now();
                if (!isOnline) {
                    isOnline = true;
                    updateStatusUI(true); // Set status to Online
                }
            }
        });

        // Check periodically if the heartbeat has stopped
        setInterval(() => {
            // If no heartbeat for 12 seconds, consider it offline
            if (Date.now() - lastHeartbeatTime > 12000 && isOnline) {
                isOnline = false;
                updateStatusUI(false);
            }
        }, 2000);

        function updateStatusUI(online) {
            if (online) {
                statusIcon.classList.remove("checking", "offline");
                statusIcon.classList.add("online");
                statusIcon.title = "ESP32 is Online";
            } else {
                statusIcon.classList.remove("checking", "online");
                statusIcon.classList.add("offline");
                statusIcon.title = "ESP32 is Offline.";
            }
        }
    }

    // --- 4. FULLSCREEN MODE ---

    function toggleFullScreen() {
        if (!document.fullscreenElement && !document.webkitFullscreenElement) {
            const requestMethod = document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen;
            if (requestMethod) {
                const p = requestMethod.call(document.documentElement);
                if (p && p.catch) p.catch(err => alert(`Error: ${err.message}`));
            }
        } else {
            const exitMethod = document.exitFullscreen || document.webkitExitFullscreen;
            if (exitMethod) exitMethod.call(document);
        }
    }

    // --- 6. ADD FLOATING PARTICLES ---
    function createFloatingParticle() {
        const particle = document.createElement("div");
        particle.classList.add("floating-orb");

        // Random size for depth effect (bigger = closer)
        const size = Math.random() * 15 + 5; 
        particle.style.width = `${size}px`;
        particle.style.height = particle.style.width;
        
        // Spawn anywhere on the screen
        particle.style.left = `${Math.random() * 100}vw`;
        particle.style.top = `${Math.random() * 100}vh`;
        
        // Start invisible
        particle.style.opacity = "0";

        document.body.appendChild(particle);
        
        // Random movement vector (drifting in any direction)
        const moveX = (Math.random() - 0.5) * 150;
        const moveY = (Math.random() - 0.5) * 150;
        const duration = Math.random() * 5000 + 4000; // 4-9 seconds

        particle.animate(
            [
                { transform: `translate(0, 0) scale(0.5)`, opacity: 0 },
                { transform: `translate(${moveX * 0.5}px, ${moveY * 0.5}px) scale(1)`, opacity: 0.6, offset: 0.5 },
                { transform: `translate(${moveX}px, ${moveY}px) scale(0.5)`, opacity: 0 },
            ],
            { duration: duration, easing: "ease-in-out" }
        ).onfinish = () => particle.remove();
    }
    // Create particles periodically
    // Reduce frequency on mobile to save battery/performance
    const particleInterval = window.innerWidth < 768 ? 300 : 100;
    setInterval(createFloatingParticle, particleInterval); 


    // --- 7. DYNAMIC PAGE TITLE ---
    const pageTitle = document.title;
    document.addEventListener("visibilitychange", () => {
        if (document.hidden) {
            document.title = "👋 Come back!";
        } else {
            document.title = pageTitle;
        }
    });

    // --- 8. EASTER EGG: KONAMI CODE ---
    const konamiCode = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"];
    let konamiIndex = 0;

    document.addEventListener("keydown", (e) => {
        if (e.key === konamiCode[konamiIndex]) {
            konamiIndex++;
            if (konamiIndex === konamiCode.length) {
                activateEasterEgg();
                konamiIndex = 0;
            }
        } else {
            konamiIndex = 0;
        }
    });

    function activateEasterEgg() {
        document.body.style.animation = "rainbow 2s linear infinite";
        setTimeout(() => {
            document.body.style.animation = "";
            alert("🎮 Secret Activated!");
        }, 3000);
    }

    // --- 9. STATE PERSISTENCE ---
    function saveLampState() {
        const activeBulbs = [];
        document.querySelectorAll(".letter.active").forEach(letter => {
            activeBulbs.push(letter.dataset.bulb);
        });
        localStorage.setItem("techxhibit_lamp_state", JSON.stringify(activeBulbs));
    }

    function setupRealtimeListeners() {
        // Sync with the definitive state from Firebase.
        // This acts as the single source of truth for the UI.
        // .on() is called once on load with the initial state, and then for every subsequent change.
        database.ref('lights').on('value', (snapshot) => {
            const serverState = snapshot.val() || {};
            
            // Create a set of bulb indexes that should be 'on' according to the server
            const serverOnBulbs = new Set();
            Object.keys(serverState).forEach(bulbIndex => {
                if (serverState[bulbIndex] === 'on') {
                    serverOnBulbs.add(bulbIndex);
                }
            });

            // Iterate through all letters in the DOM and sync their state without flickering
            document.querySelectorAll('.letter').forEach(letter => {
                const bulbIndex = letter.dataset.bulb;
                const shouldBeOn = serverOnBulbs.has(bulbIndex);
                const isCurrentlyOn = letter.classList.contains('active');

                if (shouldBeOn && !isCurrentlyOn) {
                    letter.classList.add('active');
                } else if (!shouldBeOn && isCurrentlyOn) {
                    letter.classList.remove('active');
                }
            });
            
            saveLampState(); // Save the new ground truth to local storage
        });
    }
});

// --- 9. INJECT CSS FOR ANIMATIONS ---
// This avoids needing to edit the style.css file directly.
const style = document.createElement("style");
style.textContent = `
    @keyframes rainbow {
        0% { filter: hue-rotate(0deg); }
        100% { filter: hue-rotate(360deg); }
    }
`;
document.head.appendChild(style); 