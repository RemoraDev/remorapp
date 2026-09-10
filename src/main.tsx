import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ThemeProvider } from "./context/ThemeContext";
import { SkinWebProvider } from "./context/SkinWebContext";
import "./styles/halcon.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider>
      <SkinWebProvider>
        <App />
      </SkinWebProvider>
    </ThemeProvider>
  </React.StrictMode>
);
