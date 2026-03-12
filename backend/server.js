const express = require("express");
const cors = require("cors");
require("dotenv").config();

const { startScheduler } = require("./sync/scheduler");
startScheduler();

const reportRoute = require("./routes/report");
const fleetsRoute = require("./routes/fleets");
const exportRoute = require("./routes/export");

const app = express();

app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.use("/api/report", reportRoute);
app.use("/api/fleets", fleetsRoute);
app.use("/api/export", exportRoute);

const path = require("path");
app.use(express.static(path.join(__dirname, "..", "frontend")));

const port = process.env.PORT || 3002;
app.listen(port, () => console.log(`Backend listo en http://localhost:${port}`));