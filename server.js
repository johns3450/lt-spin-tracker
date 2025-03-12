const express = require('express');
const { MongoClient } = require('mongodb');
const cors = require('cors');
const bodyParser = require('body-parser');

// Google Sheets API integration
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

// Load service account credentials from credentials.json
const credentialsPath = path.join(__dirname, 'credentials.json');
const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
const spreadsheetId = '1WT1Z20hoixLoxtRO1bNHu9msNadKlYGgnYvPk4kZcfc'; // Your Google Sheet ID

// Create a JWT client using your service account credentials
const jwtClient = new google.auth.JWT(
  credentials.client_email,
  null,
  credentials.private_key,
  SCOPES
);

const sheets = google.sheets({ version: 'v4', auth: jwtClient });

// Function to append a new email to the Google Sheet
async function appendEmailToSheet(email) {
  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'Sheet1!A:B', // Column A for email, Column B for outcome
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      resource: {
        values: [[email, ""]]
      }
    });
    console.log("✅ Email appended to sheet:", email);
  } catch (error) {
    console.error("❌ Error appending email to sheet:", error);
  }
}

// Function to update the outcome for an email in the Google Sheet
async function updateOutcomeForEmail(email, outcome) {
  try {
    // Retrieve all rows from the sheet
    const readResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Sheet1!A:B'
    });
    const rows = readResponse.data.values;
    if (!rows || rows.length === 0) {
      console.log("No data found in sheet.");
      return;
    }
    // Find the row index with the matching email (Google Sheets rows are 1-indexed)
    let rowIndex = -1;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i][0].toLowerCase() === email.toLowerCase()) {
        rowIndex = i + 1;
        break;
      }
    }
    if (rowIndex === -1) {
      console.log("Email not found in sheet:", email);
      return;
    }
    // Update Column B (Outcome) for that row
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `Sheet1!B${rowIndex}`,
      valueInputOption: 'RAW',
      resource: {
        values: [[outcome]]
      }
    });
    console.log("✅ Outcome updated for email in sheet:", email, outcome);
  } catch (error) {
    console.error("❌ Error updating outcome for email:", error);
  }
}

const app = express();
app.use(cors());
app.use(bodyParser.json());

// MongoDB Connection String (update credentials as needed)
const mongoUri = "mongodb+srv://spinningWheelUser:Pass458.@spinning-wheel.hov4g.mongodb.net/?retryWrites=true&w=majority&appName=spinning-wheel";
const client = new MongoClient(mongoUri, { useNewUrlParser: true, useUnifiedTopology: true });

let allowedSpinsPerEmail = 1;  // New global variable for allowed spins per email

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
// POST /api/submitEmail - record a new email if not already used, or allow login if spins remain.
// POST /api/submitEmail - record a new email or allow login if spins remain.
app.post('/api/submitEmail', async (req, res) => {
  try {
    const { email } = req.body;
    const recaptcha = req.body['g-recaptcha-response'];
    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }
    if (!recaptcha) {
      return res.status(400).json({ error: "reCAPTCHA response is required" });
    }
    

    // Verify the reCAPTCHA response with Google.
    const secretKey = '6LfyJvIqAAAAAHODZaW0xDdeFhV1JWquECh56qaW'; // Replace with your actual secret key.
    const verificationUrl = `https://www.google.com/recaptcha/api/siteverify?secret=${secretKey}&response=${recaptcha}`;
    const recaptchaResponse = await fetch(verificationUrl, { method: 'POST' });
    const recaptchaData = await recaptchaResponse.json();

    if (!recaptchaData.success) {
      return res.status(400).json({ error: "reCAPTCHA verification failed" });
    }
    
    const allowedSpins = allowedSpinsPerEmail; // Dynamic allowed spins
    const existing = await emailsCollection.findOne({ email: email.toLowerCase() });
    if (existing) {
      if (existing.spinsUsed < allowedSpins) {
        return res.json({ 
          message: "Email already exists, continuing session.", 
          spinsUsed: existing.spinsUsed, 
          allowedSpins: allowedSpins 
        });
      } else {
        return res.status(400).json({ error: "No spins remaining for this email" });
      }
    }
    
    await emailsCollection.insertOne({ email: email.toLowerCase(), spinsUsed: 0, outcomes: [] });
    // Append the email to your Google Sheet.
    appendEmailToSheet(email.toLowerCase());
    
    res.json({ message: "Email submitted successfully", spinsUsed: 0, allowedSpins: allowedSpins });
  } catch (error) {
    res.status(500).json({ error: "Failed to submit email" });
  }
});

  
  // ----- Updated /api/logOutcome Endpoint -----
// POST /api/logOutcome - record the outcome for an email.
app.post('/api/logOutcome', async (req, res) => {
  try {
    const { email, outcome } = req.body;
    if (!email || !outcome) {
      return res.status(400).json({ error: "Email and outcome are required" });
    }
    const allowedSpins = allowedSpinsPerEmail; // Dynamic allowed spins
    const emailDoc = await emailsCollection.findOne({ email: email.toLowerCase() });
    if (!emailDoc) {
      return res.status(400).json({ error: "Email not found" });
    }
    if (emailDoc.spinsUsed >= allowedSpins) {
      return res.status(400).json({ error: "No spins remaining for this email" });
    }
    await emailsCollection.updateOne(
      { email: email.toLowerCase() },
      { $inc: { spinsUsed: 1 }, $push: { outcomes: outcome } }
    );
    // Update the outcome in the Google Sheet.
    updateOutcomeForEmail(email.toLowerCase(), outcome);
    res.json({ message: "Outcome logged successfully" });
  } catch (error) {
    res.status(500).json({ error: "Failed to log outcome" });
  }
});

  
  // ----- New Endpoint to Update Allowed Spins per Email -----
  app.post('/api/updateAllowedSpins', async (req, res) => {
    try {
      const { newAllowedSpins } = req.body;
      if (typeof newAllowedSpins !== "number" || newAllowedSpins <= 0) {
        return res.status(400).json({ error: "Invalid allowed spins value" });
      }
      allowedSpinsPerEmail = newAllowedSpins;
      res.json({ message: "Allowed spins per email updated successfully", allowedSpins: allowedSpinsPerEmail });
    } catch (error) {
      res.status(500).json({ error: "Failed to update allowed spins" });
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
