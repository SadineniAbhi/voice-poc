import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";

import App from "./App";
import CallPage from "./pages/CallPage";
import OnboardingPage from "./pages/OnboardingPage";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<App />}>
          <Route index element={<CallPage />} />
          <Route path="onboarding" element={<OnboardingPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
