import { Route, Routes } from "react-router-dom";

import { HomePage } from "./routes/home-page.js";
import { NotFoundPage } from "./routes/not-found-page.js";
import { RoomPage } from "./routes/room-page.js";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/room/:code" element={<RoomPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
