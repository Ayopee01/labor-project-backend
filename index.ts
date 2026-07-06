import dotenv from "dotenv";

dotenv.config({ quiet: true });

const { default: app } = require("./src/app");

const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});
