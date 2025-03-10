const express = require('express');
const { MongoClient } = require('mongodb');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
app.use(cors());
app.use(bodyParser.json());

// MongoDB Connection String (update credentials as needed)
const mongoUri = "mongodb+srv://spinningWheelUser:Pass458.@spinning-wheel.hov4g.mongodb.net/?retryWrites=true&w=majority&appName=spinning-wheel";
const client = new MongoClient(mongoUri, { useNewUrlParser: true, useUnifiedTopology: true });

let db;
let spinsCollection;  // Global spins document
let emailsCollection; // To store email info

// Connect to MongoDB and initialize collections/documents
// Connect to MongoDB and initialize collections/documents
async function connectToDB() {
    try {
      await client.connect();
      db = client.db("spinningWheel"); // Your DB name
      spinsCollection = db.collection("spins");
      emailsCollection = db.collection("emails");
  
      // Create a unique index on the email field for the emails collection
      emailsCollection.createIndex({ email: 1 }, { unique: true })
        .then(() => console.log("✅ Unique index on email created"))
        .catch(err => {
          if (err.codeName === "IndexOptionsConflict") {
            console.log("✅ Unique index on email already exists");
          } else {
            console.error("❌ Error creating unique index on email:", err);
          }
        });
  
      // Ensure a document exists in spins collection to store the global spin count
      const existingSpinData = await spinsCollection.findOne({});
      if (!existingSpinData) {
        await spinsCollection.insertOne({ totalSpins: 0, maxSpins: 1000 });
      }
  
      console.log("✅ Connected to MongoDB!");
    } catch (error) {
      console.error("❌ Error connecting to MongoDB:", error);
      process.exit(1); // Exit process if MongoDB fails to connect
    }
  }
  connectToDB();  

// ----- Existing Endpoints for Global Spin Count -----

// GET /api/spins - return the global spin count
app.get('/api/spins', async (req, res) => {
  try {
    const data = await spinsCollection.findOne({});
    if (!data) return res.status(500).json({ error: "No spin data found" });
    res.json({ totalSpins: data.totalSpins, maxSpins: data.maxSpins });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch spin count" });
  }
});

// POST /api/spin - update global spin count
app.post('/api/spin', async (req, res) => {
  try {
    const data = await spinsCollection.findOne({});
    if (!data) return res.status(500).json({ error: "No spin data found" });
    if (data.totalSpins >= data.maxSpins) {
      return res.status(400).json({ message: "No spins remaining" });
    }
    const newSpinCount = data.totalSpins + 1;
    await spinsCollection.updateOne({}, { $set: { totalSpins: newSpinCount } });
    res.json({ totalSpins: newSpinCount, maxSpins: data.maxSpins });
  } catch (error) {
    res.status(500).json({ error: "Failed to update spin count" });
  }
});

// POST /api/updateMaxSpins - update global max spins (if needed)
app.post('/api/updateMaxSpins', async (req, res) => {
  try {
    const { newMaxSpins } = req.body;
    if (typeof newMaxSpins !== "number" || newMaxSpins <= 0) {
      return res.status(400).json({ error: "Invalid max spins value" });
    }
    await spinsCollection.updateOne({}, { $set: { maxSpins: newMaxSpins } });
    res.json({ message: "Max spins updated successfully", maxSpins: newMaxSpins });
  } catch (error) {
    res.status(500).json({ error: "Failed to update max spins" });
  }
});

// ----- New Endpoints for Email and Outcome Logging -----
// POST /api/submitEmail - record a new email if not already used.
app.post('/api/submitEmail', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email is required" });
    // Check if email already exists.
    const existing = await emailsCollection.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(400).json({ error: "Email already used" });
    }
    // Insert new email document with spinsUsed = 0 and outcomes empty.
    await emailsCollection.insertOne({ email: email.toLowerCase(), spinsUsed: 0, outcomes: [] });
    res.json({ message: "Email submitted successfully" });
  } catch (error) {
    res.status(500).json({ error: "Failed to submit email" });
  }
});

// POST /api/logOutcome - record the outcome for an email.
app.post('/api/logOutcome', async (req, res) => {
  try {
    const { email, outcome } = req.body;
    if (!email || !outcome) {
      return res.status(400).json({ error: "Email and outcome are required" });
    }
    // Define the allowed spins per email (e.g., 1 spin per email).
    const allowedSpins = 1;
    const emailDoc = await emailsCollection.findOne({ email: email.toLowerCase() });
    if (!emailDoc) {
      return res.status(400).json({ error: "Email not found" });
    }
    if (emailDoc.spinsUsed >= allowedSpins) {
      return res.status(400).json({ error: "No spins remaining for this email" });
    }
    // Update the email document: increment spinsUsed and add the outcome.
    await emailsCollection.updateOne(
      { email: email.toLowerCase() },
      { $inc: { spinsUsed: 1 }, $push: { outcomes: outcome } }
    );
    res.json({ message: "Outcome logged successfully" });
  } catch (error) {
    res.status(500).json({ error: "Failed to log outcome" });
  }
});

const port = process.env.PORT || 4000;
const server = app.listen(port, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${port}`);
});

server.on('error', (err) => {
  console.error("Server error:", err);
  process.exit(1);
});

// Graceful shutdown on SIGINT
process.on('SIGINT', () => {
  console.log('Shutting down gracefully...');
  server.close(() => {
    process.exit(0);
  });
});
