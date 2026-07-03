import dotenv from "dotenv";

import app from "./src/app";

dotenv.config({ quiet: true });

const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});
