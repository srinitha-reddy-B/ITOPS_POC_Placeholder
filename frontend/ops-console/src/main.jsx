import React from "react";
import { createRoot } from "react-dom/client";
import "@xyflow/react/dist/style.css";
import "./styles.css";
import "./portal.css";
import App from "./App.jsx";

document.documentElement.setAttribute("data-theme", "light");

createRoot(document.getElementById("root")).render(<React.StrictMode><App /></React.StrictMode>);
