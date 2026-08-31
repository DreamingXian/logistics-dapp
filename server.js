const express = require("express");
const path = require("path");

const app = express();
const PORT = 5000;

app.use(express.static(path.join(__dirname, "src")));
app.use("/build", express.static(path.join(__dirname, "build")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "src", "index.html"));
});

app.listen(PORT, () => {
  console.log("====================================================");
  console.log(`🚢 Logistics Escrow dApp running at: http://127.0.0.1:${PORT}`);
  console.log("====================================================");
});
