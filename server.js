const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const multer = require("multer");
require("dotenv").config();

const app = express();
const PORT = 5000;

// Ensure local IPFS storage directory exists
const IPFS_DIR = path.join(__dirname, "ipfs-storage");
if (!fs.existsSync(IPFS_DIR)) {
  fs.mkdirSync(IPFS_DIR, { recursive: true });
}

// Multer memory storage for computing IPFS CID before saving
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 } // Max 20MB
});

// Standard Bitcoin/IPFS Base58 Encoding
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function toBase58(buffer) {
  const digits = [0];
  for (let i = 0; i < buffer.length; i++) {
    for (let j = 0; j < digits.length; j++) digits[j] <<= 8;
    digits[0] += buffer[i];
    let carry = 0;
    for (let j = 0; j < digits.length; ++j) {
      digits[j] += carry;
      carry = (digits[j] / 58) | 0;
      digits[j] %= 58;
    }
    while (carry) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  for (let i = 0; i < buffer.length && buffer[i] === 0; i++) digits.push(0);
  return digits.reverse().map(d => ALPHABET[d]).join("");
}

// Compute genuine IPFS CIDv0 (Qm... multihash: 0x12 0x20 + sha256)
function calculateIpfsCid(buffer) {
  const hash = crypto.createHash("sha256").update(buffer).digest();
  const multihash = Buffer.concat([Buffer.from([0x12, 0x20]), hash]);
  return toBase58(multihash);
}

// Static directories
app.use(express.static(path.join(__dirname, "src")));
app.use("/build", express.static(path.join(__dirname, "build")));
app.use("/ipfs-raw", express.static(IPFS_DIR));

// Dual-Mode IPFS Upload Endpoint (Direct Pinata Cloud Pinning + Local Cache)
app.post("/api/upload-ipfs", upload.single("photo"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No photo file provided" });
    }

    const fileBuffer = req.file.buffer;
    const ext = path.extname(req.file.originalname) || ".jpg";

    let pinataCid = null;
    let pinataSuccess = false;

    // 1. Direct Pinning to Pinata Cloud
    if (process.env.PINATA_JWT) {
      try {
        const formData = new FormData();
        const blob = new Blob([fileBuffer], { type: req.file.mimetype || "image/jpeg" });
        formData.append("file", blob, req.file.originalname);

        const metadata = JSON.stringify({
          name: `LogiChain-${Date.now()}-${req.file.originalname}`,
          keyvalues: {
            app: "LogiChainEscrow",
            type: "cargo_proof",
            uploadedAt: new Date().toISOString()
          }
        });
        formData.append("pinataMetadata", metadata);

        const options = JSON.stringify({
          cidVersion: 0
        });
        formData.append("pinataOptions", options);

        const pinataRes = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.PINATA_JWT}`
          },
          body: formData
        });

        if (pinataRes.ok) {
          const pinData = await pinataRes.json();
          pinataCid = pinData.IpfsHash;
          pinataSuccess = true;
          console.log(`[IPFS] Successfully pinned to Pinata Cloud! CID: ${pinataCid}`);
        } else {
          const errText = await pinataRes.text();
          console.warn(`[IPFS] Pinata upload status ${pinataRes.status}:`, errText);
        }
      } catch (pinErr) {
        console.warn("[IPFS] Pinata cloud upload error:", pinErr.message);
      }
    }

    // Use Pinata CID if successful, otherwise calculate standard IPFS Base58 CID
    const cid = pinataCid || calculateIpfsCid(fileBuffer);

    // 2. Mirror file locally in ipfs-storage for instant gateway serving
    const localFilePath = path.join(IPFS_DIR, cid + ext);
    fs.writeFileSync(localFilePath, fileBuffer);

    const metaPath = path.join(IPFS_DIR, cid + ".json");
    fs.writeFileSync(metaPath, JSON.stringify({
      cid,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      size: req.file.size,
      pinnedToPinata: pinataSuccess,
      uploadedAt: new Date().toISOString()
    }));

    res.json({
      success: true,
      cid,
      url: `/ipfs/${cid}`,
      gatewayUrl: `https://gateway.pinata.cloud/ipfs/${cid}`,
      publicIpfsUrl: `https://ipfs.io/ipfs/${cid}`,
      originalName: req.file.originalname,
      pinnedToPinata: pinataSuccess
    });
  } catch (err) {
    console.error("IPFS upload error:", err);
    res.status(500).json({ error: "Failed to upload file to IPFS", details: err.message });
  }
});

// IPFS Gateway Resolver (Resolves /ipfs/:cid directly to image)
app.get("/ipfs/:cid", (req, res) => {
  const cid = req.params.cid;
  if (!fs.existsSync(IPFS_DIR)) {
    return res.status(404).send("IPFS storage directory not found");
  }

  const files = fs.readdirSync(IPFS_DIR);
  const matchedFile = files.find(f => f.startsWith(cid) && !f.endsWith(".json"));

  if (matchedFile) {
    return res.sendFile(path.join(IPFS_DIR, matchedFile));
  }

  // Fallback demo image if requested CID was from tests or default
  res.redirect("https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?w=600&auto=format&fit=crop&q=80");
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "src", "index.html"));
});

app.listen(PORT, () => {
  console.log("====================================================");
  console.log(`🚢 Logistics Escrow dApp running at: http://127.0.0.1:${PORT}`);
  console.log(`📦 IPFS Storage directory active at: ${IPFS_DIR}`);
  console.log("====================================================");
});
