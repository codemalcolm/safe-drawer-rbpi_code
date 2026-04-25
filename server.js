require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const crypto = require("crypto");
const { exec } = require("child_process");
const path = require("path");
const fs = require("fs");

const app = express();
app.use(express.json());
app.use(express.static("public"));

// --- Encryption & DB ---
// (This only encrypts the password before saving it to your local database)
function encrypt(text) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(
    "aes-256-cbc",
    Buffer.from(process.env.ENCRYPTION_KEY),
    iv,
  );
  return (
    iv.toString("hex") +
    ":" +
    Buffer.concat([cipher.update(text), cipher.final()]).toString("hex")
  );
}

// Utility to grab the permanent hardware ID
function getDeviceID() {
  try {
    const cpuInfo = fs.readFileSync("/proc/cpuinfo", "utf8");
    const match = cpuInfo.match(/Serial\s*:\s*([0-9a-f]{16})/i);

    if (match && match[1]) {
      return match[1];
    }
    return "DEV-TEST-8899";
  } catch (err) {
    console.error("Could not read hardware serial:", err);
    return "UNKNOWN-ID";
  }
}

// NOTE: Ignore DB connection errors if testing without Mongo installed yet.
mongoose
  .connect(process.env.MONGO_URI)
  .catch(() => console.log("DB Skipped for now"));

const Drawer = mongoose.model(
  "Drawer",
  new mongoose.Schema({
    drawerName: String,
    raspberryPiId: String,
    ssid: String,
    password: String,
    location: String, // Added location to match your frontend
  }),
);

// --- Device Info API ---
app.get("/api/device-info", (req, res) => {
  const deviceId = getDeviceID();
  res.json({
    serialNumber: deviceId,
    message: "Keep this safe! You will need it to claim your drawer.",
  });
});

// --- Setup API (Must be before the wildcard!) ---
app.post("/api/setup-wifi", async (req, res) => {
  const { drawerName, raspberryPiId, ssid, password, location } = req.body;

  // 1. Save to DB (Optional for testing)
  // try {
  //     await new Drawer({ drawerName, raspberryPiId, ssid, password: encrypt(password), location }).save();
  // } catch(e) { console.log("DB save skipped"); }

  // 2. IMMEDIATELY send success to the phone so the UI button turns green
  res.json({ success: true });

  // 3. Connect to Wi-Fi in the background after a 3-second delay
  setTimeout(() => {
    console.log(`Attempting to connect to ${ssid}...`);
    exec(
      `sudo nmcli device wifi connect "${ssid}" password "${password}"`,
      (err) => {
        if (err) {
          console.log("Wi-Fi Connection Failed.");
        } else {
          console.log("Connected successfully! Killing the hotspot...");
          // Kill the hotspot 2 seconds after successful connection
          setTimeout(
            () => exec("sudo nmcli connection down SafeDrawer_Setup"),
            2000,
          );
        }
      },
    );
  }, 3000);
});

// --- Captive Portal Trap ---
// This intercepts Apple/Android network checks and serves HTML!
app.get("/{*splat}", (req, res) => {
  res.sendFile(path.join(__dirname, "/public/setup.html"));
});

// --- Boot Logic ---
app.listen(80, "0.0.0.0", () => {
  console.log("Server running on Port 80");

  setTimeout(() => {
    exec("nmcli -t -f STATE general", (err, stdout) => {
      if (stdout.trim() !== "connected") {
        console.log("No Wi-Fi! Starting Hotspot...");
        exec(
          `sudo nmcli device wifi hotspot ifname wlan0 ssid "SafeDrawer_Setup" password "123456789"`,
        );
      }
    });
  }, 15000);
});
