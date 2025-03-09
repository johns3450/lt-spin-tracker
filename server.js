const express = require('express');
const { MongoClient } = require('mongodb');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();

app.use(cors());
app.use(bodyParser.json());

// MongoDB Connection String
const mongoUri = "mongodb+srv://spinningWheelUser:Pass458.@spinning-wheel.hov4g.mongodb.net/?retryWrites=true&w=majority&appName=spinning-wheel";
const client = new MongoClient(mongoUri, { useNewUrlParser: true, useUnifiedTopology: true });

let db;
let spinsCollection;

// Connect to MongoDB and initialize the spins document if it doesn't exist
async function connectToDB() {
    try {
        await client.connect();
        db = client.db("spinningWheel"); // Make sure this matches your DB name
        spinsCollection = db.collection("spins");
        
        // Ensure a document exists to store the spin count
        const existingData = await spinsCollection.findOne({});
        if (!existingData) {
            await spinsCollection.insertOne({ totalSpins: 0, maxSpins: 1000 });
        }

        console.log("✅ Connected to MongoDB!");
    } catch (error) {
        console.error("❌ Error connecting to MongoDB:", error);
        process.exit(1); // Exit process if MongoDB fails to connect
    }
}

connectToDB();

// API to get the current spin count
app.get('/api/spins', async (req, res) => {
    try {
        const data = await spinsCollection.findOne({});
        if (!data) {
            return res.status(500).json({ error: "No spin data found" });
        }
        res.json({ totalSpins: data.totalSpins, maxSpins: data.maxSpins });
    } catch (error) {
        res.status(500).json({ error: "Failed to fetch spin count" });
    }
});

// API to update spin count
app.post('/api/spin', async (req, res) => {
    try {
        const data = await spinsCollection.findOne({});
        if (!data) {
            return res.status(500).json({ error: "No spin data found" });
        }

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

// API to update max spins dynamically
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

const port = 4000;
const server = app.listen(port, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${port}`);
});

server.on('error', (err) => {
  console.error("Server error:", err);
  if (err.code === 'EADDRINUSE') {
    console.error("Port is in use. Waiting 2 seconds before exiting...");
    setTimeout(() => process.exit(1), 2000); // wait 2 seconds before exiting
  } else {
    process.exit(1);
  }
});